/*
 * @ts-nocheck
 * Preventing TS checks with files presented in the video for a better presentation.
 */
import { useStore } from '@nanostores/react';
import type { Message } from 'ai';
import { useChat } from 'ai/react';
import { useAnimate } from 'framer-motion';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { cssTransition, toast, ToastContainer } from 'react-toastify';
import { useMessageParser, usePromptEnhancer, useShortcuts, useSnapScroll } from '~/lib/hooks';
import { description, useChatHistory } from '~/lib/persistence';
import { chatStore } from '~/lib/stores/chat';
import { workbenchStore } from '~/lib/stores/workbench';
import { DEFAULT_MODEL, DEFAULT_PROVIDER, PROMPT_COOKIE_KEY, PROVIDER_LIST } from '~/utils/constants';
import { cubicEasingFn } from '~/utils/easings';
import { createScopedLogger, renderLogger } from '~/utils/logger';
import { BaseChat } from './BaseChat';
import Cookies from 'js-cookie';
import { debounce } from '~/utils/debounce';
import { useSettings } from '~/lib/hooks/useSettings';
import type { ProviderInfo } from '~/types/model';
import { useSearchParams } from '@remix-run/react';
import { createSampler } from '~/utils/sampler';
import { getTemplates, selectStarterTemplate } from '~/utils/selectStarterTemplate';
import type { ReasoningEffort } from '~/lib/modules/llm/types';

const toastAnimation = cssTransition({
  enter: 'animated fadeInRight',
  exit: 'animated fadeOutRight',
});

const logger = createScopedLogger('Chat');

export function Chat() {
  renderLogger.trace('Chat');

  const { ready, initialMessages, storeMessageHistory, importChat, exportChat } = useChatHistory();
  const title = useStore(description);
  useEffect(() => {
    workbenchStore.setReloadedMessages(initialMessages.map((m) => m.id));
  }, [initialMessages]);

  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>('medium');

  return (
    <>
      {ready && (
        <ChatImpl
          description={title}
          initialMessages={initialMessages}
          exportChat={exportChat}
          storeMessageHistory={storeMessageHistory}
          importChat={importChat}
          reasoningEffort={reasoningEffort}
          onReasoningEffortChange={setReasoningEffort}
        />
      )}
      <ToastContainer
        closeButton={({ closeToast }) => {
          return (
            <button className="Toastify__close-button" onClick={closeToast}>
              <div className="i-ph:x text-lg" />
            </button>
          );
        }}
        icon={({ type }) => {
          /**
           * @todo Handle more types if we need them. This may require extra color palettes.
           */
          switch (type) {
            case 'success': {
              return <div className="i-ph:check-bold text-bolt-elements-icon-success text-2xl" />;
            }
            case 'error': {
              return <div className="i-ph:warning-circle-bold text-bolt-elements-icon-error text-2xl" />;
            }
          }

          return undefined;
        }}
        position="bottom-right"
        pauseOnFocusLoss
        transition={toastAnimation}
      />
    </>
  );
}

const processSampledMessages = createSampler(
  (options: {
    messages: Message[];
    initialMessages: Message[];
    isLoading: boolean;
    parseMessages: (messages: Message[], isLoading: boolean) => void;
    storeMessageHistory: (messages: Message[]) => Promise<void>;
  }) => {
    const { messages, initialMessages, isLoading, parseMessages, storeMessageHistory } = options;
    parseMessages(messages, isLoading);

    if (messages.length > initialMessages.length) {
      storeMessageHistory(messages).catch((error) => toast.error(error.message));
    }
  },
  50,
);

interface ChatProps {
  initialMessages: Message[];
  storeMessageHistory: (messages: Message[]) => Promise<void>;
  importChat: (description: string, messages: Message[]) => Promise<void>;
  exportChat: () => void;
  description?: string;
  reasoningEffort: ReasoningEffort;
  onReasoningEffortChange: (newEffort: ReasoningEffort) => void;
}

