// Structured logs: one JSON object per line, so Loki/Grafana (M1-24) can query fields, not text.

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];
export type LogFields = Record<string, unknown>;

export type Logger = {
  debug: (msg: string, fields?: LogFields) => void;
  info: (msg: string, fields?: LogFields) => void;
  warn: (msg: string, fields?: LogFields) => void;
  error: (msg: string, fields?: LogFields) => void;
  /** A logger that adds `fields` to every line (e.g. the request id). */
  child: (fields: LogFields) => Logger;
};

/** One log entry, before it is written: what a sink (Loki over OTLP, M1-26d) receives. */
export type LogEntry = { time: number; level: LogLevel; msg: string; fields: LogFields };

export type LoggerOptions = {
  level: LogLevel;
  /** Where lines go; stdout by default, a fake in tests. */
  write?: (line: string) => void;
  /** Clock, injectable so tests are deterministic. */
  now?: () => number;
  fields?: LogFields;
  /** Somewhere else each entry also goes (Loki over OTLP, M1-26d); none in tests and offline. */
  sink?: (entry: LogEntry) => void;
};

export const createLogger = ({
  level,
  write = (line) => process.stdout.write(`${line}\n`),
  now = Date.now,
  fields = {},
  sink,
}: LoggerOptions): Logger => {
  const min = LOG_LEVELS.indexOf(level);
  const log =
    (at: LogLevel) =>
    (msg: string, extra: LogFields = {}) => {
      if (LOG_LEVELS.indexOf(at) < min) return;
      const time = now();
      const all = { ...fields, ...extra };
      write(JSON.stringify({ time: new Date(time).toISOString(), level: at, msg, ...all }));
      sink?.({ time, level: at, msg, fields: all });
    };
  return {
    debug: log('debug'),
    info: log('info'),
    warn: log('warn'),
    error: log('error'),
    child: (more) =>
      createLogger({
        level,
        write,
        now,
        fields: { ...fields, ...more },
        ...(sink ? { sink } : {}),
      }),
  };
};
