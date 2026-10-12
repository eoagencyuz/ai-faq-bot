import { createHash } from 'node:crypto';
import pino, { type Logger } from 'pino';

export type { Logger };

const secrets = new Set<string>();

/** Token va private key kabi qiymatlar xato matnida chiqib qolmasligi uchun ro'yxatga olinadi. */
export function registerSecrets(values: string[]): void {
  for (const value of values) {
    if (value.length >= 6) secrets.add(value);
  }
}

export function redact(text: string): string {
  let out = text;
  for (const secret of secrets) out = out.split(secret).join('[REDACTED]');
  return out;
}

export function createLogger(level: string): Logger {
  return pino({
    level,
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: ['phone', '*.phone', 'token', '*.token', 'privateKey', '*.privateKey', 'authorization', '*.authorization'],
      censor: '[REDACTED]',
    },
  });
}

export function describeError(err: unknown): { name: string; message: string; code?: string | number } {
  if (err instanceof Error) {
    const e = err as Error & { code?: string | number; response?: { status?: number } };
    const code = e.code ?? e.response?.status;
    return {
      name: e.name,
      message: redact(e.message).slice(0, 300),
      ...(code !== undefined ? { code } : {}),
    };
  }
  return { name: 'UnknownError', message: redact(String(err)).slice(0, 300) };
}

/** Log uchun qisqa, qaytarilmaydigan identifikator (Telegram ID ni to'g'ridan-to'g'ri yozmaslik uchun). */
export function hashId(id: number | string): string {
  return createHash('sha256').update(String(id)).digest('hex').slice(0, 10);
}
