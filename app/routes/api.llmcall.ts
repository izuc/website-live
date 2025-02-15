import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { streamText } from '~/lib/.server/llm/stream-text';
import type { IProviderSetting } from '~/types/model';
import { generateText } from 'ai';
import { PROVIDER_LIST } from '~/utils/constants';
import { MAX_TOKENS } from '~/lib/.server/llm/constants';
import { LLMManager } from '~/lib/modules/llm/manager';
import type { ModelInfo, ReasoningEffort, ProviderInfo } from '~/lib/modules/llm/types';
import { getApiKeysFromCookie, getProviderSettingsFromCookie } from '~/lib/api/cookies';
import { type LanguageModelV1StreamPart, type LanguageModelV1CallOptions, type LanguageModelV1Message } from '@ai-sdk/provider';
import type { Env } from '~/lib/.server/llm/select-context';
import { json } from '@remix-run/cloudflare';

function transformStream(stream: ReadableStream<LanguageModelV1StreamPart>): ReadableStream<LanguageModelV1StreamPart> {
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
          // Convert "reasoning" type to "text-delta" type
          if ('textDelta' in value) {
            controller.enqueue({
              type: "text-delta",
              textDelta: value.textDelta
            });
          } else {
            controller.enqueue(value);
          }
        }
      } catch (e) {
        controller.error(e);
      }
    }
  });
}

function parseCookies(cookieHeader: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  
  if (!cookieHeader) {
    return cookies;
  }

  cookieHeader.split(';').forEach(cookie => {
    const parts = cookie.split('=');
    const name = parts[0]?.trim();
    const value = parts[1]?.trim();
    if (name && value) {
      cookies[name] = value;
    }
  });

  return cookies;
}

async function getModelList(options: {
  apiKeys?: Record<string, string>;
  providerSettings?: Record<string, IProviderSetting>;
  serverEnv?: Env;
}) {
  const llmManager = LLMManager.getInstance();
  return llmManager.updateModelList(options);
}

export async function action({ context, request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const serverEnv = context.env as Env;
  const apiKeys = parseCookies(request.headers.get('cookie') || '');
  const providerSettings = JSON.parse(formData.get('providerSettings')?.toString() || '{}');

  const modelList = await getModelList({
    apiKeys,
    providerSettings,
    serverEnv,
  });

  return json({ modelList });
}

async function llmCallAction({ context, request }: ActionFunctionArgs) {
  const { system, message, model, provider, streamOutput } = await request.json<{
    system: string;
    message: string;
    model: string;
    provider: ProviderInfo;
    streamOutput?: boolean;
  }>();

  const { name: providerName } = provider;

  // validate 'model' and 'provider' fields
  if (!model || typeof model !== 'string') {
    throw new Response('Invalid or missing model', {
      status: 400,
      statusText: 'Bad Request',
    });
  }

  if (!providerName || typeof providerName !== 'string') {
    throw new Response('Invalid or missing provider', {
      status: 400,
      statusText: 'Bad Request',
    });
  }

  const cookieHeader = request.headers.get('Cookie');
  const apiKeys = getApiKeysFromCookie(cookieHeader);
  const providerSettings = getProviderSettingsFromCookie(cookieHeader);

  if (streamOutput) {
    try {
      const result = await streamText({
        messages: [
          {
            role: 'system',
            content: system,
          },
          {
            role: 'user',
            content: message,
          },
        ],
        env: context.cloudflare?.env as any,
        apiKeys,
        providerSettings,
      });

      return new Response(result.textStream, {
        status: 200,
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
        },
      });
    } catch (error: unknown) {
      console.log(error);

      if (error instanceof Error && error.message?.includes('API key')) {
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
  } else {
    try {
      const models = await getModelList({ apiKeys, providerSettings, serverEnv: context.cloudflare?.env as any });
      const modelDetails = models.find((m: ModelInfo) => m.name === model);

      if (!modelDetails) {
        throw new Error('Model not found');
      }

      const dynamicMaxTokens = modelDetails && modelDetails.maxTokenAllowed ? modelDetails.maxTokenAllowed : MAX_TOKENS;

      const providerInfo = PROVIDER_LIST.find((p) => p.name === provider.name);

      if (!providerInfo) {
        throw new Error('Provider not found');
      }

      const llmManager = LLMManager.getInstance(import.meta.env);
      const llm = await provider.getModelInstance({
        model,
        serverEnv: context.cloudflare?.env as any,
        apiKeys,
        providerSettings,
      });

      const response = await llm.doStream({
        inputFormat: 'messages',
        mode: {
          type: 'regular'
        },
        prompt: [
          {
            role: 'system' as const,
            content: system,
          },
          {
            role: 'user' as const,
            content: [{
              type: 'text' as const,
              text: message,
            }],
          },
        ],
        maxTokens: dynamicMaxTokens,
      });

      // Transform the stream to ensure compatibility
      const transformedStream = transformStream(response.stream);

      return new Response(
        new ReadableStream({
          async start(controller) {
            const reader = transformedStream.getReader();
            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) {
                  controller.close();
                  break;
                }
                if ('textDelta' in value) {
                  controller.enqueue(value.textDelta);
                }
              }
            } catch (e) {
              controller.error(e);
            }
          }
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
          },
        }
      );
    } catch (error: unknown) {
      console.log(error);

      if (error instanceof Error && error.message?.includes('API key')) {
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
}
