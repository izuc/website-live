import type { ModelInfo, ProviderInfo as LLMProviderInfo } from '~/lib/modules/llm/types';

// Re-export the ProviderInfo type from llm/types.ts
export type { ProviderInfo } from '~/lib/modules/llm/types';

export interface IProviderSetting {
  baseUrl?: string;
  apiKey?: string;
  models?: string[];
  defaultModel?: string;
  enabled?: boolean;
}

// Create a type that omits the methods from ProviderInfo
type ProviderInfoWithoutMethods = Omit<LLMProviderInfo, 'getModelInstance' | 'getDynamicModels' | 'getModelsFromCache' | 'storeDynamicModels'>;

// IProviderConfig now only requires the non-method properties
export interface IProviderConfig extends ProviderInfoWithoutMethods {
  settings: IProviderSetting;
}
