import { streamText as _streamText, type StreamTextResult } from 'ai';
import type { LanguageModelV1, LanguageModelV1Message, LanguageModelV1TextPart, LanguageModelV1StreamPart } from '@ai-sdk/provider';
import { MAX_TOKENS, O3_MINI_MAX_TOKENS, type FileMap } from './constants';
import { getSystemPrompt } from '~/lib/common/prompts/prompts';
import { DEFAULT_MODEL, DEFAULT_PROVIDER, MODIFICATIONS_TAG_NAME, PROVIDER_LIST, WORK_DIR } from '~/utils/constants';
import type { IProviderSetting } from '~/types/model';
import { PromptLibrary } from '~/lib/common/prompt-library';
import { allowedHTMLElements } from '~/utils/markdown';
import { LLMManager } from '~/lib/modules/llm/manager';
import { createScopedLogger } from '~/utils/logger';
import { createFilesContext, extractPropertiesFromMessage, simplifyBoltActions } from './utils';
import { getFilePaths } from './select-context';
import type { ReasoningEffort } from '~/lib/modules/llm/types';

// Define the Message type that was previously imported
interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: any;
  id?: string;
}

export type Messages = LanguageModelV1Message[];

// Base options that are common to all models
interface BaseStreamingOptions {
  onFinish?: (params: { 
    text: string; 
    finishReason?: string; 
    usage?: { 
      completionTokens?: number; 
      promptTokens?: number; 
      totalTokens?: number; 
    }; 
  }) => Promise<void>;
}

// Options specific to reasoning models like o3-mini
export interface ReasoningModelOptions extends BaseStreamingOptions {
  max_completion_tokens?: number;
  reasoning_effort?: ReasoningEffort;
}

// Options for standard models
export interface StandardModelOptions extends BaseStreamingOptions {
  maxTokens?: number;
  toolChoice?: 'none';
}

// Union type for all possible options
export type StreamingOptions = ReasoningModelOptions | StandardModelOptions;

const logger = createScopedLogger('stream-text');

// Clean interface for o3-mini settings
interface O3Settings {
  model: LanguageModelV1;
  messages: LanguageModelV1Message[];
  max_completion_tokens?: number;
  reasoning_effort?: ReasoningEffort;
  onFinish?: BaseStreamingOptions['onFinish'];
  stream?: boolean;
}

interface StandardSettings {
  model: LanguageModelV1;
  messages: LanguageModelV1Message[];
  maxTokens: number;
  toolChoice?: 'none';
  onFinish?: BaseStreamingOptions['onFinish'];
  stream?: boolean;
}

// Type guard to check if options are for a reasoning model
function isReasoningModelOptions(options: StreamingOptions | undefined): options is ReasoningModelOptions {
  if (!options) return false;
  return 'reasoningEffort' in options || 'max_completion_tokens' in options;
}

// Type guard to check if options are for a standard model
function isStandardModelOptions(options: StreamingOptions | undefined): options is StandardModelOptions {
  if (!options) return false;
  return 'maxTokens' in options;
}

// Helper function to transform stream parts to text-delta format
function transformStreamPart(part: LanguageModelV1StreamPart): LanguageModelV1StreamPart {
  if (part.type === 'tool-call-delta') {
    return {
      type: 'text-delta',
      textDelta: `${part.toolName}(${part.argsTextDelta})`
    };
  }
  return part;
}

// Helper function to transform stream
function transformStream(stream: ReadableStream<LanguageModelV1StreamPart>): ReadableStream<LanguageModelV1StreamPart> {
  if (!stream || typeof stream.getReader !== 'function') {
    return new ReadableStream({
      start(controller) {
        controller.enqueue({
          type: 'text-delta',
          textDelta: 'Error: Invalid or undefined stream provided to transformer'
        });
        controller.close();
      }
    });
  }

  return new ReadableStream({
    async start(controller) {
      const reader = stream.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            controller.close();
            break;
          }
          if (value) {
            controller.enqueue(transformStreamPart(value));
          }
        }
      } catch (e) {
        console.error('Error in stream transformation:', e);
        controller.enqueue({
          type: 'text-delta',
          textDelta: `Error during stream transformation: ${e instanceof Error ? e.message : 'Unknown error'}`
        });
        controller.error(e);
      } finally {
        reader.releaseLock();
      }
    },
    cancel(reason) {
      console.log('Stream transformation cancelled:', reason);
    }
  });
}

