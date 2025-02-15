import React from 'react';
import type { ModelInfo, ReasoningEffort } from '~/lib/modules/llm/types';
import type { ProviderInfo } from '~/types/model';

interface ModelSelectorProps {
  modelList: ModelInfo[];
  model: string;
  setModel?: (model: string) => void;
  provider?: ProviderInfo;
  setProvider?: (provider: ProviderInfo) => void;
  providerList: ProviderInfo[];
  apiKeys: Record<string, string>;
  modelLoading?: string;
  reasoningEffort?: ReasoningEffort;
  onReasoningEffortChange?: (effort: ReasoningEffort) => void;
}

export const ModelSelector = ({
  modelList,
  model,
  setModel,
  provider,
  setProvider,
  providerList,
  modelLoading,
  reasoningEffort,
  onReasoningEffortChange,
}: ModelSelectorProps) => {
  const selectedModelInfo = modelList.find(m => m.name === model);

  return (
    <div className="mb-2 flex gap-2 flex-col sm:flex-row">
      <select
        value={provider?.name ?? ''}
        onChange={(e) => {
          const newProvider = providerList.find((p: ProviderInfo) => p.name === e.target.value);

          if (newProvider && setProvider) {
            setProvider(newProvider);
          }

          const firstModel = [...modelList].find((m) => m.provider === e.target.value);

          if (firstModel && setModel) {
            setModel(firstModel.name);
          }
        }}
        className="flex-1 p-2 rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-prompt-background text-bolt-elements-textPrimary focus:outline-none focus:ring-2 focus:ring-bolt-elements-focus transition-all"
      >
        {providerList.map((provider: ProviderInfo) => (
          <option key={provider.name} value={provider.name}>
            {provider.name}
          </option>
        ))}
      </select>
      <select
        key={provider?.name}
        value={model}
        onChange={(e) => setModel?.(e.target.value)}
        className="flex-1 p-2 rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-prompt-background text-bolt-elements-textPrimary focus:outline-none focus:ring-2 focus:ring-bolt-elements-focus transition-all lg:max-w-[70%]"
        disabled={modelLoading === 'all' || modelLoading === provider?.name}
      >
        {modelLoading === 'all' || modelLoading === provider?.name ? (
          <option key={0} value="">
            Loading...
          </option>
        ) : (
          [...modelList]
            .filter((e) => e.provider === provider?.name && e.name)
            .map((modelOption, index) => (
              <option key={index} value={modelOption.name}>
                {modelOption.label}
              </option>
            ))
        )}
      </select>
      {selectedModelInfo?.supportsReasoning && (
        <select
          value={reasoningEffort || 'medium'}
          onChange={(e) => onReasoningEffortChange?.(e.target.value as ReasoningEffort)}
          className="flex-1 p-2 rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-prompt-background text-bolt-elements-textPrimary focus:outline-none focus:ring-2 focus:ring-bolt-elements-focus transition-all"
        >
          <option value="low">Low Reasoning</option>
          <option value="medium">Medium Reasoning</option>
          <option value="high">High Reasoning</option>
        </select>
      )}
    </div>
  );
};
