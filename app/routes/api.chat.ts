import { json } from '@remix-run/cloudflare';
import type { ActionFunctionArgs } from '@remix-run/cloudflare';
import { createDataStream, generateId } from 'ai';
import { MAX_RESPONSE_SEGMENTS, MAX_TOKENS, O3_MINI_MAX_TOKENS, type FileMap } from '~/lib/.server/llm/constants';
import { CONTINUE_PROMPT } from '~/lib/common/prompts/prompts';
import { streamText, type Messages, type StreamingOptions, type ReasoningModelOptions, type StandardModelOptions } from '~/lib/.server/llm/stream-text';
import SwitchableStream from '~/lib/.server/llm/switchable-stream';
import type { IProviderSetting } from '~/types/model';
import { createScopedLogger } from '~/utils/logger';
import { getFilePaths, selectContext } from '~/lib/.server/llm/select-context';
import type { ContextAnnotation, ProgressAnnotation } from '~/types/context';
import { WORK_DIR } from '~/utils/constants';
import { createSummary } from '~/lib/.server/llm/create-summary';
import type { ReasoningEffort } from '~/lib/modules/llm/types';
import type { Message, SystemMessage, UserMessage, AssistantMessage, ToolMessage } from '~/lib/.server/llm/utils';
import { toLanguageModelV1Message } from '~/lib/.server/llm/utils';
import type { Message as AiMessage } from 'ai';
import type { LanguageModelV1TextPart, LanguageModelV1ImagePart, LanguageModelV1FilePart, LanguageModelV1ToolCallPart, LanguageModelV1ToolResultPart } from '@ai-sdk/provider';

const logger = createScopedLogger('api.chat');

type MessageContent = LanguageModelV1TextPart | LanguageModelV1ImagePart | LanguageModelV1FilePart | LanguageModelV1ToolCallPart | LanguageModelV1ToolResultPart;

function isTextPart(part: MessageContent): part is LanguageModelV1TextPart {
  return 'type' in part && part.type === 'text' && 'text' in part;
}

const convertToAiMessage = (msg: Message) => {
  const role = msg.role === 'tool' ? 'assistant' : msg.role;
  let content = '';
  
  if (Array.isArray(msg.content)) {
    for (const part of msg.content) {
      const typedPart = part as MessageContent;
      if (isTextPart(typedPart)) {
        content = typedPart.text;
        break;
      }
    }
  } else {
    content = msg.content;
  }
  
  return {
    role,
    content,
    id: msg.id
  };
};

function parseCookies(cookieHeader: string): Record<string, string> {
  const cookies: Record<string, string> = {};

  const items = cookieHeader.split(';').map((cookie) => cookie.trim());

  items.forEach((item) => {
    const [name, ...rest] = item.split('=');

    if (name && rest) {
      const decodedName = decodeURIComponent(name.trim());
      const decodedValue = decodeURIComponent(rest.join('=').trim());
      cookies[decodedName] = decodedValue;
    }
  });

  return cookies;
}

