import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useAutoScroll } from './useAutoScroll.ts';

function Scroller({ content }: { content: string }) {
  const ref = useAutoScroll<HTMLDivElement>(content);
  return (
    <div ref={ref} data-testid="scroller">
      {content}
    </div>
  );
}

/** jsdom has no layout: give the element a size, as a browser would. */
const sized = (el: HTMLElement, scrollHeight: number, clientHeight: number) => {
  Object.defineProperty(el, 'scrollHeight', { configurable: true, value: scrollHeight });
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: clientHeight });
};

describe('useAutoScroll', () => {
  it('follows new content when the reader is at the bottom', () => {
    const { getByTestId, rerender } = render(<Scroller content="a" />);
    const el = getByTestId('scroller');
    sized(el, 1_000, 300);
    el.scrollTop = 700; // at the bottom
    fireEvent.scroll(el);

    rerender(<Scroller content="ab" />);

    expect(el.scrollTop).toBe(1_000);
  });

  it('leaves the reader where they are when they scrolled up to read', () => {
    const { getByTestId, rerender } = render(<Scroller content="a" />);
    const el = getByTestId('scroller');
    sized(el, 1_000, 300);
    el.scrollTop = 100; // reading an older message
    fireEvent.scroll(el);

    rerender(<Scroller content="ab" />);

    expect(el.scrollTop).toBe(100);
  });
});
