import { createContext, useContext } from 'react';

/**
 * A context that only exists inside <Diagram>: no fake default values, and a clear error if a
 * part is rendered on its own.
 */
export const createRequiredContext = <T>(name: string) => {
  const Context = createContext<T | null>(null);
  const useRequired = (): T => {
    const value = useContext(Context);
    if (value === null) throw new Error(`${name} is only available inside <Diagram>`);
    return value;
  };
  return [Context, useRequired] as const;
};
