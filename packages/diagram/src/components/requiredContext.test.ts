import { renderHook } from '@testing-library/react';
import { expect, it } from 'vitest';
import { createRequiredContext } from './requiredContext.ts';

it('says clearly when a part is used outside <Diagram>', () => {
  const [, useThing] = createRequiredContext<{ x: number }>('ThingContext');
  expect(() => renderHook(() => useThing())).toThrow(
    'ThingContext is only available inside <Diagram>',
  );
});
