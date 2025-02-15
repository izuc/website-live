import { BaseProvider, getOpenAILikeModel } from '~/lib/modules/llm/base-provider';
import type { ModelInfo } from '~/lib/modules/llm/types';
import type { IProviderSetting } from '~/types/model';
import type { LanguageModelV1, LanguageModelV1Message, LanguageModelV1ProviderMetadata } from '@ai-sdk/provider';
import { wrapLanguageModel } from '../stream-transformer';

export default class OpenAILikeProvider extends BaseProvider {
  name = 'OpenAI-Like';
  getApiKeyLink = 'https://platform.openai.com/api-keys';
  labelForGetApiKey = 'Get OpenAI API Key';
  icon = 'i-ph:brain';

  config = {
    apiTokenKey: 'OPENAI_API_KEY',
  };

  staticModels: ModelInfo[] = [];

  async getDynamicModels(
    serverEnv: Env,
    apiKeys?: Record<string, string>,
    providerSettings?: Record<string, IProviderSetting>,
  ): Promise<ModelInfo[]> {
    const { baseUrl, apiKey } = this.getProviderBaseUrlAndKey({
      apiKeys,
      providerSettings,
      serverEnv,
      defaultBaseUrlKey: '',
      defaultApiTokenKey: 'OPENAI_API_KEY',
    });

    if (!baseUrl || !apiKey) {
      return [];
    }

    const response = await fetch(`${baseUrl}/models`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    const res = (await response.json()) as any;

    return res.data.map((model: any) => ({
      name: model.id,
      label: model.id,
      provider: this.name,
      maxTokenAllowed: 8000,
    }));
  }

  getModelInstance({
    model,
    serverEnv,
    apiKeys,
    providerSettings,
  }: {
    model: string;
    serverEnv?: Env;
    apiKeys?: Record<string, string>;
    providerSettings?: Record<string, IProviderSetting>;
  }): LanguageModelV1 {
    const { baseUrl, apiKey } = this.getProviderBaseUrlAndKey({
      apiKeys,
      providerSettings: providerSettings?.[this.name],
      serverEnv: serverEnv as any,
      defaultBaseUrlKey: 'OPENAI_LIKE_API_BASE_URL',
      defaultApiTokenKey: 'OPENAI_LIKE_API_KEY',
    });

    if (!baseUrl || !apiKey) {
      throw new Error(`Missing configuration for ${this.name} provider`);
    }

    const openai = getOpenAILikeModel(baseUrl, apiKey, model);
    return wrapLanguageModel(openai);
  }
}
