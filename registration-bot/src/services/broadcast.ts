import { COL } from './registry.js';

export interface BroadcastStats {
  total: number;
  sent: number;
  /** Botni bloklagan yoki akkauntini o'chirgan foydalanuvchilar. */
  blocked: number;
  failed: number;
}

interface TelegramLikeError {
  code?: unknown;
  response?: { error_code?: unknown; description?: unknown; parameters?: { retry_after?: unknown } };
  description?: unknown;
  parameters?: { retry_after?: unknown };
}

const errorCode = (err: unknown): number | undefined => {
  const e = err as TelegramLikeError;
  const code = e.response?.error_code ?? e.code;
  return typeof code === 'number' ? code : undefined;
};

const retryAfter = (err: unknown): number | undefined => {
  const e = err as TelegramLikeError;
  const value = e.response?.parameters?.retry_after ?? e.parameters?.retry_after;
  return typeof value === 'number' ? value : undefined;
};

const description = (err: unknown): string => {
  const e = err as TelegramLikeError;
  return String(e.response?.description ?? e.description ?? (err instanceof Error ? err.message : '')).toLowerCase();
};

/** Foydalanuvchiga xabar yetkazib bo'lmaydi: bloklagan, akkaunt o'chirilgan yoki chat topilmagan. */
export function isUnreachable(err: unknown): boolean {
  const code = errorCode(err);
  const text = description(err);
  return code === 403 || (code === 400 && /chat not found|user not found|deactivated/.test(text));
}

/** Sheets qatorlaridan takrorlanmas Telegram ID'lar (varaqdagi tartibda). */
export function recipientsFromRows(rows: string[][]): number[] {
  const ids = new Set<number>();
  for (const row of rows) {
    const id = Number(row[COL.USER_ID]);
    if (row[COL.USER_ID] && Number.isSafeInteger(id) && id > 0) ids.add(id);
  }
  return [...ids];
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Xabarni navbat bilan yuboradi. Telegram cheklovi: sekundiga ~30 xabar, shuning uchun har xabar orasida
 * `delayMs` kutiladi. 429 (juda tez) javobida Telegram aytgan vaqt kutiladi va bir marta qayta uriniladi.
 */
export async function sendBroadcast(
  userIds: number[],
  send: (userId: number) => Promise<unknown>,
  opts: { delayMs?: number; wait?: (ms: number) => Promise<unknown> } = {},
): Promise<BroadcastStats> {
  const delayMs = opts.delayMs ?? 50;
  const wait = opts.wait ?? sleep;
  const stats: BroadcastStats = { total: userIds.length, sent: 0, blocked: 0, failed: 0 };
  for (const [i, userId] of userIds.entries()) {
    if (i > 0 && delayMs > 0) await wait(delayMs);
    for (let attempt = 1; ; attempt++) {
      try {
        await send(userId);
        stats.sent++;
      } catch (err) {
        const after = retryAfter(err);
        if (errorCode(err) === 429 && attempt === 1) {
          await wait(((after ?? 1) + 1) * 1000);
          continue;
        }
        if (isUnreachable(err)) stats.blocked++;
        else stats.failed++;
      }
      break;
    }
  }
  return stats;
}

/** Ism o'rniga qo'yiladigan belgilar: <FULL NAME>, {name}, {ism}. */
const NAME_PLACEHOLDER = /<FULL NAME>|\{name\}|\{ism\}/gi;

export const hasNamePlaceholder = (text: string): boolean => new RegExp(NAME_PLACEHOLDER.source, 'i').test(text);

export const personalize = (template: string, fullName: string): string =>
  template.replace(new RegExp(NAME_PLACEHOLDER.source, 'gi'), fullName);

/** Telegram ID -> ism-familiya (Sheets'dagi formula himoyasi belgisi olib tashlanadi). */
export function namesFromRows(rows: string[][]): Map<number, string> {
  const names = new Map<number, string>();
  for (const row of rows) {
    const id = Number(row[COL.USER_ID]);
    const name = (row[COL.FULL_NAME] ?? '').replace(/^'/, '').trim();
    if (row[COL.USER_ID] && Number.isSafeInteger(id) && name) names.set(id, name);
  }
  return names;
}

/** Matndan Telegram ID'larni ajratib oladi (bo'shliq, vergul yoki yangi qator bilan). */
export function parseIdList(text: string): number[] {
  const ids = new Set<number>();
  for (const token of text.match(/\d{1,15}/g) ?? []) {
    const id = Number(token);
    if (Number.isSafeInteger(id)) ids.add(id);
  }
  return [...ids];
}
