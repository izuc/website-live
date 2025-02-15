import type {
  LanguageModelV1,
  LanguageModelV1Message,
  LanguageModelV1ProviderMetadata,
  LanguageModelV1TextPart,
  LanguageModelV1ImagePart,
  LanguageModelV1FilePart,
  LanguageModelV1ToolCallPart,
  LanguageModelV1ToolResultPart
} from '@ai-sdk/provider';
import { DEFAULT_MODEL, DEFAULT_PROVIDER, MODEL_REGEX, PROVIDER_REGEX } from '~/utils/constants';
import { IGNORE_PATTERNS, type FileMap } from './constants';
import ignore from 'ignore';
import type { ContextAnnotation } from '~/types/context';

// Define base message properties
export interface BaseMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | Array<LanguageModelV1TextPart | LanguageModelV1ToolCallPart | LanguageModelV1ToolResultPart>;
  id: string;
  providerMetadata?: LanguageModelV1ProviderMetadata;
  annotations?: Array<{
    type: string;
    [key: string]: any;
  }>;
}

// Define specific message types
export interface SystemMessage extends BaseMessage {
  role: 'system';
}

export interface UserMessage extends BaseMessage {
  role: 'user';
}

export interface AssistantMessage extends BaseMessage {
  role: 'assistant';
}

export interface ToolMessage extends BaseMessage {
  role: 'tool';
}

// Union type for all message types
export type Message = SystemMessage | UserMessage | AssistantMessage | ToolMessage;

// Helper function to convert to LanguageModelV1Message
export function toLanguageModelV1Message(message: Message): LanguageModelV1Message {
  const { role, content, providerMetadata } = message;
  
  if (typeof content === 'string') {
    return {
      role,
      content: [{
        type: 'text',
        text: content
      }],
      providerMetadata
    } as LanguageModelV1Message;
  }
  
  return {
    role,
    content,
    providerMetadata
  } as LanguageModelV1Message;
}

function isTextPart(item: LanguageModelV1TextPart | LanguageModelV1ImagePart | LanguageModelV1FilePart | LanguageModelV1ToolCallPart | LanguageModelV1ToolResultPart): item is LanguageModelV1TextPart {
  return item.type === 'text' && 'text' in item;
}

export function extractPropertiesFromMessage(message: Omit<Message, 'id'>): {
  model: string;
  provider: string;
  content: string;
} {
  let textContent = '';
  
  if (Array.isArray(message.content)) {
    const parts = message.content as (LanguageModelV1TextPart | LanguageModelV1ImagePart | LanguageModelV1FilePart | LanguageModelV1ToolCallPart | LanguageModelV1ToolResultPart)[];
    const textPart = parts.find(isTextPart);
    textContent = textPart?.text || '';
  } else {
    textContent = message.content as string;
  }

  const modelMatch = textContent.match(MODEL_REGEX);
  const providerMatch = textContent.match(PROVIDER_REGEX);

  const model = modelMatch?.[1] || DEFAULT_MODEL;
  const provider = providerMatch?.[1] || DEFAULT_PROVIDER.name;

  const cleanedContent = textContent.replace(MODEL_REGEX, '').replace(PROVIDER_REGEX, '');

  return { model, provider, content: cleanedContent };
}

export function simplifyBoltActions(input: string): string {
  // Using regex to match boltAction tags that have type="file"
  const regex = /(<boltAction[^>]*type="file"[^>]*>)([\s\S]*?)(<\/boltAction>)/g;

  // Replace each matching occurrence
  return input.replace(regex, (_0, openingTag, _2, closingTag) => {
    return `${openingTag}\n          ...\n        ${closingTag}`;
  });
}

export function createFilesContext(files: FileMap, useRelativePath?: boolean) {
  const ig = ignore().add(IGNORE_PATTERNS);
  let filePaths = Object.keys(files);
  filePaths = filePaths.filter((x) => {
    const relPath = x.replace('/home/project/', '');
    return !ig.ignores(relPath);
  });

  const fileContexts = filePaths
    .filter((x) => files[x] && files[x].type == 'file')
    .map((path) => {
      const dirent = files[path];

      if (!dirent || dirent.type == 'folder') {
        return '';
      }

      const codeWithLinesNumbers = dirent.content
        .split('\n')
        // .map((v, i) => `${i + 1}|${v}`)
        .join('\n');

      let filePath = path;

      if (useRelativePath) {
        filePath = path.replace('/home/project/', '');
      }

      return `<file path="${filePath}">\n${codeWithLinesNumbers}\n</file>`;
    });

  return `<codebase>${fileContexts.join('\n\n')}\n\n</codebase>`;
}

export function extractCurrentContext(messages: Message[]) {
  const lastAssistantMessage = messages.filter((x) => x.role == 'assistant').slice(-1)[0];

  if (!lastAssistantMessage) {
    return { summary: undefined, codeContext: undefined };
  }

  let summary: ContextAnnotation | undefined;
  let codeContext: ContextAnnotation | undefined;

  if (!lastAssistantMessage.annotations?.length) {
    return { summary: undefined, codeContext: undefined };
  }

  for (let i = 0; i < lastAssistantMessage.annotations.length; i++) {
    const annotation = lastAssistantMessage.annotations[i];

    if (!annotation || typeof annotation !== 'object') {
      continue;
    }

    if (!(annotation as any).type) {
      continue;
    }

    const annotationObject = annotation as any;

    if (annotationObject.type === 'codeContext') {
      codeContext = annotationObject;
      break;
    } else if (annotationObject.type === 'chatSummary') {
      summary = annotationObject;
      break;
    }
  }

  return { summary, codeContext };
}
