import type { ModelInfo, ProviderInfo as LLMProviderInfo } from '~/lib/modules/llm/types';

// Re-export the ProviderInfo type from llm/types.ts
export type { ProviderInfo } from '~/lib/modules/llm/types';

export interface IProviderSetting {
  baseUrl?: string;
  apiKey?: string;
  models?: string[];
  defaultModel?: string;
}

export type IProviderConfig = LLMProviderInfo & {
  settings: IProviderSetting;
};
