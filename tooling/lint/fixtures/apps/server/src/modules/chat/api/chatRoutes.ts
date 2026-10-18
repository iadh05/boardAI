import { review } from '../application/reviewBoard.ts';
import { log } from '../../../core/logger.ts';
export const routes = [review(1), log('ok')];
