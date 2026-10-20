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

  // M1-26d: the same entries also go to Loki (over OTLP), through a sink set at startup.
  it('also hands each entry to a sink, with the child fields; dropped entries are not sent', () => {
    const sent: unknown[] = [];
    const logger = createLogger({
      level: 'info',
      write: () => {},
      now: () => 1_700_000_000_000,
      sink: (entry) => sent.push(entry),
    });
    logger.debug('noise');
    logger.child({ requestId: 'r1' }).warn('slow', { ms: 900 });
    expect(sent).toEqual([
      {
        time: 1_700_000_000_000,
        level: 'warn',
        msg: 'slow',
        fields: { requestId: 'r1', ms: 900 },
      },
    ]);
  });
});
