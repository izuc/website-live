/*
 * @ts-nocheck
 * Preventing TS checks with files presented in the video for a better presentation.
 */
import type { Message } from 'ai';
import React, { type RefCallback, useEffect, useState } from 'react';
import { ClientOnly } from 'remix-utils/client-only';
import { Menu } from '~/components/sidebar/Menu.client';
import { IconButton } from '~/components/ui/IconButton';
import { Workbench } from '~/components/workbench/Workbench.client';
import { classNames } from '~/utils/classNames';
import { PROVIDER_LIST } from '~/utils/constants';
import { Messages } from './Messages.client';
import { SendButton } from './SendButton.client';
import { APIKeyManager, getApiKeysFromCookies } from './APIKeyManager';
import Cookies from 'js-cookie';
import * as Tooltip from '@radix-ui/react-tooltip';

import styles from './BaseChat.module.scss';
import { ExportChatButton } from '~/components/chat/chatExportAndImport/ExportChatButton';
import { ImportButtons } from '~/components/chat/chatExportAndImport/ImportButtons';
import GitCloneButton from './GitCloneButton';

import FilePreview from './FilePreview';
import { ModelSelector } from '~/components/chat/ModelSelector';
import { SpeechRecognitionButton } from '~/components/chat/SpeechRecognition';
import type { ProviderInfo } from '~/types/model';
import { ScreenshotStateManager } from './ScreenshotStateManager';
import { toast } from 'react-toastify';
import type { ActionAlert } from '~/types/actions';
import ChatAlert from './ChatAlert';
import type { ModelInfo } from '~/lib/modules/llm/types';

const TEXTAREA_MIN_HEIGHT = 76;

interface BaseChatProps {
  textareaRef?: React.RefObject<HTMLTextAreaElement> | undefined;
  messageRef?: RefCallback<HTMLDivElement> | undefined;
  scrollRef?: RefCallback<HTMLDivElement> | undefined;
  showChat?: boolean;
  chatStarted?: boolean;
  isStreaming?: boolean;
  messages?: Message[];
  description?: string;
  enhancingPrompt?: boolean;
  promptEnhanced?: boolean;
  input?: string;
  model?: string;
  setModel?: (model: string) => void;
  provider?: ProviderInfo;
  setProvider?: (provider: ProviderInfo) => void;
  providerList?: ProviderInfo[];
  handleStop?: () => void;
  sendMessage?: (event: React.UIEvent, messageInput?: string) => void;
  handleInputChange?: (event: React.ChangeEvent<HTMLTextAreaElement>) => void;
  enhancePrompt?: () => void;
  importChat?: (description: string, messages: Message[]) => Promise<void>;
  exportChat?: () => void;
  uploadedFiles?: File[];
  setUploadedFiles?: (files: File[]) => void;
  imageDataList?: string[];
  setImageDataList?: (dataList: string[]) => void;
  actionAlert?: ActionAlert;
  clearAlert?: () => void;
}

