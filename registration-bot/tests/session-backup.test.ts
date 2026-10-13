import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SessionBackup, type SessionSheetPort } from '../src/services/session-backup.js';
import { SessionStore, acceptAnswer, currentQuestion, newSession, type UserSession } from '../src/services/session.js';

const logger = pino({ level: 'silent' });

function memorySheet() {
  const rows: string[][] = [];
  let failNext = false;
  const calls = { write: 0, append: 0 };
  const port: SessionSheetPort = {
    verify: async () => undefined,
    readAll: async () => rows.map((values, i) => ({ row: i + 2, values: [...values] })),
    writeRows: async (updates) => {
      if (failNext) {
        failNext = false;
        throw new Error('503');
      }
      calls.write++;
      for (const u of updates) rows[u.row - 2] = [...u.values];
    },
    appendRows: async (newRows) => {
      if (failNext) {
        failNext = false;
        throw new Error('503');
      }
      calls.append++;
      rows.push(...newRows.map((r) => [...r]));
    },
  };
  return { port, rows, calls, failNext: () => (failNext = true) };
}

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reg-backup-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const inProgress = (userId: number): UserSession => ({ ...newSession(userId, 'ali', Date.now()), status: 'in_progress' });

describe('SessionBackup', () => {
  it("disk o'chgandan keyin anketa zaxiradan shu savoldan tiklanadi", async () => {
    const sheet = memorySheet();
    const backup = new SessionBackup(sheet.port, logger);
    const store = new SessionStore(path.join(dir, 'a', 'sessions.json'), 3_600_000);
    store.onChange = (id, s) => backup.mark(id, s);

    store.save(inProgress(7));
    const s = acceptAnswer(store.get(7)!, 'full_name', { kind: 'text', value: 'Aliyev Vali' }, Date.now());
    store.save(s);
    await backup.flush();
    expect(sheet.rows).toHaveLength(1);

    // Yangi server: bo'sh disk
    const fresh = new SessionStore(path.join(dir, 'b', 'sessions.json'), 3_600_000);
    expect(fresh.get(7)).toBeUndefined();
    expect(fresh.restore(await new SessionBackup(sheet.port, logger).restore())).toBe(1);
    const restored = fresh.get(7)!;
    expect(currentQuestion(restored)?.key).toBe('phone');
    expect(restored.answers.full_name).toEqual({ kind: 'text', value: 'Aliyev Vali' });
  });

  it("mavjud qatorni yangilaydi, yangi foydalanuvchini qo'shadi", async () => {
    const sheet = memorySheet();
    const backup = new SessionBackup(sheet.port, logger);
    backup.mark(1, inProgress(1));
    await backup.flush();
    backup.mark(1, { ...inProgress(1), currentQuestionIndex: 3 });
    backup.mark(2, inProgress(2));
    await backup.flush();
    expect(sheet.rows).toHaveLength(2);
    expect(JSON.parse(sheet.rows[0]![2]!).currentQuestionIndex).toBe(3);
  });

  it("o'chirilgan sessiya qatori tozalanadi", async () => {
    const sheet = memorySheet();
    const backup = new SessionBackup(sheet.port, logger);
    backup.mark(1, inProgress(1));
    await backup.flush();
    backup.mark(1, null);
    await backup.flush();
    expect(sheet.rows[0]).toEqual(['', '', '']);
    expect(await backup.restore()).toHaveLength(0);
  });

  it("yozish xatosida o'zgarish yo'qolmaydi va keyingi urinishda yoziladi", async () => {
    const sheet = memorySheet();
    const backup = new SessionBackup(sheet.port, logger);
    sheet.failNext();
    backup.mark(1, inProgress(1));
    await backup.flush();
    expect(sheet.rows).toHaveLength(0);
    expect(backup.pending).toBe(1);
    await backup.flush();
    expect(sheet.rows).toHaveLength(1);
    expect(backup.pending).toBe(0);
  });

  it("o'zgarish bo'lmasa, API chaqirilmaydi", async () => {
    const sheet = memorySheet();
    await new SessionBackup(sheet.port, logger).flush();
    expect(sheet.calls).toEqual({ write: 0, append: 0 });
  });
});

describe('SessionStore.restore', () => {
  it("lokal nusxa yangiroq bo'lsa, zaxira uni almashtirmaydi", () => {
    let clock = 10_000;
    const store = new SessionStore(path.join(dir, 's.json'), 3_600_000, () => undefined, () => clock);
    store.save({ ...inProgress(5), currentQuestionIndex: 4 });
    const older = { ...inProgress(5), currentQuestionIndex: 2, updatedAt: 5_000 };
    expect(store.restore([older])).toBe(0);
    expect(store.get(5)?.currentQuestionIndex).toBe(4);
    clock = 20_000;
    expect(store.restore([{ ...older, currentQuestionIndex: 6, updatedAt: 15_000 }])).toBe(1);
    expect(store.get(5)?.currentQuestionIndex).toBe(6);
  });

  it("noto'g'ri yoki muddati o'tgan yozuvlarni olmaydi", () => {
    const store = new SessionStore(path.join(dir, 't.json'), 1_000, () => undefined, () => 100_000);
    expect(store.restore([{ ...inProgress(1), updatedAt: 1 }, { foo: 1 } as never])).toBe(0);
  });
});
