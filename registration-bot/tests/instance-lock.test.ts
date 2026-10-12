import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InstanceLockError, acquireInstanceLock } from '../src/utils/instance-lock.js';

let dir: string;
let lock: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reg-lock-'));
  lock = path.join(dir, 'bot.lock');
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('acquireInstanceLock', () => {
  it('ikkinchi instance ishga tushmaydi', () => {
    const release = acquireInstanceLock(lock, 100, () => true);
    expect(() => acquireInstanceLock(lock, 200, () => true)).toThrow(InstanceLockError);
    release();
  });

  it('bo\'shatilgandan keyin qayta olish mumkin', () => {
    acquireInstanceLock(lock, 100, () => true)();
    expect(() => acquireInstanceLock(lock, 200, () => true)).not.toThrow();
  });

  it('o\'chib qolgan jarayonning eski qulfini oladi', () => {
    fs.writeFileSync(lock, '999999');
    expect(() => acquireInstanceLock(lock, 300, () => false)).not.toThrow();
  });
});
