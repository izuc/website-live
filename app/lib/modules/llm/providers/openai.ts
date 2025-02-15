import { BaseProvider } from '~/lib/modules/llm/base-provider';
import type { ModelInfo, ProviderOptions } from '~/lib/modules/llm/types';
import type { IProviderSetting } from '~/types/model';
import type { LanguageModelV1 } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('openai-provider');

interface GetModelInstanceParams {
  model: string;
  serverEnv: Env;
  apiKeys?: Record<string, string>;
  providerSettings?: Record<string, IProviderSetting>;
  options?: ProviderOptions;
}

export default class OpenAIProvider extends BaseProvider {
  name = 'OpenAI';
  getApiKeyLink = 'https://platform.openai.com/api-keys';
  labelForGetApiKey = 'Get OpenAI API Key';
  icon = 'i-ph:brain';

  config = {
    apiTokenKey: 'OPENAI_API_KEY',
  };

  staticModels: ModelInfo[] = [
    { 
      name: 'o3-mini', 
      label: 'o3-mini (Reasoning Model)', 
      provider: 'OpenAI', 
      maxTokenAllowed: 100000,
      supportsReasoning: true,
      supportsImages: false
    },
    { 
      name: 'gpt-4o', 
      label: 'GPT-4o', 
      provider: 'OpenAI', 
      maxTokenAllowed: 8000,
      supportsImages: true
    },
    { 
      name: 'gpt-4o-mini', 
      label: 'GPT-4o Mini', 
      provider: 'OpenAI', 
      maxTokenAllowed: 8000,
      supportsImages: true
    },
    { 
      name: 'gpt-4-turbo', 
      label: 'GPT-4 Turbo', 
      provider: 'OpenAI', 
      maxTokenAllowed: 8000,
      supportsImages: true
    },
    { 
      name: 'gpt-4', 
      label: 'GPT-4', 
      provider: 'OpenAI', 
      maxTokenAllowed: 8000,
      supportsImages: true
    },
    { 
      name: 'gpt-3.5-turbo', 
      label: 'GPT-3.5 Turbo', 
      provider: 'OpenAI', 
      maxTokenAllowed: 8000,
      supportsImages: true
    },
  ];

  getModelInstance = ({ model, serverEnv, apiKeys, providerSettings, options }: GetModelInstanceParams): LanguageModelV1 => {
    logger.debug(`Getting model instance for ${model}`);

    const { apiKey } = this.getProviderBaseUrlAndKey({
      apiKeys,
      providerSettings: providerSettings?.[this.name],
      serverEnv: serverEnv as any,
      defaultBaseUrlKey: '',
      defaultApiTokenKey: 'OPENAI_API_KEY',
    });

    if (!apiKey) {
      logger.error('Missing OpenAI API key');
      throw new Error(`Missing API key for ${this.name} provider`);
    }

    // Create base OpenAI instance
    const openai = createOpenAI({ apiKey });

    // Create model instance with the configured options
    logger.debug(`Creating model instance for ${model} with options:`, options);
    const modelInstance = openai(model);

    // Wrap the doStream method to include options
    const originalDoStream = modelInstance.doStream;
    modelInstance.doStream = async (params: any) => {
      if (options?.reasoning_effort) {
        params.providerMetadata = {
          'ai-sdk': {
            reasoning_effort: options.reasoning_effort,
          },
          ...params.providerMetadata,
        };
      }
      if (options?.max_completion_tokens) {
        params.maxTokens = options.max_completion_tokens;
      }
      return originalDoStream.call(modelInstance, params);
    };

    return modelInstance;
  };
}