export const ChatImpl = memo(
  ({ description, initialMessages, storeMessageHistory, importChat, exportChat, reasoningEffort, onReasoningEffortChange }: ChatProps) => {
    useShortcuts();

    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const [chatStarted, setChatStarted] = useState(initialMessages.length > 0);
    const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
    const [imageDataList, setImageDataList] = useState<string[]>([]);
    const [searchParams, setSearchParams] = useSearchParams();
    const [fakeLoading, setFakeLoading] = useState(false);
    const [streamState, setStreamState] = useState<'idle' | 'streaming' | 'error' | 'completed'>('idle');
    const streamStateRef = useRef<'idle' | 'streaming' | 'error' | 'completed'>('idle');
    const loadingRef = useRef(false);
    const messageCountRef = useRef(0);
    const files = useStore(workbenchStore.files);
    const actionAlert = useStore(workbenchStore.alert);
    const { activeProviders, promptId, autoSelectTemplate, contextOptimizationEnabled } = useSettings();

    const [model, setModel] = useState(() => {
      const savedModel = Cookies.get('selectedModel');
      return savedModel || DEFAULT_MODEL;
    });
    const [provider, setProvider] = useState(() => {
      const savedProvider = Cookies.get('selectedProvider');
      return (PROVIDER_LIST.find((p) => p.name === savedProvider) || DEFAULT_PROVIDER) as ProviderInfo;
    });

    const { showChat } = useStore(chatStore);
    const [animationScope, animate] = useAnimate();
    const [apiKeys, setApiKeys] = useState<Record<string, string>>({});

    const { messages, isLoading, input, handleInputChange, setInput, stop, append, setMessages, reload, error } =
      useChat({
        api: '/api/chat',
        body: {
          apiKeys,
          files,
          promptId,
          contextOptimization: contextOptimizationEnabled,
          max_completion_tokens: model === 'o3-mini' ? 8000 : undefined,
          reasoningEffort,
          model,
          provider: provider.name
        },
        sendExtraMessageFields: true,
        id: Date.now().toString(),
        onResponse: (response) => {
          const currentState = {
            streamState: streamStateRef.current,
            messageCount: messages.length,
            isLoading,
            response: {
              ok: response.ok,
              status: response.status,
              contentType: response.headers.get('content-type')
            }
          };

          console.log('DEBUG: Response received:', currentState);
          logger.debug('Response received:', { state: currentState, timestamp: new Date().toISOString() });

          if (!response.ok) {
            const errorState = {
              error: 'Response not OK',
              status: response.status,
              streamState: 'error'
            };
            console.log('DEBUG: Stream error:', errorState);
            logger.debug('Stream error:', { ...errorState, timestamp: new Date().toISOString() });
            streamStateRef.current = 'error';
            setStreamState('error');
            loadingRef.current = false;
            return;
          }

          const contentType = response.headers.get('content-type');
          if (!contentType?.includes('text/event-stream')) {
            const errorState = {
              error: 'Invalid content type',
              contentType,
              streamState: 'error'
            };
            console.log('DEBUG: Stream error:', errorState);
            logger.debug('Stream error:', { ...errorState, timestamp: new Date().toISOString() });
            streamStateRef.current = 'error';
            setStreamState('error');
            loadingRef.current = false;
            return;
          }

          // Force streaming state
          streamStateRef.current = 'streaming';
          setStreamState('streaming');
          loadingRef.current = true;
          
          const streamingState = {
            messageCount: messages.length,
            streamState: 'streaming',
            isLoading: true
          };
          
          console.log('DEBUG: Started streaming:', streamingState);
          logger.debug('Started streaming:', { ...streamingState, timestamp: new Date().toISOString() });
        },
        onFinish: () => {
          const finishState = {
            currentState: streamStateRef.current,
            messageCount: messages.length,
            isLoading
          };
          
          console.log('DEBUG: Stream finished:', finishState);
          logger.debug('Stream finished:', { state: finishState, timestamp: new Date().toISOString() });

          // Keep streaming state until we're sure the message is complete
          setTimeout(() => {
            streamStateRef.current = 'completed';
            setStreamState('completed');
            loadingRef.current = false;

            setTimeout(() => {
              if (streamStateRef.current === 'completed') {
                streamStateRef.current = 'idle';
                setStreamState('idle');
                console.log('DEBUG: Reset to idle state after completion');
                logger.debug('Reset to idle state after completion', { timestamp: new Date().toISOString() });
              }
            }, 100);
          }, 50);
        },
        onError: (error) => {
          const errorState = {
            error: error.message,
            currentState: streamStateRef.current,
            messageCount: messages.length,
            isLoading
          };
          
          console.log('DEBUG: Stream error:', errorState);
          logger.debug('Stream error:', { state: errorState, timestamp: new Date().toISOString() });

          streamStateRef.current = 'error';
          setStreamState('error');
          loadingRef.current = false;
        }
      });

    // Initialize streaming state when message is being sent
    useEffect(() => {
      if (isLoading) {
        const loadingState = {
          previousState: streamStateRef.current,
          isLoading,
          newState: 'streaming'
        };
        
        console.log('DEBUG: Loading started, initializing streaming state:', loadingState);
        logger.debug('Loading started:', { state: loadingState, timestamp: new Date().toISOString() });

        // Force streaming state when loading starts
        streamStateRef.current = 'streaming';
        setStreamState('streaming');
        loadingRef.current = true;
      } else if (streamStateRef.current === 'streaming') {
        // When loading ends, transition to completed
        const completedState = {
          previousState: streamStateRef.current,
          isLoading,
          newState: 'completed'
        };
        
        console.log('DEBUG: Loading ended, transitioning to completed:', completedState);
        logger.debug('Loading ended:', { state: completedState, timestamp: new Date().toISOString() });

        streamStateRef.current = 'completed';
        setStreamState('completed');
        loadingRef.current = false;

        // Reset to idle after a short delay
        setTimeout(() => {
          if (streamStateRef.current === 'completed') {
            streamStateRef.current = 'idle';
            setStreamState('idle');
            console.log('DEBUG: Reset to idle state');
            logger.debug('Reset to idle state', { timestamp: new Date().toISOString() });
          }
        }, 100);
      }
    }, [isLoading]);

    // Track message count changes
    useEffect(() => {
      const messageState = {
        messageCount: messages.length,
        streamState: streamStateRef.current,
        isLoading,
        loadingRef: loadingRef.current
      };
      
      console.log('DEBUG: Message count updated:', messageState);
      logger.debug('Message count updated:', { state: messageState, timestamp: new Date().toISOString() });

      if (messages.length > messageCountRef.current) {
        streamStateRef.current = 'streaming';
        setStreamState('streaming');
        loadingRef.current = true;
      }
    }, [messages.length]);

    useEffect(() => {
      const prompt = searchParams.get('prompt');

      if (prompt) {
        setSearchParams({});
        runAnimation();
        append({
          role: 'user',
          content: [
            {
              type: 'text',
              text: `[Model: ${model}]\n\n[Provider: ${provider.name}]\n\n${prompt}`,
            },
          ] as any,
        });
      }
    }, [model, provider, searchParams]);

    const { enhancingPrompt, promptEnhanced, enhancePrompt, resetEnhancer } = usePromptEnhancer();
    const { parsedMessages, parseMessages } = useMessageParser();

    const TEXTAREA_MAX_HEIGHT = chatStarted ? 400 : 200;

    useEffect(() => {
      chatStore.setKey('started', initialMessages.length > 0);
    }, []);

    useEffect(() => {
      messageCountRef.current = messages.length;
      const logData = {
        messages: {
          count: messages.length,
          lastMessageRole: messages.length > 0 ? messages[messages.length - 1].role : null,
          lastMessageContent: messages.length > 0 ? JSON.stringify(messages[messages.length - 1].content) : null,
          allMessages: messages.map(m => ({
            role: m.role,
            contentPreview: typeof m.content === 'string' ? 
              m.content.substring(0, 100) : 
              JSON.stringify(m.content).substring(0, 100)
          }))
        },
        state: {
          isLoading,
          streamState: streamStateRef.current,
          loadingRef: loadingRef.current,
          messageCount: messages.length,
          timestamp: new Date().toISOString()
        }
      };
      logger.debug(`Message state updated: ${JSON.stringify(logData, null, 2)}`);
      
      processSampledMessages({
        messages,
        initialMessages,
        isLoading,
        parseMessages,
        storeMessageHistory,
      });
    }, [messages, isLoading, parseMessages]);

    const scrollTextArea = () => {
      const textarea = textareaRef.current;

      if (textarea) {
        textarea.scrollTop = textarea.scrollHeight;
      }
    };

    const handleStop = () => {
      logger.debug('Stopping stream:', {
        currentState: streamStateRef.current,
        timestamp: new Date().toISOString()
      });

      stop();
      streamStateRef.current = 'completed';
      setStreamState('completed');
      loadingRef.current = false;

      setTimeout(() => {
        if (streamStateRef.current === 'completed') {
          streamStateRef.current = 'idle';
          setStreamState('idle');
          logger.debug('Reset to idle after stop');
        }
      }, 100);
    };

    useEffect(() => {
      const textarea = textareaRef.current;

      if (textarea) {
        textarea.style.height = 'auto';

        const scrollHeight = textarea.scrollHeight;

        textarea.style.height = `${Math.min(scrollHeight, TEXTAREA_MAX_HEIGHT)}px`;
        textarea.style.overflowY = scrollHeight > TEXTAREA_MAX_HEIGHT ? 'auto' : 'hidden';
      }
    }, [input, textareaRef]);

    const runAnimation = async () => {
      if (chatStarted) {
        return;
      }

      try {
        const examplesElement = document.querySelector('#examples');
        const introElement = document.querySelector('#intro');

        if (examplesElement && introElement) {
          await Promise.all([
            animate('#examples', { opacity: 0, display: 'none' }, { duration: 0.1 }),
            animate('#intro', { opacity: 0, flex: 1 }, { duration: 0.2, ease: cubicEasingFn }),
          ]);
        }

        chatStore.setKey('started', true);
        setChatStarted(true);
      } catch (error) {
        console.warn('Animation failed, continuing without animation:', error);
        chatStore.setKey('started', true);
        setChatStarted(true);
      }
    };

    const transcribeImagesWithGPT4o = async (imageDataList: string[]) => {
      if (!imageDataList.length) return '';
      
      try {
        const gpt4oProvider = PROVIDER_LIST.find(p => p.name === 'OpenAI');
        if (!gpt4oProvider) throw new Error('OpenAI provider not found');
        
        await append({
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Please describe these images in detail for further processing.',
            },
            ...imageDataList.map(imageData => ({
              type: 'image',
              image: imageData,
            })),
          ] as any,
        });

        const response = messages[messages.length - 1];
        const transcription = typeof response.content === 'string' ? response.content : '';
        
        setMessages(messages.slice(0, -2));
        
        return transcription;
      } catch (error) {
        console.error('Error transcribing images:', error);
        toast.error('Failed to transcribe images. Proceeding without image context.');
        return '';
      }
    };

    const sendMessage = async (_event: React.UIEvent, messageInput?: string) => {
      const _input = messageInput || input;

      if (_input.length === 0 || isLoading) {
        const blockReason = {
          reason: _input.length === 0 ? 'empty input' : 'already loading'
        };
        
        console.log('DEBUG: Message send blocked:', blockReason);
        logger.debug('Message send blocked:', { ...blockReason, timestamp: new Date().toISOString() });
        return;
      }

      try {
        const prepState = {
          inputLength: _input.length,
          currentState: streamStateRef.current
        };
        
        console.log('DEBUG: Preparing to send message:', prepState);
        logger.debug('Preparing to send message:', { state: prepState, timestamp: new Date().toISOString() });

        // Force streaming state before sending
        streamStateRef.current = 'streaming';
        setStreamState('streaming');
        loadingRef.current = true;

        await workbenchStore.saveAllFiles();

        if (error) {
          setMessages(messages.slice(0, -1));
        }

        const messageContent = {
          role: 'user' as const,
          content: [
            {
              type: 'text',
              text: `[Model: ${model}]\n\n[Provider: ${provider.name}]\n\n${_input}`,
            },
          ] as any,
          id: Date.now().toString()
        };

        const sendState = {
          messageCount: messages.length + 1,
          streamState: 'streaming',
          isLoading: true
        };
        
        console.log('DEBUG: Sending message:', sendState);
        logger.debug('Sending message:', { state: sendState, timestamp: new Date().toISOString() });

        // Ensure streaming state is set before appending message
        streamStateRef.current = 'streaming';
        setStreamState('streaming');
        loadingRef.current = true;
        messageCountRef.current = messages.length;

        await append(messageContent);

        setInput('');
        Cookies.remove(PROMPT_COOKIE_KEY);
        setUploadedFiles([]);
        setImageDataList([]);
        resetEnhancer();
        textareaRef.current?.blur();

      } catch (error) {
        const errorState = {
          error: error instanceof Error ? error.message : String(error)
        };
        
        console.log('DEBUG: Error sending message:', errorState);
        logger.error('Error sending message:', { ...errorState, timestamp: new Date().toISOString() });

        streamStateRef.current = 'error';
        setStreamState('error');
        loadingRef.current = false;
        toast.error(error instanceof Error ? error.message : String(error));
      }
    };

    const onTextareaChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      handleInputChange(event);
    };

    const debouncedCachePrompt = useCallback(
      debounce((event: React.ChangeEvent<HTMLTextAreaElement>) => {
        const trimmedValue = event.target.value.trim();
        Cookies.set(PROMPT_COOKIE_KEY, trimmedValue, { expires: 30 });
      }, 1000),
      [],
    );

    const [messageRef, scrollRef] = useSnapScroll();

    useEffect(() => {
      const storedApiKeys = Cookies.get('apiKeys');

      if (storedApiKeys) {
        setApiKeys(JSON.parse(storedApiKeys));
      }
    }, []);

    const handleModelChange = (newModel: string) => {
      setModel(newModel);
      Cookies.set('selectedModel', newModel, { expires: 30 });
    };

    const handleProviderChange = (newProvider: ProviderInfo) => {
      setProvider(newProvider);
      Cookies.set('selectedProvider', newProvider.name, { expires: 30 });
    };

    return (
      <BaseChat
        ref={animationScope}
        textareaRef={textareaRef}
        input={input}
        showChat={showChat}
        chatStarted={chatStarted}
        isStreaming={isLoading || fakeLoading}
        enhancingPrompt={enhancingPrompt}
        promptEnhanced={promptEnhanced}
        sendMessage={sendMessage}
        model={model}
        setModel={handleModelChange}
        provider={provider}
        setProvider={handleProviderChange}
        providerList={activeProviders}
        messageRef={messageRef}
        scrollRef={scrollRef}
        handleInputChange={(e) => {
          onTextareaChange(e);
          debouncedCachePrompt(e);
        }}
        handleStop={handleStop}
        description={description}
        importChat={importChat}
        exportChat={exportChat}
        messages={messages.map((message, i) => {
          if (message.role === 'user') {
            return message;
          }

          return {
            ...message,
            content: parsedMessages[i] || '',
          };
        })}
        enhancePrompt={() => {
          enhancePrompt(
            input,
            (input) => {
              setInput(input);
              scrollTextArea();
            },
            model,
            provider,
            apiKeys,
          );
        }}
        uploadedFiles={uploadedFiles}
        setUploadedFiles={setUploadedFiles}
        imageDataList={imageDataList}
        setImageDataList={setImageDataList}
        actionAlert={actionAlert}
        clearAlert={() => workbenchStore.clearAlert()}
        reasoningEffort={reasoningEffort}
        onReasoningEffortChange={onReasoningEffortChange}
      />
    );
  },
);
