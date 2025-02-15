import type { IProviderSetting } from '~/types/model';
import { BaseProvider } from './base-provider';
import type { ModelInfo, ProviderInfo } from './types';
import * as providers from './registry';
import { createScopedLogger } from '~/utils/logger';
import type { Env } from '~/lib/.server/llm/select-context';

const logger = createScopedLogger('LLMManager');
export class LLMManager {
  private static _instance: LLMManager;
  private _providers: Map<string, BaseProvider> = new Map();
  private _modelList: ModelInfo[] = [];
  private readonly _env: any = {};
  private modelCache: Map<string, ModelInfo[]> = new Map();

  private constructor(_env: Record<string, string>) {
    this._registerProvidersFromDirectory();
    this._env = _env;
  }

  static getInstance(env: Record<string, string> = {}): LLMManager {
    if (!LLMManager._instance) {
      LLMManager._instance = new LLMManager(env);
    }

    return LLMManager._instance;
  }
  get env() {
    return this._env;
  }

  private async _registerProvidersFromDirectory() {
    try {
      /*
       * Dynamically import all files from the providers directory
       * const providerModules = import.meta.glob('./providers/*.ts', { eager: true });
       */

      // Look for exported classes that extend BaseProvider
      for (const exportedItem of Object.values(providers)) {
        if (typeof exportedItem === 'function' && exportedItem.prototype instanceof BaseProvider) {
          const provider = new exportedItem();

          try {
            this.registerProvider(provider);
          } catch (error: any) {
            logger.warn('Failed To Register Provider: ', provider.name, 'error:', error.message);
          }
        }
      }
    } catch (error) {
      logger.error('Error registering providers:', error);
    }
  }

  registerProvider(provider: BaseProvider) {
    if (this._providers.has(provider.name)) {
      logger.warn(`Provider ${provider.name} is already registered. Skipping.`);
      return;
    }

    logger.info('Registering Provider: ', provider.name);
    this._providers.set(provider.name, provider);
    this._modelList = [...this._modelList, ...provider.staticModels];
  }

  getProvider(name: string): BaseProvider | undefined {
    return this._providers.get(name);
  }

  getAllProviders(): BaseProvider[] {
    return Array.from(this._providers.values());
  }

  getModelList(): ModelInfo[] {
    return this._modelList;
  }

  async updateModelList(options: {
    apiKeys?: Record<string, string>;
    providerSettings?: Record<string, IProviderSetting>;
    serverEnv?: Env;
  }): Promise<ModelInfo[]> {
    const { apiKeys, providerSettings, serverEnv } = options;

    let enabledProviders = Array.from(this._providers.values()).map((p) => p.name);

    if (providerSettings && Object.keys(providerSettings).length > 0) {
      enabledProviders = enabledProviders.filter((p) => providerSettings[p].enabled);
    }

    // Get dynamic models from all providers that support them
    const dynamicModels = await Promise.all(
      Array.from(this._providers.values())
        .filter((provider) => enabledProviders.includes(provider.name))
        .filter(
          (provider): provider is BaseProvider & Required<Pick<ProviderInfo, 'getDynamicModels'>> =>
            !!provider.getDynamicModels,
        )
        .map(async (provider) => {
          const cachedModels = provider.getModelsFromCache?.(options);

          if (cachedModels) {
            return cachedModels;
          }

          const dynamicModels = await provider
            .getDynamicModels(
              serverEnv || {} as Env,
              apiKeys,
              providerSettings ? { [provider.name]: providerSettings[provider.name] } : undefined
            )
            .then((models) => {
              logger.info(`Caching ${models.length} dynamic models for ${provider.name}`);
              provider.storeDynamicModels?.(options, models);

              return models;
            })
            .catch((err) => {
              logger.error(`Error getting dynamic models ${provider.name} :`, err);
              return [];
            });

          return dynamicModels;
        }),
    );

    // Combine static and dynamic models
    const modelList = [
      ...dynamicModels.flat(),
      ...Array.from(this._providers.values()).flatMap((p) => p.staticModels || []),
    ];
    this._modelList = modelList;

    return modelList;
  }
  getStaticModelList() {
    return [...this._providers.values()].flatMap((p) => p.staticModels || []);
  }
  async getModelListFromProvider(
    provider: ProviderInfo,
    options: {
      apiKeys?: Record<string, string>;
      providerSettings?: Record<string, IProviderSetting>;
      serverEnv?: Env;
    },
  ): Promise<ModelInfo[]> {
    const { apiKeys, providerSettings, serverEnv } = options;
    const providerSetting = providerSettings?.[provider.name];

    // Skip if provider is disabled
    if (providerSetting?.enabled === false) {
      return [];
    }

    // Check cache first
    const cachedModels = this.getModelsFromCache(provider, options);
    if (cachedModels) {
      return cachedModels;
    }

    try {
      const models = await provider.getDynamicModels(serverEnv || {} as Env, apiKeys, providerSettings);
      this.storeDynamicModels(provider, options, models);
      return models;
    } catch (error) {
      console.error(`Failed to fetch models for provider ${provider.name}:`, error);
      return [];
    }
  }
  getStaticModelListFromProvider(provider: ProviderInfo): ModelInfo[] {
    return provider.staticModels || [];
  }

  getDefaultProvider(): BaseProvider {
    const firstProvider = this._providers.values().next().value;

    if (!firstProvider) {
      throw new Error('No providers registered');
    }

    return firstProvider;
  }

  private getModelsFromCache(
    provider: ProviderInfo,
    options: {
      apiKeys?: Record<string, string>;
      providerSettings?: Record<string, IProviderSetting>;
      serverEnv?: Env;
    },
  ): ModelInfo[] | null {
    const cachedModels = provider.getModelsFromCache?.({
      apiKeys: options.apiKeys,
      providerSettings: options.providerSettings,
      serverEnv: options.serverEnv || {} as Env,
    });

    if (cachedModels) {
      this.modelCache.set(provider.name, cachedModels);
    }

    return cachedModels || null;
  }

  private storeDynamicModels(
    provider: ProviderInfo,
    options: {
      apiKeys?: Record<string, string>;
      providerSettings?: Record<string, IProviderSetting>;
      serverEnv?: Env;
    },
    models: ModelInfo[],
  ): void {
    this.modelCache.set(provider.name, models);
    provider.storeDynamicModels?.({
      apiKeys: options.apiKeys,
      providerSettings: options.providerSettings,
      serverEnv: options.serverEnv || {} as Env,
    }, models);
  }
}
