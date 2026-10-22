import { z } from 'zod';

// A task card (AV2-05, D4): what one specialist is asked, about which boxes, in how long. The
// specialist gets only that — a small context for a 9B model.

export const MAX_TASKS = 6; // per request (D5): one GPU, a bounded wait
export const TASK_TIMEOUT_MS = 60_000;

export const TaskCardSchema = z.object({
  id: z.string().min(1),
  specialist: z.string().min(1).max(40),
  boxIds: z.array(z.string().min(1)).max(50),
  question: z.string().min(1).max(1000),
  budgetMs: z.number().int().min(1_000).max(TASK_TIMEOUT_MS),
});
export type TaskCard = z.infer<typeof TaskCardSchema>;

/** Where the queue is (D6), as the user reads it: "Data ✓ · Security running · 1 left". */
export type Progress = { done: string[]; running: string | null; waiting: number };

const title = (name: string) => name.charAt(0).toUpperCase() + name.slice(1);

export const progressText = ({ done, running, waiting }: Progress): string =>
  [
    ...done.map((name) => `${title(name)} ✓`),
    ...(running ? [`${title(running)} running`] : []),
    ...(waiting > 0 ? [`${waiting} left`] : []),
  ].join(' · ');
