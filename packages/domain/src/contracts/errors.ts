import { z } from 'zod';

// The API's one error shape (docs/rules/backend.md): the server sends it for every failed
// request, the browser parses it before showing the message. Shared so both sides agree.

export const ErrorResponseSchema = z.object({
  error: z.object({
    code: z.string().min(1),
    /** Written for the user: what happened and what to do. */
    message: z.string().min(1),
    details: z.unknown().optional(),
  }),
});
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