// Helper function to get text from stream part
function getTextFromStreamPart(part: LanguageModelV1StreamPart): string {
  if (part.type === 'text-delta') {
    return part.textDelta;
  }
  if (part.type === 'tool-call-delta') {
    return `${part.toolName}(${part.argsTextDelta})`;
  }
  if (part.type === 'tool-call') {
    const toolCall = part as any;  // Type assertion needed due to complex type structure
    return `${toolCall.function?.name || 'unknown'}(${JSON.stringify(toolCall.function?.arguments || {})})`;
  }
  return '';
}

// Helper function to wrap stream response
async function wrapStreamResponse<T>(response: T): Promise<T & { mergeIntoDataStream: (dataStream: any) => void; textStream: ReadableStream<string> }> {
  const logger = createScopedLogger('stream-text');
  
  logger.debug('Starting wrapStreamResponse');
  
  // Handle undefined stream
  if (!response || !(response as any).stream) {
    const errorMessage = 'No stream available in response';
    logger.error(errorMessage);
    
    const errorStream = new ReadableStream({
      start(controller) {
        controller.enqueue(errorMessage);
        controller.close();
      },
    });

    return {
      ...response,
      stream: errorStream,
      textStream: errorStream,
      usage: {
        completionTokens: 0,
        promptTokens: 0,
        totalTokens: 0
      },
      mergeIntoDataStream: (dataStream: any) => {
        if (dataStream?.writeData) {
          dataStream.writeData(errorMessage);
        }
      },
    } as any;
  }

  logger.debug('Stream is available, proceeding with processing');

  // Extract and validate usage metrics
  const usage = (response as any).usage || {};
  const validatedUsage = {
    completionTokens: Number.isFinite(Number(usage.completionTokens)) ? Number(usage.completionTokens) : 0,
    promptTokens: Number.isFinite(Number(usage.promptTokens)) ? Number(usage.promptTokens) : 0,
    totalTokens: Number.isFinite(Number(usage.totalTokens)) ? Number(usage.totalTokens) : 0
  };

  logger.debug('Raw usage values:', usage);
  logger.debug('Validated usage values:', validatedUsage);

  let accumulatedText = '';
  let streamActive = true;
  
  logger.debug('Creating text stream');
  const textStream = new ReadableStream({
    async start(controller) {
      logger.debug('Starting text stream reader');
      const reader = (response as any).stream.getReader();
      try {
        while (streamActive) {
          logger.debug('Reading from stream');
          const { done, value } = await reader.read();
          if (done) {
            logger.debug('Stream complete');
            streamActive = false;
            controller.close();
            break;
          }
          const text = getTextFromStreamPart(value);
          if (text) {
            logger.debug('Received text from stream:', text);
            accumulatedText += text;
            controller.enqueue(text);
          }
        }
      } catch (error) {
        logger.error('Error in text stream:', error);
        streamActive = false;
        controller.error(error);
      } finally {
        reader.releaseLock();
        logger.debug('Stream reader released');
      }
    },
    cancel() {
      streamActive = false;
      logger.debug('Stream cancelled');
    }
  });

  logger.debug('Created text stream, returning wrapped response');

  return {
    ...response,
    usage: validatedUsage,
    textStream,
    mergeIntoDataStream: (dataStream: any) => {
      logger.debug('Merging into data stream');
      if (dataStream?.writeData) {
        logger.debug('Writing accumulated text to data stream');
        dataStream.writeData(accumulatedText);
        
        if ((response as any).onFinish) {
          logger.debug('Calling onFinish callback');
          (response as any).onFinish({
            text: accumulatedText,
            usage: validatedUsage
          }).catch((error: unknown) => {
            logger.error('Error in onFinish callback:', error);
          });
        }
      } else {
        logger.warn('Data stream writeData method not available');
      }
    },
  } as any;
}

