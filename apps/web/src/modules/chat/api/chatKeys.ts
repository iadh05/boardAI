// React Query keys of the chat module (docs/rules/frontend.md: one key factory per module).
export const chatKeys = {
  all: ['chat'] as const,
  send: () => [...chatKeys.all, 'send'] as const,
};
