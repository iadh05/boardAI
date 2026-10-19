import { useMutation } from '@tanstack/react-query';
import { useRef } from 'react';
import { currentBoard, showProposal } from '../../board/index.ts';
import { useChatStore } from '../store/chatStore.ts';
import { chatKeys } from './chatKeys.ts';
import { sendMessage, type SendMessageDeps } from './sendMessage.ts';

// Sending a chat message, as a React Query mutation (architecture §5.3). The answer itself goes
// to the chat store as it streams; the mutation only says whether a send is in flight.

const appDeps: SendMessageDeps = {
  fetch: (...args) => fetch(...args),
  chat: useChatStore,
  currentBoard,
  showProposal,
};

export const useSendMessage = (deps: SendMessageDeps = appDeps) => {
  // The request in flight, so "stop" can abort it (and the model with it, server side).
  const inFlight = useRef<AbortController | null>(null);
  const mutation = useMutation({
    mutationKey: chatKeys.send(),
    mutationFn: (text: string) => {
      inFlight.current = new AbortController();
      return sendMessage(text, deps, inFlight.current.signal);
    },
  });
  return {
    send: (text: string) => mutation.mutate(text),
    cancel: () => inFlight.current?.abort(),
    isSending: mutation.isPending,
  };
};