// Helper function to process message content
function processMessageContent(content: any): string {
  if (typeof content === 'string') {
    return content.trim();
  } else if (Array.isArray(content)) {
    const processedContent = content
      .map(item => {
        if (typeof item === 'string') {
          return item;
        } else if (typeof item === 'object') {
          if ('text' in item) {
            return item.text;
          } else if ('content' in item) {
            return item.content;
          }
        }
        return '';
      })
      .filter(text => text && text.trim())
      .join('\n');
    return processedContent.trim();
  } else if (typeof content === 'object' && content !== null) {
    if ('text' in content) {
      return content.text.trim();
    } else if ('content' in content) {
      return content.content.trim();
    }
  }
  return '';
}

// Helper function to convert message to LanguageModelV1Message format
function convertToLanguageModelV1Message(message: { role: 'system' | 'user' | 'assistant' | 'tool'; content: any }): LanguageModelV1Message {
  const { role, content } = message;
  
  const processedContent = processMessageContent(content);
  
  switch (role) {
    case 'system':
      return {
        role: 'system',
        content: processedContent
      };
    case 'user':
      return {
        role: 'user',
        content: [{
          type: 'text',
          text: processedContent
        }]
      };
    case 'assistant':
      return {
        role: 'assistant',
        content: [{
          type: 'text',
          text: processedContent
        }]
      };
    case 'tool':
      return {
        role: 'tool',
        content: [{
          type: 'tool-result',
          toolCallId: 'default',
          toolName: 'default',
          result: processedContent
        }]
      };
    default:
      throw new Error(`Unsupported message role: ${role}`);
  }
}

