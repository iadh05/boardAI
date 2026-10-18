// Expected failures are values, not exceptions (docs/rules/general.md — TypeScript).
// Callers must look at `ok` before they can reach `value`, so a failure can't be ignored by accident.

export type DomainError<Code extends string = string> = {
  code: Code;
  message: string;
};

export type Result<T, Code extends string = string> =
  { ok: true; value: T } | { ok: false; error: DomainError<Code> };

export const ok = <T>(value: T): { ok: true; value: T } => ({ ok: true, value });

export const fail = <Code extends string>(
  code: Code,
  message: string,
): { ok: false; error: DomainError<Code> } => ({ ok: false, error: { code, message } });
