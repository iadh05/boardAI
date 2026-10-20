// Ids out of the user's text (M1-29). The model works with short ids (n3) and writes them in its
// answers in ~9 of 10 reviews, whatever the prompt says — but the user never sees ids, only names.
// So the streamed text is rewritten: an id becomes its box's label, and an id next to the name it
// stands for ("the Payment Service (n10)", "`n10` Payment Service") is dropped. Unknown ids are
// left alone.

/** "Name (n3)" / "Name (`n3`)": the name is already there. */
const IN_PARENS = /\s*\(\s*`?(n\d+)`?\s*\)/g;
/** An id, with its backticks and the spaces after it — not part of a longer word (an10, n3x). */
const ID = /(`?)(?<![\w-])(n\d+)(?![\w-])(`?)(\s*)/g;
/** The end of a chunk that could still become an id with the next one: "(", "`", "n", "(`n1"… */
const UNFINISHED = /(\s*\(\s*)?`?((?<![\w-])n\d*`?)?$/; // with the space before "(": it may go too
/** What may stand between an id and its name: quotes, backticks, bold. */
const OPENERS = /^["“'`*]*/;

export const createIdRewriter = (labelOf: (id: string) => string | undefined) => {
  let held = '';

  /** The text right after an id begins with that id's name (case aside). */
  const namedAfter = (rest: string, label: string) =>
    rest.replace(OPENERS, '').toLowerCase().startsWith(label.toLowerCase());

  /** The end of what was already shown: an id in the next chunk may follow its name. */
  let shownTail = '';
  const words = (text: string): string[] => text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  /** The word right before an id is part of its name ("the Payment Service (n10)", "Kafka (n13)"). */
  const namedBefore = (before: string, label: string) => {
    const last = words(before).at(-1);
    return last !== undefined && words(label).includes(last);
  };

  const rewrite = (text: string) =>
    text
      .replace(IN_PARENS, (whole, id: string, at: number, all: string) => {
        const label = labelOf(id);
        if (!label) return whole;
        // Generic words before ("the bus (n13)"): the id was the only name; keep it, readable.
        return namedBefore(shownTail + all.slice(0, at), label) ? '' : ` (${label})`;
      })
      .replace(
        ID,
        (
          whole,
          open: string,
          id: string,
          close: string,
          space: string,
          at: number,
          all: string,
        ) => {
          const label = labelOf(id);
          if (!label) return whole;
          // A lone backtick belongs to the text around the id ("`n13 Kafka`"): keep it.
          const [before, after] = open && close ? ['', ''] : [open, close];
          if (namedAfter(all.slice(at + whole.length), label)) return before + after;
          return `${before}${label}${after}${space}`;
        },
      );

  /**
   * Where the text stops being safe to show: an unfinished id at the end, or a known id whose name
   * may still be arriving ("`n13 Event str" — rewrite too early and the name comes out twice).
   */
  const safeEnd = (text: string) => {
    for (const m of text.matchAll(ID)) {
      const label = labelOf(m[2] ?? '');
      const rest = text
        .slice(m.index + m[0].length)
        .replace(OPENERS, '')
        .toLowerCase();
      if (label && rest.length < label.length && label.toLowerCase().startsWith(rest))
        return m.index;
    }
    return UNFINISHED.exec(text)?.index ?? text.length;
  };

  return {
    /** The text safe to show now; a possible start of an id (or its name) waits for the next chunk. */
    feed: (delta: string): string => {
      const text = held + delta;
      const end = safeEnd(text);
      held = text.slice(end);
      const shown = rewrite(text.slice(0, end));
      shownTail = (shownTail + shown).slice(-80);
      return shown;
    },
    /** Everything still held, at the end of the answer. */
    flush: (): string => {
      const rest = rewrite(held);
      held = '';
      return rest;
    },
  };
};
