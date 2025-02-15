import { generateText } from 'ai';
import type { IProviderSetting } from '~/types/model';
import { DEFAULT_MODEL, DEFAULT_PROVIDER, PROVIDER_LIST } from '~/utils/constants';
import { extractCurrentContext, extractPropertiesFromMessage, simplifyBoltActions, type Message } from './utils';
import { createScopedLogger } from '~/utils/logger';
import { LLMManager } from '~/lib/modules/llm/manager';
import type { LanguageModelV1Message, LanguageModelV1StreamPart } from '@ai-sdk/provider';
import { wrapLanguageModel } from '~/lib/modules/llm/stream-transformer';

const logger = createScopedLogger('create-summary');

export async function createSummary({
  messages,
  env,
  apiKeys,
  providerSettings,
  promptId,
  contextOptimization,
  onFinish,
}: {
  messages: Message[];
  env: any;
  apiKeys: Record<string, string>;
  providerSettings: Record<string, IProviderSetting>;
  promptId?: string;
  contextOptimization: boolean;
  onFinish?: (response: { usage?: { completionTokens?: number; promptTokens?: number; totalTokens?: number } }) => void;
}): Promise<string> {
  if (!env) {
    throw new Error('Server environment is required for creating summary');
  }

  let currentModel = DEFAULT_MODEL;
  let currentProvider = DEFAULT_PROVIDER.name;
  
  const processedMessages = messages.map((message) => {
    if (message.role === 'user') {
      const { model, provider, content } = extractPropertiesFromMessage(message);
      currentModel = model;
      currentProvider = provider;
      return { ...message, content };
    } else if (message.role === 'assistant') {
      let content = message.content;
      if (contextOptimization) {
        content = typeof content === 'string' ? simplifyBoltActions(content) : content;
      }
      return { ...message, content };
    }
    return message;
  });

  const provider = PROVIDER_LIST.find((p) => p.name === currentProvider) || DEFAULT_PROVIDER;
  const staticModels = LLMManager.getInstance().getStaticModelListFromProvider(provider);
  let modelDetails = staticModels.find((m) => m.name === currentModel);

  if (!modelDetails) {
    const modelsList = [
      ...(provider.staticModels || []),
      ...(await LLMManager.getInstance().getModelListFromProvider(provider, {
        apiKeys,
        providerSettings,
        serverEnv: env as any,
      })),
    ];

    if (!modelsList.length) {
      throw new Error(`No models found for provider ${provider.name}`);
    }

    modelDetails = modelsList.find((m) => m.name === currentModel);

    if (!modelDetails) {
      // Fallback to first model
      logger.warn(
        `MODEL [${currentModel}] not found in provider [${provider.name}]. Falling back to first model. ${modelsList[0].name}`,
      );
      modelDetails = modelsList[0];
    }
  }

  let slicedMessages = processedMessages;
  const { summary } = extractCurrentContext(processedMessages);
  let summaryText: string | undefined = undefined;
  let chatId: string | undefined = undefined;

  if (summary && summary.type === 'chatSummary') {
    chatId = summary.chatId;
    summaryText = `Below is the Chat Summary till now, this is chat summary before the conversation provided by the user 
you should also use this as historical message while providing the response to the user.        
${summary.summary}`;

    if (chatId) {
      let index = 0;

      for (let i = 0; i < processedMessages.length; i++) {
        if (processedMessages[i].id === chatId) {
          index = i;
          break;
        }
      }
      slicedMessages = processedMessages.slice(index + 1);
    }
  }

  const extractTextContent = (message: Message) =>
    Array.isArray(message.content)
      ? (message.content.find((item) => item.type === 'text')?.text as string) || ''
      : message.content;

  // select files from the list of code file from the project that might be useful for the current request from the user
  const resp = await (generateText as any)({
    system: `
        You are a software engineer. You are working on a project. tou need to summarize the work till now and provide a summary of the chat till now.

        ${summaryText} 
        
        RULES:
        * Only provide the summary of the chat till now.
        * Do not provide any new information.
        `,
    prompt: `
please provide a summary of the chat till now.
below is the latest chat:

---
${slicedMessages
  .map((x) => {
    return `---\n[${x.role}] ${extractTextContent(x)}\n---`;
  })
  .join('\n')}
---
`,
    model: wrapLanguageModel(provider.getModelInstance({
      model: currentModel,
      serverEnv: env,
      apiKeys,
      providerSettings,
    })),
  });

  const response = resp.text;

  if (onFinish) {
    onFinish(resp as any);
  }

  return response;
}
