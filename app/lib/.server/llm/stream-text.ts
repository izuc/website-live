import { convertToCoreMessages, streamText as _streamText, type Message } from 'ai';
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
import type { LanguageModelV1 } from 'ai';
import type { ReasoningEffort } from '~/lib/modules/llm/types';

export type Messages = Message[];

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
  messages: any[];
  max_completion_tokens?: number;
  reasoning_effort?: ReasoningEffort;
  onFinish?: BaseStreamingOptions['onFinish'];
}

interface StandardSettings {
  model: LanguageModelV1;
  messages: any[];
  maxTokens: number;
  toolChoice?: 'none';
  onFinish?: BaseStreamingOptions['onFinish'];
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
  }).map(msg => ({
    role: msg.role,
    content: processMessageContent(msg.content)
  }));

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
      processedMessages = convertToCoreMessages([
        { role: 'user', content: systemPrompt }
      ]);
    } else {
      // Append system prompt to the first user message
      const firstUserMessage = userMessages[0];
      const updatedFirstMessage = {
        ...firstUserMessage,
        content: `${firstUserMessage.content}\n\n${systemPrompt}`
      };
      const otherMessages = validMessages.filter(msg => msg !== userMessages[0]);
      processedMessages = convertToCoreMessages([updatedFirstMessage, ...otherMessages]);
    }
  } else {
    // For other models, keep system message separate and ensure content is not empty
    const systemMessage = { role: 'system', content: getSystemPrompt() };
    processedMessages = [
      systemMessage,
      ...convertToCoreMessages(validMessages)
    ].filter(msg => processMessageContent(msg.content).trim().length > 0);
  }

  // Create base settings object
  const baseSettings = {
    model: selectedProvider.getModelInstance({
      model,
      serverEnv: env as Env,
      apiKeys,
      providerSettings
    }),
    messages: processedMessages,
    onFinish: options?.onFinish
  };

  // Handle o3-mini model
  if (model === 'o3-mini') {
    logger.debug('Using o3-mini specific settings');
    const o3Settings: O3Settings = {
      ...baseSettings,
      max_completion_tokens: O3_MINI_MAX_TOKENS
    };
    
    if (isReasoningModelOptions(options)) {
      if (options.reasoning_effort !== undefined) {
        o3Settings.reasoning_effort = options.reasoning_effort;
      }
    }

    const cleanSettings = Object.fromEntries(
      Object.entries(o3Settings).filter(([_, v]) => v !== undefined)
    ) as O3Settings;
    
    logger.debug('Clean settings for o3-mini:', JSON.stringify(cleanSettings, null, 2));
    return _streamText(cleanSettings);
  }

  // Handle other models
  logger.debug('Using standard model settings');
  const standardSettings: StandardSettings = {
    ...baseSettings,
    maxTokens: MAX_TOKENS
  };

  if (isStandardModelOptions(options)) {
    if (options.maxTokens) {
      standardSettings.maxTokens = options.maxTokens;
    }
    if (options.toolChoice) {
      standardSettings.toolChoice = options.toolChoice;
    }
  }
  
  logger.debug(`Final ${model} settings:`, JSON.stringify(standardSettings, null, 2));
  return _streamText(standardSettings);
}
