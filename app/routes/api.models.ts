import { type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { json } from '@remix-run/cloudflare';
import { LLMManager } from '~/lib/modules/llm/manager';
import type { ModelInfo, ProviderInfo } from '~/lib/modules/llm/types';
import type { IProviderSetting } from '~/types/model';
import { getApiKeysFromCookie, getProviderSettingsFromCookie } from '~/lib/api/cookies';
import type { Env } from '~/lib/.server/llm/select-context';

interface ModelsResponse {
  providers: ProviderInfo[];
  defaultProvider: ProviderInfo;
  modelList: ModelInfo[];
}

// Create a type that includes only the non-method properties of ProviderInfo
type ProviderInfoBasic = Pick<ProviderInfo, 'name' | 'staticModels' | 'getApiKeyLink' | 'labelForGetApiKey' | 'icon'>;

// Helper function to convert basic provider info to full provider info
function toProviderInfo(provider: ProviderInfoBasic): ProviderInfo {
  return {
    ...provider,
    getModelInstance: () => { throw new Error('Not implemented'); },
    getDynamicModels: async () => [],
  };
}

export const loader = async ({ request, context }: LoaderFunctionArgs) => {
  const cookieHeader = request.headers.get('Cookie');
  const apiKeys = getApiKeysFromCookie(cookieHeader);
  const providerSettings = getProviderSettingsFromCookie(cookieHeader);
  const serverEnv = context.env as Env;

  const llmManager = LLMManager.getInstance();

  const providers = llmManager.getAllProviders().map(provider => ({
    name: provider.name,
    staticModels: provider.staticModels,
    getApiKeyLink: provider.getApiKeyLink,
    labelForGetApiKey: provider.labelForGetApiKey,
    icon: provider.icon,
  })).map(toProviderInfo);

  const defaultProvider = providers[0];
  if (!defaultProvider) {
    throw new Error('No providers available');
  }

  const modelList = await llmManager.updateModelList({
    apiKeys,
    providerSettings,
    serverEnv,
  });

  const response: ModelsResponse = {
    providers,
    defaultProvider,
    modelList,
  };

  return json(response);
};
