import { maxMessages } from '../domain/chatPolicy.ts';
export const review = (n: number): boolean => n <= maxMessages;
