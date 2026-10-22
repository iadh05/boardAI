import { useStore } from 'zustand';
import { Panel } from '../../../../../core/ui/index.ts';
import { useBoardStore } from '../../../../board/index.ts';
import { sendFeedback } from '../../../api/sendFeedback.ts';
import type { SendMessageDeps } from '../../../api/sendMessage.ts';
import { chatAppDeps, useSendMessage } from '../../../api/useSendMessage.ts';
import { ProposalCard } from '../../proposal/index.ts';
import { useAutoScroll } from '../hooks/useAutoScroll.ts';
import { MessageInput } from './MessageInput.tsx';
import { MessageList } from './MessageList.tsx';

export type ConversationProps = {
  /** Injected for tests (a fresh store, a fake fetch); the app uses its real ones. */
  deps?: SendMessageDeps;
  /** The board whose proposal is shown and accepted (board module's public API). */
  board?: typeof useBoardStore;
};

/**
 * Organism: the assistant panel — the conversation, following the streaming answer, the AI's
 * pending proposal with Accept / Reject, and the input.
 */
export function Conversation({ deps = chatAppDeps, board = useBoardStore }: ConversationProps) {
  const messages = useStore(deps.chat, (s) => s.messages);
  const streaming = useStore(deps.chat, (s) => s.streaming);
  const error = useStore(deps.chat, (s) => s.error);
  const progress = useStore(deps.chat, (s) => s.progress);
  const proposal = useStore(board, (s) => s.proposal);
  const proposalError = useStore(board, (s) => s.proposalError);
  const { send, cancel } = useSendMessage(deps);
  // Follow new text, an error and a proposal too: they can arrive without the messages changing.
  const bodyRef = useAutoScroll<HTMLDivElement>(
    `${messages.length}:${messages.at(-1)?.content.length}:${error}:${proposal?.id}:${proposalError}`,
  );

  return (
    <Panel
      title="Assistant"
      bodyRef={bodyRef}
      footer={<MessageInput streaming={streaming} onSend={send} onStop={cancel} />}
    >
      <div className="flex flex-col gap-3">
        <MessageList messages={messages} streaming={streaming} error={error} progress={progress} />
        {proposal && (
          <ProposalCard
            summary={proposal.summary}
            error={proposalError}
            onAccept={() => {
              board.getState().acceptProposal();
              // Applied (else it stays, with its error): say so, for the user and the model.
              if (board.getState().proposal === null) {
                deps.chat.getState().addNote(`Accepted: ${proposal.summary}`);
                sendFeedback(deps.fetch, proposal, 'accepted'); // on its trace (M1-26c)
              }
            }}
            onReject={() => {
              board.getState().rejectProposal();
              deps.chat.getState().addNote(`Rejected: ${proposal.summary}`);
              sendFeedback(deps.fetch, proposal, 'rejected');
            }}
          />
        )}
      </div>
    </Panel>
  );
}
