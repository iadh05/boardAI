import { describe, expect, it } from 'vitest';
import { createLogger } from './logger.ts';

const capture = (level: 'debug' | 'info' | 'warn' | 'error' = 'info') => {
  const lines: string[] = [];
  const logger = createLogger({
    level,
    write: (line) => lines.push(line),
    now: () => 1_700_000_000_000,
  });
  return { logger, records: () => lines.map((l) => JSON.parse(l) as Record<string, unknown>) };
};

describe('createLogger', () => {
  it('writes one JSON line per entry, with time, level, message and fields', () => {
    const { logger, records } = capture();
    logger.info('request done', { status: 200 });
    expect(records()).toEqual([
      { time: '2023-11-14T22:13:20.000Z', level: 'info', msg: 'request done', status: 200 },
    ]);
  });

  it('drops entries below its level', () => {
    const { logger, records } = capture('warn');
    logger.info('noise');
    logger.error('bad');
    expect(records().map((r) => r.level)).toEqual(['error']);
  });

  it('child loggers carry their fields (e.g. the request id) on every line', () => {
    const { logger, records } = capture();
    logger.child({ requestId: 'r1' }).info('hello');
    expect(records()[0]).toMatchObject({ requestId: 'r1', msg: 'hello' });
  });
});