export async function action({ context, request }: ActionFunctionArgs) {
  const { messages, files, promptId, contextOptimization, reasoningEffort, model } = await request.json<{
    messages: Messages;
    files: any;
    promptId?: string;
    contextOptimization: boolean;
    reasoningEffort?: ReasoningEffort;
    model?: string;
  }>();

  const cookieHeader = request.headers.get('Cookie');
  const apiKeys = JSON.parse(parseCookies(cookieHeader || '').apiKeys || '{}');
  const providerSettings: Record<string, IProviderSetting> = JSON.parse(
    parseCookies(cookieHeader || '').providers || '{}',
  );

  const stream = new SwitchableStream();

  const cumulativeUsage = {
    completionTokens: 0,
    promptTokens: 0,
    totalTokens: 0,
  };
  const encoder: TextEncoder = new TextEncoder();
  let progressCounter: number = 1;

  try {
    const totalMessageContent = messages.reduce((acc, message) => acc + message.content, '');
    logger.debug(`Total message length: ${totalMessageContent.split(' ').length}, words`);
    logger.debug('Creating data stream...');

    const dataStream = createDataStream({
      execute: async (dataStream) => {
        logger.debug('Execute function called');
        const filePaths = getFilePaths(files || {});
        logger.debug(`File paths: ${JSON.stringify(filePaths)}`);
        let filteredFiles: FileMap | undefined = undefined;
        let summary: string | undefined = undefined;

        if (filePaths.length > 0 && contextOptimization) {
          dataStream.writeData('HI ');
          logger.debug('Generating Chat Summary');
          dataStream.writeMessageAnnotation({
            type: 'progress',
            value: progressCounter++,
            message: 'Generating Chat Summary',
          } as ProgressAnnotation);

          // Convert messages to ai package Message format
          const aiMessages = messages.map(msg => convertToAiMessage(msg as Message));
          const lastMessageId = (messages[messages.length - 1] as Message)?.id;

          summary = await createSummary({
            messages: aiMessages,
            env: context.cloudflare?.env,
            apiKeys,
            providerSettings,
            promptId,
            contextOptimization,
            onFinish(resp) {
              if (resp.usage) {
                logger.debug('createSummary token usage', JSON.stringify(resp.usage));
                cumulativeUsage.completionTokens += resp.usage.completionTokens || 0;
                cumulativeUsage.promptTokens += resp.usage.promptTokens || 0;
                cumulativeUsage.totalTokens += resp.usage.totalTokens || 0;
              }
            },
          });

          dataStream.writeMessageAnnotation({
            type: 'chatSummary',
            summary,
            chatId: lastMessageId,
          } as ContextAnnotation);

          // Update context buffer
          logger.debug('Updating Context Buffer');
          dataStream.writeMessageAnnotation({
            type: 'progress',
            value: progressCounter++,
            message: 'Updating Context Buffer',
          } as ProgressAnnotation);

          // Select context files
          console.log(`Messages count: ${messages.length}`);
          const contextResult = await selectContext({
            messages: aiMessages,
            env: context.cloudflare?.env as any,
            apiKeys,
            files,
            providerSettings,
            promptId,
            contextOptimization,
            summary,
            onFinish(resp) {
              if (resp.usage) {
                logger.debug('selectContext token usage', JSON.stringify(resp.usage));
                cumulativeUsage.completionTokens += resp.usage.completionTokens || 0;
                cumulativeUsage.promptTokens += resp.usage.promptTokens || 0;
                cumulativeUsage.totalTokens += resp.usage.totalTokens || 0;
              }
            },
          });

          filteredFiles = contextResult.files;

          // Write code context annotation
          dataStream.writeMessageAnnotation({
            type: 'codeContext',
            files: Object.keys(filteredFiles || {}),
          });

          dataStream.writeMessageAnnotation({
            type: 'progress',
            value: progressCounter++,
            message: 'Context Buffer Updated',
          } as ProgressAnnotation);
          logger.debug('Context Buffer Updated');
        }

        logger.debug(`Using model: ${model}`);
        logger.debug(`Reasoning effort value:`, reasoningEffort);

        // Define the onFinish callback
        const onFinishCallback = async ({ text: content, finishReason, usage }: { 
          text: string; 
          finishReason?: string; 
          usage?: { 
            completionTokens?: number; 
            promptTokens?: number; 
            totalTokens?: number; 
          }; 
        }) => {
          logger.debug('usage', JSON.stringify(usage));

          if (usage) {
            cumulativeUsage.completionTokens += usage.completionTokens || 0;
            cumulativeUsage.promptTokens += usage.promptTokens || 0;
            cumulativeUsage.totalTokens += usage.totalTokens || 0;
          }

          if (finishReason !== 'length') {
            dataStream.writeMessageAnnotation({
              type: 'usage',
              value: {
                completionTokens: cumulativeUsage.completionTokens,
                promptTokens: cumulativeUsage.promptTokens,
                totalTokens: cumulativeUsage.totalTokens,
              },
            });
            await new Promise((resolve) => setTimeout(resolve, 0));

            return;
          }

          if (stream.switches >= MAX_RESPONSE_SEGMENTS) {
            throw Error('Cannot continue message: Maximum segments reached');
          }

          const switchesLeft = MAX_RESPONSE_SEGMENTS - stream.switches;

          logger.info(`Reached max token limit (${MAX_TOKENS}): Continuing message (${switchesLeft} switches left)`);

          const assistantMessage: AssistantMessage = {
            role: 'assistant',
            content: [{ type: 'text', text: content }],
            id: `assistant-${Date.now()}-${Math.random().toString(36).substring(2)}`,
            providerMetadata: {}
          };
          messages.push(toLanguageModelV1Message(assistantMessage));

          const userMessage: UserMessage = {
            role: 'user',
            content: [{ type: 'text', text: CONTINUE_PROMPT }],
            id: `user-${Date.now()}-${Math.random().toString(36).substring(2)}`,
            providerMetadata: {}
          };
          messages.push(toLanguageModelV1Message(userMessage));

          // Create continuation options based on model
          let continuationOptions: StreamingOptions;
          if (model === 'o3-mini') {
            logger.debug('Using o3-mini specific options for continuation');
            logger.debug('Current reasoning effort:', reasoningEffort);
            continuationOptions = {
              max_completion_tokens: O3_MINI_MAX_TOKENS,
              reasoning_effort: reasoningEffort || 'medium',
              onFinish: onFinishCallback
            };
            logger.debug('Continuation options:', JSON.stringify(continuationOptions));
          } else {
            logger.debug('Using standard model options for continuation');
            continuationOptions = {
              maxTokens: MAX_TOKENS,
              onFinish: onFinishCallback
            };
          }

          logger.debug('Calling streamText for continuation with options:', JSON.stringify(continuationOptions));
          const result = await streamText({
            messages,
            env: context.cloudflare?.env,
            options: continuationOptions,
            apiKeys,
            files,
            providerSettings,
            promptId,
            contextOptimization,
            contextFiles: filteredFiles,
            summary,
          });

          logger.debug('Got continuation result from streamText, merging into dataStream');
          result.mergeIntoDataStream(dataStream);
          logger.debug('Merged continuation result into dataStream');
        };

        // Create initial options based on model
        let streamOptions: StreamingOptions;
        if (model === 'o3-mini') {
          logger.debug('Using o3-mini specific options');
          logger.debug('Initial reasoning effort:', reasoningEffort);
          streamOptions = {
            max_completion_tokens: O3_MINI_MAX_TOKENS,
            reasoning_effort: reasoningEffort,
            onFinish: onFinishCallback
          };
          logger.debug('Stream options:', JSON.stringify(streamOptions));
        } else {
          logger.debug('Using standard model options');
          streamOptions = {
            maxTokens: MAX_TOKENS,
            onFinish: onFinishCallback
          };
        }

        logger.debug('Calling streamText with options:', JSON.stringify(streamOptions));
        const result = await streamText({
          messages,
          env: context.cloudflare?.env,
          options: streamOptions,
          apiKeys,
          files,
          providerSettings,
          promptId,
          contextOptimization,
          contextFiles: filteredFiles,
          summary,
        });

        logger.debug('Got result from streamText, merging into dataStream');
        result.mergeIntoDataStream(dataStream);
        logger.debug('Merged result into dataStream');
      },
      onError: (error: any) => `Custom error: ${error.message}`
    }).pipeThrough(new TransformStream({
      transform: (chunk, controller) => {
        // Convert the string stream to a byte stream
        const str = typeof chunk === 'string' ? chunk : JSON.stringify(chunk);
        controller.enqueue(encoder.encode(str));
      }
    }));

    return new Response(dataStream, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'Content-Encoding': 'none',
        'X-Accel-Buffering': 'no',
        'Transfer-Encoding': 'chunked'
      },
    });
  } catch (error: any) {
    logger.error(error);

    if (error.message?.includes('API key')) {
      throw new Response('Invalid or missing API key', {
        status: 401,
        statusText: 'Unauthorized',
      });
    }

    throw new Response(null, {
      status: 500,
      statusText: 'Internal Server Error',
    });
  }
}