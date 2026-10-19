import type { APIRequestContext } from '@playwright/test';
import { ChatEventSchema, type Board, type ChatEvent } from '@designroom/domain';

/**
 * The chat API as the browser calls it: same origin as the app, so the request goes through the
 * same path (vite preview or Nginx → server → fake model). Like a page object, it doesn't assert.
 */
export class ChatApi {
  constructor(private readonly request: APIRequestContext) {}

  /** Sends one message about `board` and returns every event of the stream, parsed. */
  async ask(board: Board, message: string): Promise<ChatEvent[]> {
    const res = await this.request.post('/api/chat', {
      data: { board, messages: [{ role: 'user', content: message }] },
    });
    const body = await res.text();
    return body
      .split('\n\n')
      .filter((block) => block.startsWith('data: '))
      .map((block) => ChatEventSchema.parse(JSON.parse(block.slice('data: '.length))));
  }
}
