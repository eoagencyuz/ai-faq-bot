import { describe, expect, it } from 'vitest';
import { isUnreachable, recipientsFromRows, sendBroadcast } from '../src/services/broadcast.js';
import { COL } from '../src/services/registry.js';

const tgError = (code: number, description: string, retry_after?: number) =>
  Object.assign(new Error(description), {
    response: { error_code: code, description, ...(retry_after ? { parameters: { retry_after } } : {}) },
  });

const row = (id: string) => {
  const r: string[] = [];
  r[COL.USER_ID] = id;
  return r;
};

describe('recipientsFromRows', () => {
  it('takrorlanmas, to\'g\'ri ID\'larni qaytaradi', () => {
    expect(recipientsFromRows([row('8289758059'), row('222816108'), row('8289758059'), row(''), row('abc')])).toEqual([
      8289758059, 222816108,
    ]);
  });
});

describe('sendBroadcast', () => {
  const noWait = async () => undefined;

  it('hammaga yuboradi va hisobot beradi', async () => {
    const sent: number[] = [];
    const stats = await sendBroadcast([1, 2, 3], async (id) => sent.push(id), { wait: noWait });
    expect(sent).toEqual([1, 2, 3]);
    expect(stats).toEqual({ total: 3, sent: 3, blocked: 0, failed: 0 });
  });

  it('botni bloklaganlar va xatolarni alohida sanaydi, qolganlariga davom etadi', async () => {
    const stats = await sendBroadcast(
      [1, 2, 3, 4],
      async (id) => {
        if (id === 1) throw tgError(403, 'Forbidden: bot was blocked by the user');
        if (id === 2) throw tgError(400, 'Bad Request: chat not found');
        if (id === 3) throw tgError(500, 'Internal Server Error');
      },
      { wait: noWait },
    );
    expect(stats).toEqual({ total: 4, sent: 1, blocked: 2, failed: 1 });
  });

  it('429 da Telegram aytgan vaqtni kutib, bir marta qayta urinadi', async () => {
    const waits: number[] = [];
    let calls = 0;
    const stats = await sendBroadcast(
      [7],
      async () => {
        calls++;
        if (calls === 1) throw tgError(429, 'Too Many Requests: retry after 3', 3);
      },
      { wait: async (ms) => waits.push(ms) },
    );
    expect(calls).toBe(2);
    expect(waits).toContain(4000);
    expect(stats.sent).toBe(1);
  });

  it('xabarlar orasida kutadi (Telegram tezlik cheklovi)', async () => {
    const waits: number[] = [];
    await sendBroadcast([1, 2, 3], async () => undefined, { delayMs: 50, wait: async (ms) => waits.push(ms) });
    expect(waits).toEqual([50, 50]);
  });

  it("yetkazib bo'lmaydigan xatolarni aniqlaydi", () => {
    expect(isUnreachable(tgError(403, 'Forbidden: user is deactivated'))).toBe(true);
    expect(isUnreachable(tgError(400, 'Bad Request: message text is empty'))).toBe(false);
  });
});
