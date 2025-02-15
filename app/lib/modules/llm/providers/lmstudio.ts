import { BaseProvider } from '~/lib/modules/llm/base-provider';
import type { ModelInfo, ProviderOptions } from '~/lib/modules/llm/types';
import type { IProviderSetting } from '~/types/model';
import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModelV1 } from 'ai';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('lmstudio-provider');

interface GetModelInstanceParams {
  model: string;
  serverEnv: Env;
  apiKeys?: Record<string, string>;
  providerSettings?: Record<string, IProviderSetting>;
  options?: ProviderOptions;
}

export default class LMStudioProvider extends BaseProvider {
  name = 'LMStudio';
  getApiKeyLink = 'https://lmstudio.ai/';
  labelForGetApiKey = 'Get LMStudio';
  icon = 'i-ph:cloud-arrow-down';

  config = {
    apiTokenKey: '',
    baseUrlKey: 'LMSTUDIO_BASE_URL',
  };

  staticModels: ModelInfo[] = [
    {
      name: 'local',
      label: 'Local Model',
      provider: 'LMStudio',
      maxTokenAllowed: 8000,
      supportsReasoning: true,
    },
  ];

  async getDynamicModels(
    serverEnv: Env,
    apiKeys?: Record<string, string>,
    providerSettings?: Record<string, IProviderSetting>,
  ): Promise<ModelInfo[]> {
    let { baseUrl } = this.getProviderBaseUrlAndKey({
      apiKeys,
      providerSettings: providerSettings?.[this.name],
      serverEnv,
      defaultBaseUrlKey: 'LMSTUDIO_BASE_URL',
      defaultApiTokenKey: '',
    });

    if (!baseUrl) {
      throw new Error('No baseUrl found for LMStudio provider');
    }

    if (typeof window === 'undefined') {
      /*
       * Running in Server
       * Backend: Check if we're running in Docker
       */
      const isDocker = process.env.RUNNING_IN_DOCKER === 'true';

      baseUrl = isDocker ? baseUrl.replace('localhost', 'host.docker.internal') : baseUrl;
      baseUrl = isDocker ? baseUrl.replace('127.0.0.1', 'host.docker.internal') : baseUrl;
    }

    logger.debug('LMStudio Base Url used: ', baseUrl);

    const response = await fetch(`${baseUrl}/v1/models`);
    const data = (await response.json()) as { data: Array<{ id: string }> };

    return data.data.map((model) => ({
      name: model.id,
      label: model.id,
      provider: this.name,
      maxTokenAllowed: 8000,
    }));
  }

  getModelInstance = ({ model, serverEnv, apiKeys, providerSettings, options }: GetModelInstanceParams): LanguageModelV1 => {
    const { baseUrl } = this.getProviderBaseUrlAndKey({
      apiKeys,
      providerSettings: providerSettings?.[this.name],
      serverEnv: serverEnv as any,
      defaultBaseUrlKey: 'LMSTUDIO_BASE_URL',
      defaultApiTokenKey: '',
    });

    if (!baseUrl) {
      throw new Error(`Missing base URL for ${this.name} provider`);
    }

    const openai = createOpenAI({ baseURL: baseUrl });
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
        params.max_tokens = options.max_completion_tokens;
      }
      return originalDoStream.call(modelInstance, params);
    };

    return modelInstance;
  };
}
