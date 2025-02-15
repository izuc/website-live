import { generateText, type CoreTool, type GenerateTextResult, type Message } from 'ai';
import ignore from 'ignore';
import type { IProviderSetting } from '~/types/model';
import { IGNORE_PATTERNS, type FileMap } from './constants';
import { DEFAULT_MODEL, DEFAULT_PROVIDER, PROVIDER_LIST } from '~/utils/constants';
import { createFilesContext, extractCurrentContext, extractPropertiesFromMessage, simplifyBoltActions } from './utils';
import { createScopedLogger } from '~/utils/logger';
import { LLMManager } from '~/lib/modules/llm/manager';
import type { Message as LocalMessage } from './utils';
import { wrapLanguageModel } from '~/lib/modules/llm/stream-transformer';
import type { LanguageModelV1, LanguageModelV1TextPart } from '@ai-sdk/provider';

// Define Env type based on what we know is required
export interface Env {
  DEFAULT_NUM_CTX: string;
  ANTHROPIC_API_KEY: string;
  OPENAI_API_KEY: string;
  GROQ_API_KEY: string;
  HuggingFace_API_KEY: string;
  OPEN_ROUTER_API_KEY: string;
  OLLAMA_API_BASE_URL: string;
  OPENAI_LIKE_API_KEY: string;
  OPENAI_LIKE_API_BASE_URL: string;
  TOGETHER_API_KEY: string;
  TOGETHER_API_BASE_URL: string;
  DEEPSEEK_API_KEY: string;
  LMSTUDIO_API_BASE_URL: string;
  GOOGLE_GENERATIVE_AI_API_KEY: string;
  MISTRAL_API_KEY: string;
  XAI_API_KEY: string;
  PERPLEXITY_API_KEY: string;
  AWS_BEDROCK_CONFIG: string;
  [key: string]: string;
}

// Common patterns to ignore, similar to .gitignore

const ig = ignore().add(IGNORE_PATTERNS);
const logger = createScopedLogger('select-context');

function isTextPart(part: any): part is LanguageModelV1TextPart {
  return part && part.type === 'text' && typeof part.text === 'string';
}

interface GenerateTextResponse {
  text: string;
}

function isGenerateTextResponse(response: any): response is GenerateTextResponse {
  return typeof response === 'object' && typeof response.text === 'string';
}

export async function selectContext({
  messages,
  env,
  apiKeys,
  files = {},
  providerSettings,
  promptId,
  contextOptimization = true,
  summary,
  onFinish,
}: {
  messages: LocalMessage[];
  env: Env;
  apiKeys: Record<string, string>;
  providerSettings: Record<string, IProviderSetting>;
  promptId?: string;
  files?: FileMap;
  contextOptimization?: boolean;
  summary?: string;
  onFinish?: (resp: GenerateTextResult<Record<string, CoreTool<any, any>>, never>) => void;
}): Promise<{ files: FileMap; summary?: string }> {
  let currentModel = DEFAULT_MODEL;
  let currentProvider = DEFAULT_PROVIDER.name;
  
  const processedMessages = messages.map((message) => {
    if (message.role === 'user') {
      const { model, provider, content } = extractPropertiesFromMessage(message as LocalMessage);
      currentModel = model;
      currentProvider = provider;
      return { ...message, content };
    } else if (message.role === 'assistant') {
      let content = message.content;
      if (contextOptimization) {
        content = typeof content === 'string' ? simplifyBoltActions(content) : content;
      }
      return { ...message, content };
    }
    return message;
  });

  const provider = PROVIDER_LIST.find((p) => p.name === currentProvider) || DEFAULT_PROVIDER;
  const staticModels = LLMManager.getInstance().getStaticModelListFromProvider(provider);
  let modelDetails = staticModels.find((m) => m.name === currentModel);

  if (!modelDetails) {
    const modelsList = [
      ...(provider.staticModels || []),
      ...(await LLMManager.getInstance().getModelListFromProvider(provider, {
        apiKeys,
        providerSettings,
        serverEnv: env,
      })),
    ];

    if (!modelsList.length) {
      throw new Error(`No models found for provider ${provider.name}`);
    }

    modelDetails = modelsList.find((m) => m.name === currentModel);

    if (!modelDetails) {
      logger.warn(
        `MODEL [${currentModel}] not found in provider [${provider.name}]. Falling back to first model. ${modelsList[0].name}`,
      );
      modelDetails = modelsList[0];
    }
  }

  const model = provider.getModelInstance({
    model: currentModel,
    serverEnv: env,
    apiKeys,
    providerSettings,
  });

  const wrappedModel = wrapLanguageModel(model);

  const resp = await (generateText as any)({
    system: `
      You are a software engineer. You are working on a project. You need to select files from the list of code file from the project that might be useful for the current request from the user.
      
      ${summary ? `Below is the Chat Summary till now:\n${summary}` : ''}
      
      RULES:
      * Only select files that are relevant to the current request.
      * Do not select files that are not relevant.
      * Do not select files that are not in the list.
      * Do not select files that are not code files.
      * Do not select files that are not in the project.
      * Do not select files that are not in the codebase.
      * Do not select files that are not in the repository.
      `,
    prompt: `
      Below is the list of files in the project:
      ${Object.keys(files)
        .map((path: string) => `- ${path}`)
        .join('\n')}
      
      Below is the chat history:
      ${processedMessages
        .map((message: LocalMessage) => {
          const content = Array.isArray(message.content)
            ? message.content.find(isTextPart)?.text || ''
            : message.content;
          return `---\n[${message.role}] ${content}\n---`;
        })
        .join('\n')}
      
      Please select files that might be useful for the current request.
      `,
    model: wrapLanguageModel(provider.getModelInstance({
      model: currentModel,
      serverEnv: env,
      apiKeys,
      providerSettings,
    })),
  });

  if (!isGenerateTextResponse(resp)) {
    throw new Error('Unexpected response format from generateText');
  }

  const selectedFiles = resp.text
    .split('\n')
    .filter((line: string) => line.trim().startsWith('-'))
    .map((line: string) => line.trim().replace(/^-\s*/, ''))
    .filter((path: string) => Object.keys(files).includes(path));

  const filteredFiles = Object.fromEntries(
    Object.entries(files).filter(([key]) => selectedFiles.includes(key))
  );

  if (onFinish) {
    onFinish(resp as any);
  }

  return { files: filteredFiles, summary: resp.text };
}

export function getFilePaths(files: FileMap) {
  let filePaths = Object.keys(files);
  filePaths = filePaths.filter((x) => {
    const relPath = x.replace('/home/project/', '');
    return !ig.ignores(relPath);
  });

  return filePaths;
}
