import type { LanguageModelV1 } from '@ai-sdk/provider';
import type { IProviderSetting } from '~/types/model';
import { createOpenAI } from '@ai-sdk/openai';
import type { ModelInfo, ProviderInfo, ProviderOptions } from '~/lib/modules/llm/types';

interface GetModelInstanceParams {
  model: string;
  serverEnv: Env;
  apiKeys?: Record<string, string>;
  providerSettings?: Record<string, IProviderSetting>;
  options?: ProviderOptions;
}

interface ProviderConfig {
  apiTokenKey: string;
  baseUrlKey?: string;
}

export abstract class BaseProvider implements ProviderInfo {
  abstract name: string;
  abstract getApiKeyLink: string;
  abstract labelForGetApiKey: string;
  abstract icon: string;
  abstract config: ProviderConfig;
  abstract staticModels: ModelInfo[];

  abstract getModelInstance(params: GetModelInstanceParams): LanguageModelV1;

  getModelsFromCache(options: {
    apiKeys?: Record<string, string>;
    providerSettings?: Record<string, IProviderSetting>;
    serverEnv?: Record<string, string>;
  }): ModelInfo[] | null {
    return null;
  }

  storeDynamicModels(
    options: {
      apiKeys?: Record<string, string>;
      providerSettings?: Record<string, IProviderSetting>;
      serverEnv?: Record<string, string>;
    },
    models: ModelInfo[],
  ): void {
    // Default implementation does nothing
  }

  getProviderBaseUrlAndKey({
    apiKeys,
    providerSettings,
    serverEnv,
    defaultBaseUrlKey,
    defaultApiTokenKey,
  }: {
    apiKeys?: Record<string, string>;
    providerSettings?: IProviderSetting;
    serverEnv: Env;
    defaultBaseUrlKey?: string;
    defaultApiTokenKey?: string;
  }): { baseUrl?: string; apiKey?: string } {
    const apiKey =
      apiKeys?.[this.name] ??
      providerSettings?.apiKey ??
      (defaultApiTokenKey ? (serverEnv as any)[defaultApiTokenKey] : undefined);

    const baseUrl =
      providerSettings?.baseUrl ??
      (defaultBaseUrlKey ? (serverEnv as any)[defaultBaseUrlKey] : undefined);

    return { baseUrl, apiKey };
  }

  async getDynamicModels(
    serverEnv: Env,
    apiKeys?: Record<string, string>,
    providerSettings?: Record<string, IProviderSetting>,
  ): Promise<ModelInfo[]> {
    return [];
  }
}

type OptionalApiKey = string | undefined;

export function getOpenAILikeModel(baseURL: string, apiKey: OptionalApiKey, model: string) {
  const openai = createOpenAI({
    baseURL,
    apiKey,
  });

  return openai(model);
}
