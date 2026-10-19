// Public API of the chat module. Depends on board (chat → board), never the other way round.
export { useSendMessage } from './api/useSendMessage.ts';
export { createChatStore, useChatStore } from './store/chatStore.ts';
export type { ChatEntry, ChatState, ChatStore } from './store/chatStore.ts';
