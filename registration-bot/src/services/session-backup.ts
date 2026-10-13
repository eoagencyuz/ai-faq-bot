import type { Logger } from '../utils/logger.js';
import { describeError } from '../utils/logger.js';
import { isSession, type UserSession } from './session.js';

export const SESSION_HEADERS = ['Telegram User ID', 'Updated At', 'Session'] as const;

/** Zaxira varag'i bilan ishlovchi minimal interfeys (testlarda xotira implementatsiyasi). */
export interface SessionSheetPort {
  verify(): Promise<void>;
  /** Sarlavhasiz qatorlar; `row` — varaqdagi qator raqami (1 dan, sarlavha 1-qator). */
  readAll(): Promise<Array<{ row: number; values: string[] }>>;
  writeRows(updates: Array<{ row: number; values: string[] }>): Promise<void>;
  appendRows(rows: string[][]): Promise<void>;
}

/**
 * Sessiyalarning Google Sheets'dagi zaxira nusxasi. Render kabi hostinglarda disk qayta ishga
 * tushganda o'chadi — shunda tugallanmagan anketalar shu zaxiradan tiklanadi.
 * O'zgarishlar yig'ilib, bir necha soniyada bir marta yoziladi (API kvotasini tejash uchun).
 */
export class SessionBackup {
  private readonly rowByUser = new Map<number, number>();
  private readonly dirty = new Map<number, UserSession | null>();
  private mapLoaded = false;
  private flushing: Promise<void> | null = null;
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly port: SessionSheetPort,
    private readonly logger: Logger,
  ) {}

  verify(): Promise<void> {
    return this.port.verify();
  }

  /** Zaxiradagi barcha to'g'ri sessiyalar (bir foydalanuvchi uchun eng yangisi). */
  async restore(): Promise<UserSession[]> {
    const rows = await this.loadMap();
    const latest = new Map<number, UserSession>();
    for (const { values } of rows) {
      try {
        const session: unknown = JSON.parse(values[2] ?? '');
        if (!isSession(session)) continue;
        const prev = latest.get(session.telegramUserId);
        if (!prev || prev.updatedAt < session.updatedAt) latest.set(session.telegramUserId, session);
      } catch {
        // buzilgan qator e'tiborsiz qoldiriladi
      }
    }
    return [...latest.values()];
  }

  /** SessionStore.onChange uchun. */
  mark(userId: number, session: UserSession | null): void {
    this.dirty.set(userId, session);
  }

  get pending(): number {
    return this.dirty.size;
  }

  start(intervalMs: number): void {
    this.timer = setInterval(() => void this.flush(), intervalMs);
    this.timer.unref();
  }

  /** To'xtatishdan oldin: kutilayotgan o'zgarishlarni yozadi. */
  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.flush();
  }

  flush(): Promise<void> {
    if (!this.flushing) {
      this.flushing = this.flushOnce().finally(() => {
        this.flushing = null;
      });
    }
    return this.flushing;
  }

  private async loadMap(): Promise<Array<{ row: number; values: string[] }>> {
    const rows = await this.port.readAll();
    this.rowByUser.clear();
    for (const { row, values } of rows) {
      const userId = Number(values[0]);
      if (values[0] && Number.isSafeInteger(userId)) this.rowByUser.set(userId, row);
    }
    this.mapLoaded = true;
    return rows;
  }

  private async flushOnce(): Promise<void> {
    if (this.dirty.size === 0) return;
    const batch = new Map(this.dirty);
    this.dirty.clear();
    try {
      if (!this.mapLoaded) await this.loadMap();
      const updates: Array<{ row: number; values: string[] }> = [];
      const appends: string[][] = [];
      for (const [userId, session] of batch) {
        const values = session
          ? [String(userId), new Date(session.updatedAt).toISOString(), JSON.stringify(session)]
          : ['', '', ''];
        const row = this.rowByUser.get(userId);
        if (row !== undefined) updates.push({ row, values });
        else if (session) appends.push(values);
        if (!session) this.rowByUser.delete(userId);
      }
      if (updates.length > 0) await this.port.writeRows(updates);
      if (appends.length > 0) {
        await this.port.appendRows(appends);
        // Yangi qatorlar raqamini bilish uchun xaritani qayta o'qiymiz
        await this.loadMap();
      }
    } catch (err) {
      // Yozilmagan o'zgarishlar keyingi urinishga qaytariladi (shu orada yangisi kelmagan bo'lsa)
      for (const [userId, session] of batch) if (!this.dirty.has(userId)) this.dirty.set(userId, session);
      this.mapLoaded = false;
      this.logger.warn({ err: describeError(err), pending: this.dirty.size }, 'Sessiya zaxirasi yozilmadi, qayta uriniladi');
    }
  }
}
