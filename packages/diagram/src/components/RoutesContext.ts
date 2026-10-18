import { createContext, useContext } from 'react';
import type { Route } from '../router/types.ts';

/** Routes by edge id, computed once per change for all edges (null: draw simple edges). */
export const RoutesContext = createContext<ReadonlyMap<string, Route> | null>(null);

export const useRoute = (edgeId: string): Route | undefined =>
  useContext(RoutesContext)?.get(edgeId);
