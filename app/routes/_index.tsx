import { json, type MetaFunction } from '@remix-run/cloudflare';
import { ClientOnly } from 'remix-utils/client-only';
import { BaseChat } from '~/components/chat/BaseChat';
import { Chat } from '~/components/chat/Chat.client';
import { Header } from '~/components/header/Header';
import BackgroundRays from '~/components/ui/BackgroundRays';

export const meta: MetaFunction = () => {
  return [
    { title: 'Website.Live' },
    { name: 'description', content: 'Talk with Website.Live, your AI-powered web development assistant' },
  ];
};

export const loader = () => json({});

export default function Index() {
  return (
    <div className="flex flex-col h-full w-full bg-bolt-elements-background-depth-1">
      <BackgroundRays />
      <Header />
      <ClientOnly fallback={<BaseChat />}>{() => <Chat />}</ClientOnly>
      <footer className="fixed bottom-4 w-full text-center">
        <p className="text-sm text-bolt-elements-textTertiary">
          Created by{' '}
          <a
            href="https://lance.name"
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent-500 hover:text-accent-600 transition-colors"
          >
            Lance
          </a>
        </p>
      </footer>
    </div>
  );
}
