import { BaseProvider } from '~/lib/modules/llm/base-provider';
import type { ModelInfo } from '~/lib/modules/llm/types';
import type { IProviderSetting } from '~/types/model';
import type { LanguageModelV1, LanguageModelV1Message, LanguageModelV1ProviderMetadata } from '@ai-sdk/provider';
import { createOpenAI } from '@ai-sdk/openai';
import { wrapLanguageModel } from '../stream-transformer';

export default class XAIProvider extends BaseProvider {
  name = 'XAI';
  getApiKeyLink = 'https://xai.com/api-keys';
  labelForGetApiKey = 'Get XAI API Key';
  icon = '/images/providers/xai.svg';

  config = {
    apiTokenKey: 'XAI_API_KEY',
  };

  staticModels: ModelInfo[] = [
    { name: 'grok-beta', label: 'xAI Grok Beta', provider: 'xAI', maxTokenAllowed: 8000 },
    { name: 'grok-2-1212', label: 'xAI Grok2 1212', provider: 'xAI', maxTokenAllowed: 8000 },
  ];

  getModelInstance(options: {
    model: string;
    serverEnv: Env;
    apiKeys?: Record<string, string>;
    providerSettings?: Record<string, IProviderSetting>;
  }): LanguageModelV1 {
    const { model, serverEnv, apiKeys, providerSettings } = options;

    const { apiKey } = this.getProviderBaseUrlAndKey({
      apiKeys,
      providerSettings: providerSettings?.[this.name],
      serverEnv: serverEnv as any,
      defaultBaseUrlKey: '',
      defaultApiTokenKey: 'XAI_API_KEY',
    });

    if (!apiKey) {
      throw new Error(`Missing API key for ${this.name} provider`);
    }

    const openai = createOpenAI({
      baseURL: 'https://api.x.ai/v1',
      apiKey,
    });

    const xai = openai(model);
    return wrapLanguageModel(xai);
  }
}
