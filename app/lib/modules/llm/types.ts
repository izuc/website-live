import type { LanguageModelV1 } from '@ai-sdk/provider';
import type { IProviderSetting } from '~/types/model';

export type ReasoningEffort = 'low' | 'medium' | 'high';

export interface ModelInfo {
  name: string;
  label: string;
  provider: string;
  maxTokenAllowed: number;
  supportsReasoning?: boolean;
  supportsImages?: boolean;
}

export interface ProviderOptions {
  reasoning_effort?: ReasoningEffort;
  max_completion_tokens?: number;
}

export interface ProviderInfo {
  name: string;
  staticModels: ModelInfo[];
  getModelInstance: (options: {
    model: string;
    serverEnv: Env;
    apiKeys?: Record<string, string>;
    providerSettings?: Record<string, IProviderSetting>;
    options?: ProviderOptions;
  }) => LanguageModelV1;
  getApiKeyLink: string;
  labelForGetApiKey: string;
  icon: string;
  getDynamicModels(
    serverEnv: Env,
    apiKeys?: Record<string, string>,
    providerSettings?: Record<string, IProviderSetting>,
  ): Promise<ModelInfo[]>;
  getModelsFromCache?(options: {
    apiKeys?: Record<string, string>;
    providerSettings?: Record<string, IProviderSetting>;
    serverEnv?: Record<string, string>;
  }): ModelInfo[] | null;
  storeDynamicModels?(
    options: {
      apiKeys?: Record<string, string>;
      providerSettings?: Record<string, IProviderSetting>;
      serverEnv?: Record<string, string>;
    },
    models: ModelInfo[],
  ): void;
}

export interface ProviderConfig {
  baseUrlKey?: string;
  baseUrl?: string;
  apiTokenKey?: string;
}
