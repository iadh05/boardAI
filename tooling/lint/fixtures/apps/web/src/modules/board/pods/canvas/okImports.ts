import { clamp } from '../../../../core/lib/clamp.ts';
import { boardName } from '../../store/boardStore.ts';
import { place } from './lib/placement.ts';
import { tool } from '../toolbar/index.ts';
export const ok = [clamp(1, 0, 2), boardName, place(1), tool];
