import type { RegistrationRecord } from '../types/index.js';
import { GENDER_LABELS, toSheetText } from '../validators/registration.js';
import { addDays, dateOf, formatLocal } from '../utils/time.js';

export const SHEET_HEADERS = [
  'ID',
  'Created At',
  'Telegram User ID',
  'Telegram Username',
  'First Name',
  'Last Name',
  'Phone',
  'Birth Date',
  'Gender',
  'Region',
  'District',
  'Additional Info',
  'Subscription Verified',
  'Registration Status',
] as const;

/** Ustunlar indeksi (0 dan). Ustunlar tartibini o'zgartirmang. */
export const COL = {
  ID: 0,
  CREATED: 1,
  USER_ID: 2,
  USERNAME: 3,
  FIRST: 4,
  LAST: 5,
  PHONE: 6,
  BIRTH: 7,
  GENDER: 8,
  REGION: 9,
  DISTRICT: 10,
  ADDITIONAL: 11,
  SUB_VERIFIED: 12,
  STATUS: 13,
} as const;

/** Google Sheets bilan ishlovchi minimal interfeys. Testlarda oddiy xotira implementatsiyasi ishlatiladi. */
export interface SheetsPort {
  verify(): Promise<void>;
  /** Sarlavhasiz, faqat ma'lumot qatorlari. */
  readRows(): Promise<string[][]>;
  appendRow(values: string[]): Promise<void>;
}

export function toRow(record: RegistrationRecord, timeZone: string): string[] {
  return [
    record.id,
    formatLocal(record.createdAt, timeZone),
    String(record.userId),
    toSheetText(record.username),
    toSheetText(record.firstName),
    toSheetText(record.lastName),
    record.phone,
    record.birthDate,
    record.gender ? GENDER_LABELS[record.gender] : '',
    toSheetText(record.region),
    toSheetText(record.district),
    toSheetText(record.additionalInfo),
    record.subscriptionVerified ? 'Ha' : "Yo'q",
    'Yakunlandi',
  ];
}

export type SaveOutcome = 'saved' | 'duplicate';

export class RegistrationRegistry {
  private readonly locks = new Map<number, Promise<unknown>>();

  constructor(
    private readonly sheets: SheetsPort,
    private readonly timeZone: string,
  ) {}

  verify(): Promise<void> {
    return this.sheets.verify();
  }

  listRows(): Promise<string[][]> {
    return this.sheets.readRows();
  }

  async isRegistered(userId: number): Promise<boolean> {
    const rows = await this.sheets.readRows();
    return rows.some((r) => r[COL.USER_ID] === String(userId));
  }

  /**
   * Idempotent saqlash: bir foydalanuvchi uchun bir vaqtda faqat bitta yozuv bo'ladi.
   * Append noaniq xato bersa (qator aslida yozilgan bo'lishi mumkin), qayta qo'shishdan oldin tekshiriladi.
   */
  save(record: RegistrationRecord): Promise<SaveOutcome> {
    const previous = this.locks.get(record.userId) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(() => this.saveOnce(record));
    this.locks.set(record.userId, run);
    return run.finally(() => {
      if (this.locks.get(record.userId) === run) this.locks.delete(record.userId);
    });
  }

  private async saveOnce(record: RegistrationRecord): Promise<SaveOutcome> {
    if (await this.isRegistered(record.userId)) return 'duplicate';
    try {
      await this.sheets.appendRow(toRow(record, this.timeZone));
    } catch (err) {
      const exists = await this.isRegistered(record.userId).catch(() => false);
      if (exists) return 'saved';
      throw err;
    }
    return 'saved';
  }
}

export interface RegistrationStats {
  total: number;
  today: number;
  last7: number;
  last30: number;
}

/** Statistika Asia/Tashkent (yoki berilgan) vaqt zonasi kalendar kunlari bo'yicha hisoblanadi. */
export function computeStats(rows: string[][], now: Date, timeZone: string): RegistrationStats {
  const today = dateOf(formatLocal(now, timeZone));
  const from7 = addDays(today, -6);
  const from30 = addDays(today, -29);
  const stats: RegistrationStats = { total: 0, today: 0, last7: 0, last30: 0 };
  for (const row of rows) {
    if (!row[COL.USER_ID]) continue;
    stats.total++;
    const day = dateOf(row[COL.CREATED] ?? '');
    if (day === today) stats.today++;
    if (day >= from7) stats.last7++;
    if (day >= from30) stats.last30++;
  }
  return stats;
}

/** Oxirgi `n` ta yozuv, eng yangisi birinchi. */
export function recentRows(rows: string[][], n: number): string[][] {
  return rows.filter((r) => r[COL.USER_ID]).slice(-n).reverse();
}
