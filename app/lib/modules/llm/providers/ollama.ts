import { BaseProvider } from '~/lib/modules/llm/base-provider';
import type { ModelInfo } from '~/lib/modules/llm/types';
import type { IProviderSetting } from '~/types/model';
import type { LanguageModelV1 } from '@ai-sdk/provider';
import { ollama } from 'ollama-ai-provider';
import { logger } from '~/utils/logger';

interface OllamaModelDetails {
  parent_model: string;
  format: string;
  family: string;
  families: string[];
  parameter_size: string;
  quantization_level: string;
}

export interface OllamaModel {
  name: string;
  model: string;
  modified_at: string;
  size: number;
  digest: string;
  details: OllamaModelDetails;
}

export interface OllamaApiResponse {
  models: OllamaModel[];
}

export const DEFAULT_NUM_CTX = process?.env?.DEFAULT_NUM_CTX ? parseInt(process.env.DEFAULT_NUM_CTX, 10) : 32768;

export default class OllamaProvider extends BaseProvider {
  name = 'Ollama';
  getApiKeyLink = 'https://ollama.com/download';
  labelForGetApiKey = 'Download Ollama';
  icon = 'i-ph:cloud-arrow-down';

  config = {
    baseUrlKey: 'OLLAMA_API_BASE_URL',
    apiTokenKey: 'OLLAMA_API_KEY'
  };

  staticModels: ModelInfo[] = [];

  async getDynamicModels(
    serverEnv: Env,
    apiKeys?: Record<string, string>,
    providerSettings?: Record<string, IProviderSetting>,
  ): Promise<ModelInfo[]> {
    const { baseUrl: initialBaseUrl } = this.getProviderBaseUrlAndKey({
      apiKeys,
      providerSettings,
      serverEnv,
      defaultBaseUrlKey: 'OLLAMA_API_BASE_URL',
    });

    if (!initialBaseUrl) {
      throw new Error('No baseUrl found for OLLAMA provider');
    }

    let baseUrl = initialBaseUrl;
    if (typeof window === 'undefined') {
      /*
       * Running in Server
       * Backend: Check if we're running in Docker
       */
      const isDocker = process.env.RUNNING_IN_DOCKER === 'true';

      if (isDocker) {
        baseUrl = baseUrl.replace('localhost', 'host.docker.internal');
        baseUrl = baseUrl.replace('127.0.0.1', 'host.docker.internal');
      }
    }

    const response = await fetch(`${baseUrl}/api/tags`);
    const data = (await response.json()) as OllamaApiResponse;

    // console.log({ ollamamodels: data.models });

    return data.models.map((model: OllamaModel) => ({
      name: model.name,
      label: `${model.name} (${model.details.parameter_size})`,
      provider: this.name,
      maxTokenAllowed: 8000,
    }));
  }
  getModelInstance: (options: {
    model: string;
    serverEnv: Env;
    apiKeys?: Record<string, string>;
    providerSettings?: Record<string, IProviderSetting>;
  }) => LanguageModelV1 = (options) => {
    const { apiKeys, providerSettings, serverEnv, model } = options;
    const { apiKey, baseUrl: initialBaseUrl } = this.getProviderBaseUrlAndKey({
      apiKeys,
      providerSettings: providerSettings?.[this.name],
      serverEnv: serverEnv as any,
      defaultBaseUrlKey: 'OLLAMA_API_BASE_URL',
      defaultApiTokenKey: 'OLLAMA_API_KEY',
    });

    let baseUrl = initialBaseUrl || 'http://localhost:11434';

    if (typeof process !== 'undefined') {
      const isDocker = process.env.RUNNING_IN_DOCKER === 'true';
      if (isDocker) {
        baseUrl = baseUrl.replace('localhost', 'host.docker.internal');
        baseUrl = baseUrl.replace('127.0.0.1', 'host.docker.internal');
      }
    }

    logger.debug('Ollama Base Url used: ', baseUrl);

    const ollamaInstance = ollama(model, {
      numCtx: DEFAULT_NUM_CTX,
    }) as LanguageModelV1 & { config: any };

    ollamaInstance.config.baseURL = `${baseUrl}/api`;

    return ollamaInstance;
  };
}