export const BaseChat = React.forwardRef<HTMLDivElement, BaseChatProps>(
  (
    {
      textareaRef,
      messageRef,
      scrollRef,
      showChat = true,
      chatStarted = false,
      isStreaming = false,
      model,
      setModel,
      provider,
      setProvider,
      providerList,
      input = '',
      enhancingPrompt,
      handleInputChange,

      // promptEnhanced,
      enhancePrompt,
      sendMessage,
      handleStop,
      importChat,
      exportChat,
      uploadedFiles = [],
      setUploadedFiles,
      imageDataList = [],
      setImageDataList,
      messages,
      actionAlert,
      clearAlert,
    },
    ref,
  ) => {
    const TEXTAREA_MAX_HEIGHT = chatStarted ? 400 : 200;
    const [apiKeys, setApiKeys] = useState<Record<string, string>>(getApiKeysFromCookies());
    const [modelList, setModelList] = useState<ModelInfo[]>([]);
    const [isModelSettingsCollapsed, setIsModelSettingsCollapsed] = useState(false);
    const [isListening, setIsListening] = useState(false);
    const [recognition, setRecognition] = useState<SpeechRecognition | null>(null);
    const [transcript, setTranscript] = useState('');
    const [isModelLoading, setIsModelLoading] = useState<string | undefined>('all');

    useEffect(() => {
      console.log(transcript);
    }, [transcript]);

    useEffect(() => {
      if (typeof window !== 'undefined' && ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)) {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;

        recognition.onresult = (event) => {
          const transcript = Array.from(event.results)
            .map((result) => result[0])
            .map((result) => result.transcript)
            .join('');

          setTranscript(transcript);

          if (handleInputChange) {
            const syntheticEvent = {
              target: { value: transcript },
            } as React.ChangeEvent<HTMLTextAreaElement>;
            handleInputChange(syntheticEvent);
          }
        };

        recognition.onerror = (event) => {
          console.error('Speech recognition error:', event.error);
          setIsListening(false);
        };

        setRecognition(recognition);
      }
    }, []);

    useEffect(() => {
      if (typeof window !== 'undefined') {
        let parsedApiKeys: Record<string, string> | undefined = {};

        try {
          parsedApiKeys = getApiKeysFromCookies();
          setApiKeys(parsedApiKeys);
        } catch (error) {
          console.error('Error loading API keys from cookies:', error);
          Cookies.remove('apiKeys');
        }

        setIsModelLoading('all');
        fetch('/api/models')
          .then((response) => response.json())
          .then((data) => {
            const typedData = data as { modelList: ModelInfo[] };
            setModelList(typedData.modelList);
          })
          .catch((error) => {
            console.error('Error fetching model list:', error);
          })
          .finally(() => {
            setIsModelLoading(undefined);
          });
      }
    }, [providerList, provider]);

    const onApiKeysChange = async (providerName: string, apiKey: string) => {
      const newApiKeys = { ...apiKeys, [providerName]: apiKey };
      setApiKeys(newApiKeys);
      Cookies.set('apiKeys', JSON.stringify(newApiKeys));

      setIsModelLoading(providerName);

      let providerModels: ModelInfo[] = [];

      try {
        const response = await fetch(`/api/models/${encodeURIComponent(providerName)}`);
        const data = await response.json();
        providerModels = (data as { modelList: ModelInfo[] }).modelList;
      } catch (error) {
        console.error('Error loading dynamic models for:', providerName, error);
      }

      // Only update models for the specific provider
      setModelList((prevModels) => {
        const otherModels = prevModels.filter((model) => model.provider !== providerName);
        return [...otherModels, ...providerModels];
      });
      setIsModelLoading(undefined);
    };

    const startListening = () => {
      if (recognition) {
        recognition.start();
        setIsListening(true);
      }
    };

    const stopListening = () => {
      if (recognition) {
        recognition.stop();
        setIsListening(false);
      }
    };

    const handleSendMessage = (event: React.UIEvent, messageInput?: string) => {
      if (sendMessage) {
        sendMessage(event, messageInput);

        if (recognition) {
          recognition.abort(); // Stop current recognition
          setTranscript(''); // Clear transcript
          setIsListening(false);

          // Clear the input by triggering handleInputChange with empty value
          if (handleInputChange) {
            const syntheticEvent = {
              target: { value: '' },
            } as React.ChangeEvent<HTMLTextAreaElement>;
            handleInputChange(syntheticEvent);
          }
        }
      }
    };

    const handleFileUpload = () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';

      input.onchange = async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];

        if (file) {
          const reader = new FileReader();

          reader.onload = (e) => {
            const base64Image = e.target?.result as string;
            setUploadedFiles?.([...uploadedFiles, file]);
            setImageDataList?.([...imageDataList, base64Image]);
          };
          reader.readAsDataURL(file);
        }
      };

      input.click();
    };

    const handlePaste = async (e: React.ClipboardEvent) => {
      const items = e.clipboardData?.items;

      if (!items) {
        return;
      }

      for (const item of items) {
        if (item.type.startsWith('image/')) {
          e.preventDefault();

          const file = item.getAsFile();

          if (file) {
            const reader = new FileReader();

            reader.onload = (e) => {
              const base64Image = e.target?.result as string;
              setUploadedFiles?.([...uploadedFiles, file]);
              setImageDataList?.([...imageDataList, base64Image]);
            };
            reader.readAsDataURL(file);
          }

          break;
        }
      }
    };

    const baseChat = (
      <div
        ref={ref}
        className={classNames(styles.BaseChat, 'relative flex h-full w-full overflow-hidden')}
        data-chat-visible={showChat}
      >
        <ClientOnly>{() => <Menu />}</ClientOnly>
        <div ref={scrollRef} className="flex flex-col lg:flex-row overflow-y-auto w-full h-full">
          <div className={classNames(styles.Chat, 'flex flex-col flex-grow lg:min-w-[var(--chat-min-width)] h-full')}>
            {!chatStarted && (
              <>
                <div id="intro" className="min-h-fit py-16 w-full max-w-[90rem] mx-auto text-center px-4 lg:px-8">
                  <div className="space-y-8 relative">
                    {/* Background effects */}
                    <div className="absolute inset-0 -z-10 overflow-hidden">
                      {/* Main glow */}
                      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
                        <div className="w-[min(70vw,500px)] h-[min(70vw,500px)] bg-gradient-to-br from-accent-500/30 via-accent-500/5 to-transparent rounded-full blur-3xl opacity-30 animate-pulse"></div>
                      </div>

                      {/* Top accent */}
                      <div className="absolute -top-20 left-0 w-full h-[min(40vw,20rem)]">
                        <div className="absolute inset-0 bg-gradient-to-b from-blue-500/20 via-blue-500/5 to-transparent blur-3xl"></div>
                      </div>

                      {/* Bottom accent */}
                      <div className="absolute -bottom-20 left-0 w-full h-[min(40vw,20rem)]">
                        <div className="absolute inset-0 bg-gradient-to-t from-purple-500/20 via-purple-500/5 to-transparent blur-3xl"></div>
                      </div>

                      {/* Floating orbs */}
                      <div className="absolute top-1/4 left-1/4 w-24 h-24 bg-gradient-to-br from-accent-500/20 to-transparent rounded-full blur-2xl opacity-20 animate-float"></div>
                      <div className="absolute bottom-1/4 right-1/4 w-32 h-32 bg-gradient-to-bl from-blue-500/20 to-transparent rounded-full blur-2xl opacity-20 animate-float-delayed"></div>

                      {/* Subtle grid */}
                      <div className="absolute inset-0 bg-[linear-gradient(to_right,#1f2937_1px,transparent_1px),linear-gradient(to_bottom,#1f2937_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_50%,#000_70%,transparent_100%)] opacity-10"></div>
                    </div>

                    {/* Main content */}
                    <div className="space-y-4">
                      <div className="relative inline-block">
                        <h1 className="text-[min(10vw,4rem)] font-bold text-bolt-elements-textPrimary tracking-tight animate-fade-in">
                          Website
                          <span className="text-accent-500 inline-block hover:scale-105 transition-transform">
                            .Live
                          </span>
                        </h1>
                      </div>
                      <p className="text-[min(4vw,1.5rem)] text-bolt-elements-textSecondary animate-fade-in animation-delay-200 max-w-[min(90vw,36rem)] mx-auto leading-relaxed">
                        Transform your ideas into stunning websites with the power of AI
                      </p>
                    </div>

                    {/* Features */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 w-full max-w-[min(90vw,64rem)] mx-auto animate-fade-in animation-delay-300">
                      <div className="group px-4 py-3 rounded-xl bg-bolt-elements-background-depth-2/50 border border-bolt-elements-borderColor backdrop-blur-sm hover:bg-bolt-elements-background-depth-2 transition-all">
                        <div className="flex items-center gap-3">
                          <div className="flex items-center justify-center w-8 h-8 rounded-full bg-accent-500/10">
                            <div className="i-ph:sparkle text-lg text-accent-500 group-hover:scale-110 transition-transform"></div>
                          </div>
                          <div className="text-left">
                            <h3 className="text-sm font-semibold text-bolt-elements-textPrimary">AI-Powered</h3>
                            <p className="text-xs text-bolt-elements-textSecondary">Build websites faster with AI</p>
                          </div>
                        </div>
                      </div>
                      <div className="group px-4 py-3 rounded-xl bg-bolt-elements-background-depth-2/50 border border-bolt-elements-borderColor backdrop-blur-sm hover:bg-bolt-elements-background-depth-2 transition-all">
                        <div className="flex items-center gap-3">
                          <div className="flex items-center justify-center w-8 h-8 rounded-full bg-accent-500/10">
                            <div className="i-ph:code text-lg text-accent-500 group-hover:scale-110 transition-transform"></div>
                          </div>
                          <div className="text-left">
                            <h3 className="text-sm font-semibold text-bolt-elements-textPrimary">Modern Stack</h3>
                            <p className="text-xs text-bolt-elements-textSecondary">Best practices built-in</p>
                          </div>
                        </div>
                      </div>
                      <div className="group px-4 py-3 rounded-xl bg-bolt-elements-background-depth-2/50 border border-bolt-elements-borderColor backdrop-blur-sm hover:bg-bolt-elements-background-depth-2 transition-all">
                        <div className="flex items-center gap-3">
                          <div className="flex items-center justify-center w-8 h-8 rounded-full bg-accent-500/10">
                            <div className="i-ph:rocket-launch text-lg text-accent-500 group-hover:scale-110 transition-transform"></div>
                          </div>
                          <div className="text-left">
                            <h3 className="text-sm font-semibold text-bolt-elements-textPrimary">Instant Deploy</h3>
                            <p className="text-xs text-bolt-elements-textSecondary">Go live in minutes</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="fixed bottom-4 w-full text-center">
                  <p className="text-sm text-bolt-elements-textTertiary">
                    Created by{' '}
                    <a
                      href="https://lance.name"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-accent-500 hover:text-accent-600 transition-colors font-medium"
                    >
                      Lance
                    </a>
                  </p>
                </div>
              </>
            )}
            <div
              className={classNames('pt-6 px-4 sm:px-6 lg:px-8 w-full', {
                'h-full flex flex-col': chatStarted,
              })}
            >
              <ClientOnly>
                {() => {
                  return chatStarted ? (
                    <Messages
                      ref={messageRef}
                      className="flex flex-col w-full flex-1 max-w-[90rem] pb-6 mx-auto z-1"
                      messages={messages}
                      isStreaming={isStreaming}
                    />
                  ) : null;
                }}
              </ClientOnly>
              <div
                className={classNames('flex flex-col gap-4 w-full max-w-[90rem] mx-auto z-prompt mb-6', {
                  'sticky bottom-2': chatStarted,
                })}
              >
                <div className="bg-bolt-elements-background-depth-2">
                  {actionAlert && (
                    <ChatAlert
                      alert={actionAlert}
                      clearAlert={() => clearAlert?.()}
                      postMessage={(message) => {
                        sendMessage?.({} as any, message);
                        clearAlert?.();
                      }}
                    />
                  )}
                </div>
                <div
                  className={classNames(
                    'bg-bolt-elements-background-depth-2/80 backdrop-blur-lg p-4 rounded-2xl border border-bolt-elements-borderColor/50 relative w-full max-w-[90rem] mx-auto z-prompt shadow-lg',
                  )}
                >
                  <div>
                    <ClientOnly>
                      {() => (
                        <div className={isModelSettingsCollapsed ? 'hidden' : ''}>
                          <ModelSelector
                            key={provider?.name + ':' + modelList.length}
                            model={model}
                            setModel={setModel}
                            modelList={modelList}
                            provider={provider}
                            setProvider={setProvider}
                            providerList={providerList || (PROVIDER_LIST as ProviderInfo[])}
                            apiKeys={apiKeys}
                            modelLoading={isModelLoading}
                          />
                          {(providerList || []).length > 0 && provider && (
                            <APIKeyManager
                              provider={provider}
                              apiKey={apiKeys[provider.name] || ''}
                              setApiKey={(key) => {
                                onApiKeysChange(provider.name, key);
                              }}
                            />
                          )}
                        </div>
                      )}
                    </ClientOnly>
                  </div>
                  <FilePreview
                    files={uploadedFiles}
                    imageDataList={imageDataList}
                    onRemove={(index) => {
                      setUploadedFiles?.(uploadedFiles.filter((_, i) => i !== index));
                      setImageDataList?.(imageDataList.filter((_, i) => i !== index));
                    }}
                  />
                  <ClientOnly>
                    {() => (
                      <ScreenshotStateManager
                        setUploadedFiles={setUploadedFiles}
                        setImageDataList={setImageDataList}
                        uploadedFiles={uploadedFiles}
                        imageDataList={imageDataList}
                      />
                    )}
                  </ClientOnly>
                  <div
                    className={classNames(
                      'relative border border-bolt-elements-borderColor/50 backdrop-blur-sm rounded-xl bg-bolt-elements-background-depth-1/50 shadow-inner transition-all duration-200 hover:border-accent-500/50 hover:bg-bolt-elements-background-depth-1/80 group',
                    )}
                  >
                    <textarea
                      ref={textareaRef}
                      className={classNames(
                        'w-full px-5 pt-4 pr-16 outline-none resize-none text-bolt-elements-textPrimary placeholder-bolt-elements-textTertiary bg-transparent text-sm rounded-xl transition-all duration-200',
                        'focus:ring-2 focus:ring-accent-500/20 focus:border-accent-500',
                      )}
                      onDragEnter={(e) => {
                        e.preventDefault();
                        e.currentTarget.style.border = '2px solid #1488fc';
                      }}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.currentTarget.style.border = '2px solid #1488fc';
                      }}
                      onDragLeave={(e) => {
                        e.preventDefault();
                        e.currentTarget.style.border = '1px solid var(--bolt-elements-borderColor)';
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        e.currentTarget.style.border = '1px solid var(--bolt-elements-borderColor)';

                        const files = Array.from(e.dataTransfer.files);
                        files.forEach((file) => {
                          if (file.type.startsWith('image/')) {
                            const reader = new FileReader();

                            reader.onload = (e) => {
                              const base64Image = e.target?.result as string;
                              setUploadedFiles?.([...uploadedFiles, file]);
                              setImageDataList?.([...imageDataList, base64Image]);
                            };
                            reader.readAsDataURL(file);
                          }
                        });
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          if (event.shiftKey) {
                            return;
                          }

                          event.preventDefault();

                          if (isStreaming) {
                            handleStop?.();
                            return;
                          }

                          // ignore if using input method engine
                          if (event.nativeEvent.isComposing) {
                            return;
                          }

                          handleSendMessage?.(event);
                        }
                      }}
                      value={input}
                      onChange={(event) => {
                        handleInputChange?.(event);
                      }}
                      onPaste={handlePaste}
                      style={{
                        minHeight: TEXTAREA_MIN_HEIGHT,
                        maxHeight: TEXTAREA_MAX_HEIGHT,
                      }}
                      placeholder="How can Website Live help you today?"
                      translate="no"
                    />
                    <ClientOnly>
                      {() => (
                        <SendButton
                          show={input.length > 0 || isStreaming || uploadedFiles.length > 0}
                          isStreaming={isStreaming}
                          disabled={!providerList || providerList.length === 0}
                          onClick={(event) => {
                            if (isStreaming) {
                              handleStop?.();
                              return;
                            }

                            if (input.length > 0 || uploadedFiles.length > 0) {
                              handleSendMessage?.(event);
                            }
                          }}
                        />
                      )}
                    </ClientOnly>
                    <div className="flex justify-between items-center text-sm px-4 pt-2 pb-3">
                      <div className="flex gap-2 items-center">
                        <IconButton
                          title="Upload file"
                          className="transition-all hover:bg-accent-500/10"
                          onClick={() => handleFileUpload()}
                        >
                          <div className="i-ph:paperclip text-xl group-hover:text-accent-500"></div>
                        </IconButton>
                        <IconButton
                          title="Enhance prompt"
                          disabled={input.length === 0 || enhancingPrompt}
                          className={classNames(
                            'transition-all hover:bg-accent-500/10',
                            enhancingPrompt ? 'opacity-100' : '',
                          )}
                          onClick={() => {
                            enhancePrompt?.();
                            toast.success('Prompt enhanced!');
                          }}
                        >
                          {enhancingPrompt ? (
                            <div className="i-svg-spinners:90-ring-with-bg text-bolt-elements-loader-progress text-xl animate-spin"></div>
                          ) : (
                            <div className="i-bolt:stars text-xl group-hover:text-accent-500"></div>
                          )}
                        </IconButton>

                        <SpeechRecognitionButton
                          isListening={isListening}
                          onStart={startListening}
                          onStop={stopListening}
                          disabled={isStreaming}
                        />
                        {chatStarted && <ClientOnly>{() => <ExportChatButton exportChat={exportChat} />}</ClientOnly>}
                        <IconButton
                          title="Model Settings"
                          className={classNames('transition-all flex items-center gap-1 hover:bg-accent-500/10', {
                            'bg-bolt-elements-item-backgroundAccent text-bolt-elements-item-contentAccent':
                              isModelSettingsCollapsed,
                            'bg-bolt-elements-item-backgroundDefault text-bolt-elements-item-contentDefault':
                              !isModelSettingsCollapsed,
                          })}
                          onClick={() => setIsModelSettingsCollapsed(!isModelSettingsCollapsed)}
                          disabled={!providerList || providerList.length === 0}
                        >
                          <div
                            className={`i-ph:caret-${isModelSettingsCollapsed ? 'right' : 'down'} text-lg group-hover:text-accent-500`}
                          />
                          {isModelSettingsCollapsed ? <span className="text-xs">{model}</span> : <span />}
                        </IconButton>
                      </div>
                      {input.length > 3 ? (
                        <div className="hidden sm:block text-xs text-bolt-elements-textTertiary">
                          Use{' '}
                          <kbd className="kdb px-1.5 py-0.5 rounded bg-bolt-elements-background-depth-2/80 border border-bolt-elements-borderColor/50">
                            Shift
                          </kbd>{' '}
                          +{' '}
                          <kbd className="kdb px-1.5 py-0.5 rounded bg-bolt-elements-background-depth-2/80 border border-bolt-elements-borderColor/50">
                            Return
                          </kbd>{' '}
                          for a new line
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="flex flex-col justify-center gap-5">
              {!chatStarted && (
                <div className="flex justify-center gap-2 pb-8">
                  {ImportButtons(importChat)}
                  <GitCloneButton importChat={importChat} />
                </div>
              )}
            </div>
          </div>
          <ClientOnly>{() => <Workbench chatStarted={chatStarted} isStreaming={isStreaming} />}</ClientOnly>
        </div>
      </div>
    );

    return <Tooltip.Provider delayDuration={200}>{baseChat}</Tooltip.Provider>;
  },
);
