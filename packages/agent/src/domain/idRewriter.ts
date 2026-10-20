// Ids out of the user's text (M1-29). The model works with short ids (n3) and writes them in its
// answers in ~9 of 10 reviews, whatever the prompt says — but the user never sees ids, only names.
// So the streamed text is rewritten: an id becomes its box's label, and an id in parentheses right
// after the name ("the Payment Service (n10)") is dropped. Unknown ids are left alone.

/** "Name (n3)" / "Name (`n3`)": the name is already there. */
const IN_PARENS = /\s*\(\s*`?(n\d+)`?\s*\)/g;
/** A bare id, with or without backticks — not part of a longer word (an10, n3x). */
const BARE = /`?(?<![\w-])(n\d+)(?![\w-])`?/g;
/** The end of a chunk that could still become an id with the next one: "n", "n1", "(`n1"… */
const UNFINISHED = /(\s*\(\s*)?`?(?<![\w-])n\d*`?$/; // with the space before "(": it may go too

export const createIdRewriter = (labelOf: (id: string) => string | undefined) => {
  let held = '';

  const rewrite = (text: string) =>
    text
      .replace(IN_PARENS, (whole, id: string) => (labelOf(id) ? '' : whole))
      .replace(BARE, (whole, id: string) => labelOf(id) ?? whole);

  return {
    /** The text safe to show now; a possible start of an id waits for the next chunk. */
    feed: (delta: string): string => {
      const text = held + delta;
      const tail = UNFINISHED.exec(text);
      held = tail ? tail[0] : '';
      return rewrite(tail ? text.slice(0, tail.index) : text);
    },
    /** Everything still held, at the end of the answer. */
    flush: (): string => {
      const rest = rewrite(held);
      held = '';
      return rest;
    },
  };
};
