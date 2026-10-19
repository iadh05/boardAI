import { useStore } from 'zustand';
import { Panel } from '../../../../../core/ui/index.ts';
import type { SendMessageDeps } from '../../../api/sendMessage.ts';
import { chatAppDeps, useSendMessage } from '../../../api/useSendMessage.ts';
import { useAutoScroll } from '../hooks/useAutoScroll.ts';
import { MessageInput } from './MessageInput.tsx';
import { MessageList } from './MessageList.tsx';

export type ConversationProps = {
  /** Injected for tests (a fresh store, a fake fetch); the app uses its real ones. */
  deps?: SendMessageDeps;
};

/** Organism: the assistant panel — the conversation, following the streaming answer, and the input. */
export function Conversation({ deps = chatAppDeps }: ConversationProps) {
  const messages = useStore(deps.chat, (s) => s.messages);
  const streaming = useStore(deps.chat, (s) => s.streaming);
  const error = useStore(deps.chat, (s) => s.error);
  const { send, cancel } = useSendMessage(deps);
  const bodyRef = useAutoScroll<HTMLDivElement>(messages);

  return (
    <Panel
      title="Assistant"
      bodyRef={bodyRef}
      footer={<MessageInput streaming={streaming} onSend={send} onStop={cancel} />}
    >
      <MessageList messages={messages} streaming={streaming} error={error} />
    </Panel>
  );
}
