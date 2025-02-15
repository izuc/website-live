import type { LanguageModelV1, LanguageModelV1StreamPart } from '@ai-sdk/provider';

// Transform stream parts to be compatible with version 1.0.2
function transformStreamPart(part: LanguageModelV1StreamPart): LanguageModelV1StreamPart {
  if (!part) return { type: 'text-delta', textDelta: '' };
  
  if (part.type === 'reasoning') {
    return {
      type: 'text-delta',
      textDelta: part.textDelta
    };
  }
  if (part.type === 'tool-call-delta') {
    return {
      type: 'text-delta',
      textDelta: `${part.toolName}(${part.argsTextDelta})`
    };
  }
  return part;
}

// Transform stream to be compatible with version 1.0.2
function transformStream(stream: ReadableStream<LanguageModelV1StreamPart> | undefined): ReadableStream<LanguageModelV1StreamPart> {
  if (!stream) {
    // Return an empty stream if the input stream is undefined
    return new ReadableStream({
      start(controller) {
        controller.close();
      }
    });
  }

  return new ReadableStream({
    async start(controller) {
      const reader = stream.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            controller.close();
            break;
          }
          controller.enqueue(transformStreamPart(value));
        }
      } catch (e) {
        console.error('Error in stream transformation:', e);
        controller.error(e);
      } finally {
        reader.releaseLock();
      }
    },
    cancel(reason) {
      console.log('Stream cancelled:', reason);
    }
  });
}

// Wrap a language model to transform its stream output
export function wrapLanguageModel(model: LanguageModelV1): LanguageModelV1 {
  if (!model) {
    throw new Error('Cannot wrap undefined language model');
  }

  const originalDoStream = model.doStream.bind(model);
  return {
    ...model,
    async doStream(...args: Parameters<LanguageModelV1['doStream']>) {
      try {
        const result = await originalDoStream(...args);
        return {
          ...result,
          stream: transformStream(result.stream)
        };
      } catch (error) {
        console.error('Error in doStream:', error);
        throw error;
      }
    }
  } as LanguageModelV1;
} 