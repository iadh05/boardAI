import { useEffect, useLayoutEffect, useRef } from 'react';

/** How close to the bottom still counts as "at the bottom", in pixels. */
const NEAR_BOTTOM = 40;

/**
 * Keeps a scrolling element at its bottom while `content` grows — the streaming answer — unless
 * the reader scrolled up to read something older: then it leaves them where they are.
 */
export const useAutoScroll = <T extends HTMLElement>(content: unknown) => {
  const ref = useRef<T>(null);
  // Where the reader was when they last scrolled; measured before the content grows.
  const atBottom = useRef(true);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onScroll = () => {
      atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM;
    };
    el.addEventListener('scroll', onScroll);
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  // Before paint, so the new text never flashes below the fold.
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [content]);

  return ref;
};
