import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SessionStore } from '../src/services/session.js';
import { createDraft } from '../src/services/registration.js';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reg-session-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('SessionStore', () => {
  it("server qayta ishga tushganda tugallanmagan jarayonni tiklaydi", () => {
    const file = path.join(dir, 'sessions.json');
    const first = new SessionStore(file, 3_600_000);
    first.setStage(7, 'filling', createDraft(['first_name', 'last_name', 'phone']));

    const restarted = new SessionStore(file, 3_600_000);
    const session = restarted.get(7);
    expect(session?.stage).toBe('filling');
    expect(session?.draft?.step).toBe('first_name');
  });

  it('muddati o\'tgan sessiyalarni qaytarmaydi va tozalaydi', () => {
    let clock = 1_000;
    const store = new SessionStore(path.join(dir, 's.json'), 1_000, () => undefined, () => clock);
    store.setStage(1, 'subscribe');
    clock += 5_000;
    expect(store.get(1)).toBeUndefined();
    store.setStage(2, 'subscribe');
    clock += 5_000;
    expect(store.purgeExpired()).toBe(1);
    expect(store.size).toBe(0);
  });

  it("buzilgan fayl bilan ishga tushadi va xabar beradi", () => {
    const file = path.join(dir, 'bad.json');
    fs.writeFileSync(file, '{not json');
    const messages: string[] = [];
    const store = new SessionStore(file, 3_600_000, (m) => messages.push(m));
    expect(store.size).toBe(0);
    expect(messages).toHaveLength(1);
  });

  it('yozish atomik: vaqtinchalik fayl qoldirmaydi', () => {
    const file = path.join(dir, 'atomic.json');
    new SessionStore(file, 3_600_000).setStage(3, 'verified');
    expect(fs.existsSync(`${file}.tmp`)).toBe(false);
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).version).toBe(1);
  });
});
