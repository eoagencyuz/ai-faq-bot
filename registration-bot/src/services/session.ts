import fs from 'node:fs';
import path from 'node:path';
import type { Draft } from './registration.js';

export type Stage =
  | 'idle'
  | 'subscribe'
  | 'verified'
  | 'filling'
  | 'confirm'
  | 'submitting'
  | 'done';

export interface UserSession {
  stage: Stage;
  draft: Draft | null;
  updatedAt: number;
}

interface FileShape {
  version: 1;
  sessions: Record<string, UserSession>;
}

/**
 * Foydalanuvchi holatlari. Har o'zgarishda diskka atomik yoziladi (tmp + rename),
 * shuning uchun server qayta ishga tushganda tugallanmagan jarayonlar tiklanadi.
 */
export class SessionStore {
  private readonly sessions = new Map<number, UserSession>();

  constructor(
    private readonly file: string,
    private readonly ttlMs: number,
    private readonly onLoadError: (message: string) => void = () => undefined,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.load();
  }

  get(userId: number): UserSession | undefined {
    const session = this.sessions.get(userId);
    if (!session) return undefined;
    if (this.now() - session.updatedAt > this.ttlMs) {
      this.sessions.delete(userId);
      this.persist();
      return undefined;
    }
    return session;
  }

  setStage(userId: number, stage: Stage, draft: Draft | null = null): void {
    this.sessions.set(userId, { stage, draft, updatedAt: this.now() });
    this.persist();
  }

  clear(userId: number): void {
    if (this.sessions.delete(userId)) this.persist();
  }

  purgeExpired(): number {
    const cutoff = this.now() - this.ttlMs;
    let removed = 0;
    for (const [userId, session] of this.sessions) {
      if (session.updatedAt < cutoff) {
        this.sessions.delete(userId);
        removed++;
      }
    }
    if (removed > 0) this.persist();
    return removed;
  }

  get size(): number {
    return this.sessions.size;
  }

  private load(): void {
    if (!fs.existsSync(this.file)) return;
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Partial<FileShape>;
      for (const [key, value] of Object.entries(raw.sessions ?? {})) {
        const userId = Number(key);
        if (Number.isSafeInteger(userId) && value && typeof value.stage === 'string') {
          this.sessions.set(userId, value);
        }
      }
    } catch {
      this.onLoadError("Sessiya fayli o'qilmadi; jarayonlar yangidan boshlanadi");
    }
  }

  private persist(): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    const data: FileShape = { version: 1, sessions: Object.fromEntries(this.sessions) };
    fs.writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }
}
