import { memo } from 'react';
import type { Message, JSONValue } from 'ai';
import { Markdown } from './Markdown';
import type { ProgressAnnotation } from '~/types/context';
import Popover from '~/components/ui/Popover';
import { useMessageParser } from '~/lib/hooks/useMessageParser';
import { classNames } from '~/utils/classNames';

interface AssistantMessageProps {
  content: string;
  annotations?: JSONValue[];
  isStreaming?: boolean;
}

type ParsedAnnotation = {
  type: string;
  message?: string;
  value?: {
    totalTokens: number;
    promptTokens: number;
    completionTokens: number;
  };
}

function isRecord(value: JSONValue): value is Record<string, JSONValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidAnnotation(value: JSONValue): value is Record<string, JSONValue> {
  return isRecord(value) && typeof value.type === 'string';
}

export const AssistantMessage = memo(({ content, annotations, isStreaming }: AssistantMessageProps) => {
  const { parsedMessages } = useMessageParser();
  const parsedContent = content;

  const filteredAnnotations = annotations?.filter(isValidAnnotation) || [];

  const progressAnnotation = filteredAnnotations.filter(ann => ann.type === 'progress');
  const usage = filteredAnnotations.find(ann => ann.type === 'usage')?.value as ParsedAnnotation['value'];

  const messageClasses = [
    'prose prose-invert max-w-none',
    isStreaming ? 'animate-pulse' : ''
  ].filter(Boolean).join(' ');

  return (
    <div className={messageClasses}>
      <div className="flex items-center gap-2">
        <div className="flex items-center justify-center w-[34px] h-[34px] overflow-hidden bg-accent-500 text-white rounded-full shrink-0">
          <div className="i-ph:robot-fill text-xl"></div>
        </div>
      </div>
      <div className="mt-2">
        <Markdown html>{parsedContent}</Markdown>
      </div>
      <div className="overflow-hidden w-full">
        <>
          <div className="flex gap-2 items-center text-sm text-bolt-elements-textSecondary mb-2">
            {progressAnnotation.length > 0 && progressAnnotation[0].message && (
              <Popover trigger={<div className="i-ph:info" />}>{String(progressAnnotation[0].message)}</Popover>
            )}
            {usage && (
              <div>
                Tokens: {usage.totalTokens} (prompt: {usage.promptTokens}, completion: {usage.completionTokens})
              </div>
            )}
          </div>
        </>
      </div>
    </div>
  );
});