export async function streamText(props: {
  messages: Omit<Message, 'id'>[];
  env?: Env;
  options?: StreamingOptions;
  apiKeys?: Record<string, string>;
  files?: FileMap;
  providerSettings?: Record<string, IProviderSetting>;
  promptId?: string;
  contextOptimization?: boolean;
  contextFiles?: FileMap;
  summary?: string;
}) {
  const { messages, env, options, apiKeys, files = {}, providerSettings, promptId } = props;
  const logger = createScopedLogger('stream-text');

  try {
    // Validate messages
    if (!messages || messages.length === 0) {
      throw new Error('No messages provided');
    }

    // Extract model and provider from the first message
    const { model: extractedModel, provider: extractedProvider } = extractPropertiesFromMessage(messages[0]);
    
    // Set model and provider with defaults
    const model = extractedModel || DEFAULT_MODEL;
    const provider = extractedProvider || DEFAULT_PROVIDER.name;
    
    logger.debug(`Using model: ${model}, provider: ${provider}`);

    // Get provider instance
    const selectedProvider = PROVIDER_LIST.find((p) => p.name === provider) || DEFAULT_PROVIDER;

    // Filter out empty messages and process content
    const validMessages = messages.filter(msg => {
      const content = processMessageContent(msg.content);
      if (!content || content.trim().length === 0) {
        logger.debug(`Skipping empty message with role: ${msg.role}`);
        return false;
      }
      return true;
    });

    // If no valid messages, throw a more descriptive error
    if (validMessages.length === 0) {
      throw new Error('No valid messages found. All messages were empty or contained only whitespace.');
    }
    
    // Process messages based on model
    let processedMessages;
    if (model === 'o3-mini') {
      // For o3-mini, combine system prompt with first user message
      const systemPrompt = getSystemPrompt();
      const userMessages = validMessages.filter(msg => msg.role === 'user');
      
      // If no user messages, create one with the system prompt
      if (userMessages.length === 0) {
        processedMessages = [convertToLanguageModelV1Message({
          role: 'user',
          content: systemPrompt
        })];
      } else {
        // Append system prompt to the first user message
        const firstUserMessage = userMessages[0];
        const updatedFirstMessage = {
          ...firstUserMessage,
          content: `${firstUserMessage.content}\n\n${systemPrompt}`
        };
        const otherMessages = validMessages.filter(msg => msg !== userMessages[0]);
        processedMessages = [
          convertToLanguageModelV1Message(updatedFirstMessage),
          ...otherMessages.map(convertToLanguageModelV1Message)
        ];
      }
    } else {
      // For other models, keep system message separate
      const systemMessage = convertToLanguageModelV1Message({
        role: 'system',
        content: getSystemPrompt()
      });
      processedMessages = [
        systemMessage,
        ...validMessages.map(convertToLanguageModelV1Message)
      ];
    }

    // Create model instance with error handling
    const modelInstance = selectedProvider.getModelInstance({
      model,
      serverEnv: env as Env,
      apiKeys,
      providerSettings
    });

    if (!modelInstance) {
      throw new Error(`Failed to create model instance for ${model}`);
    }

    const baseSettings = {
      model: modelInstance,
      messages: processedMessages,
      stream: true,
      onFinish: options?.onFinish
    };

    let streamResponse;
    try {
      if (model === 'o3-mini') {
        logger.debug('Using o3-mini specific settings');
        const settings = {
          ...baseSettings,
          max_completion_tokens: O3_MINI_MAX_TOKENS
        } as any;
        
        if (isReasoningModelOptions(options) && options.reasoning_effort !== undefined) {
          settings.reasoning_effort = options.reasoning_effort;
        }
        
        logger.debug('O3-mini settings:', JSON.stringify(settings, null, 2));
        streamResponse = await _streamText(settings);
      } else {
        logger.debug('Using standard model settings');
        const settings = {
          ...baseSettings,
          maxTokens: isStandardModelOptions(options) ? options.maxTokens || MAX_TOKENS : MAX_TOKENS
        } as any;

        if (isStandardModelOptions(options) && options.toolChoice) {
          settings.toolChoice = options.toolChoice;
        }
        
        logger.debug('Standard model settings:', JSON.stringify(settings, null, 2));
        streamResponse = await _streamText(settings);
      }

      if (!streamResponse) {
        throw new Error('Stream response is undefined');
      }

      // Ensure we have a resolved stream result
      const streamResult = await Promise.resolve(streamResponse) as StreamTextResult<Record<string, any>> & {
        stream: ReadableStream<LanguageModelV1StreamPart>;
        usage?: {
          completionTokens?: number | string;
          promptTokens?: number | string;
          totalTokens?: number | string;
        };
      };
      
      // Wait for usage data to be available
      const usageData = await Promise.resolve(streamResult.usage || {});
      logger.debug('Raw stream result usage:', usageData);
      
      // Extract and validate token usage values with proper type checking
      const completionTokens = typeof usageData?.completionTokens === 'number' ? usageData.completionTokens : 
                             typeof usageData?.completionTokens === 'string' ? parseInt(usageData.completionTokens, 10) : 0;
      const promptTokens = typeof usageData?.promptTokens === 'number' ? usageData.promptTokens :
                          typeof usageData?.promptTokens === 'string' ? parseInt(usageData.promptTokens, 10) : 0;
      const totalTokens = typeof usageData?.totalTokens === 'number' ? usageData.totalTokens :
                         typeof usageData?.totalTokens === 'string' ? parseInt(usageData.totalTokens, 10) : 0;

      logger.debug('Extracted token values:', {
        completionTokens,
        promptTokens,
        totalTokens,
        rawCompletionTokens: usageData?.completionTokens,
        rawPromptTokens: usageData?.promptTokens,
        rawTotalTokens: usageData?.totalTokens
      });

      // Create validated usage object with proper defaults and type checking
      const validatedUsage = {
        completionTokens: Number.isFinite(completionTokens) ? completionTokens : 0,
        promptTokens: Number.isFinite(promptTokens) ? promptTokens : 0,
        totalTokens: Number.isFinite(totalTokens) ? totalTokens : 0
      };

      logger.debug('Validated usage:', validatedUsage);

      const response = {
        ...streamResult,
        stream: streamResult.stream,
        usage: validatedUsage
      };

      logger.debug('Final response usage:', validatedUsage);

      return wrapStreamResponse(response);
    } catch (streamError) {
      logger.error('Error creating stream:', streamError);
      throw new Error(`Failed to create stream: ${streamError instanceof Error ? streamError.message : 'Unknown error'}`);
    }
  } catch (error: unknown) {
    logger.error('Error in streamText:', error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    return {
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({
            type: 'text-delta',
            textDelta: `Error: ${errorMessage}`
          });
          controller.close();
        }
      }),
      textStream: new ReadableStream<string>({
        start(controller) {
          controller.enqueue(`Error: ${errorMessage}`);
          controller.close();
        }
      }),
      mergeIntoDataStream: (dataStream: any) => {
        if (dataStream?.writeData) {
          dataStream.writeData(`Error: ${errorMessage}`);
        }
      }
    };
  }
}
