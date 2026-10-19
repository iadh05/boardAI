// The output side of the guardrails (M1-24d, OWASP LLM07): watches an answer as it streams and
// says when it starts giving away the system prompt. The prompt is not a secret — nothing in it
// must stay hidden — but a reviewer that recites its instructions on request is one an attacker
// can study and steer, so the answer is cut there.
//
// Two signals, both deterministic:
// - 8 consecutive words of the prompt (a verbatim dump);
// - the canary: a random word in the prompt that no honest answer contains. It survives a
//   translation or a reformatting that changes the words around it.

const GRAM = 8;

const words = (text: string) => text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];

const grams = (text: string) =>
  words(text).flatMap((_, i, w) => (i + GRAM <= w.length ? [w.slice(i, i + GRAM).join(' ')] : []));

export type LeakWatchOptions = {
  prompt: string;
  /** Optional: without one, only verbatim recitals are caught. */
  canary?: string;
  /** Text the answer may repeat although it shares words with the prompt (the fixed refusal). */
  allowed?: string;
};

/** Feed it each text delta; it returns true once the answer so far gives the prompt away. */
export const createLeakWatch = ({ prompt, canary, allowed = '' }: LeakWatchOptions) => {
  const ok = new Set(grams(allowed));
  const secret = new Set(grams(prompt).filter((g) => !ok.has(g)));
  let text = '';
  return {
    feed(delta: string): boolean {
      text += delta;
      return (!!canary && text.includes(canary)) || grams(text).some((g) => secret.has(g));
    },
  };
};
