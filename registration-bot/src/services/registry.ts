import { toSheetText } from '../validators/registration.js';
import { answerLabel, noteOf, type QuestionKey, type RegistrationRecord } from './questionnaire.js';
import { addDays, dateOf, formatLocal } from '../utils/time.js';

export const SHEET_HEADERS = [
  'ID',
  'Created At',
  'Telegram User ID',
  'Telegram Username',
  'Full Name',
  'Phone',
  'Telegram Phone Match',
  'Program',
  'Course',
  'Occupation',
  'Occupation Other',
  'Work Field',
  'Work Field Other',
  'Free Time',
  'Weekly Hours',
  'Start Time',
  'Motivation',
  'Media Interests',
  'Media Experience',
  'Has Portfolio',
  'Portfolio URL',
  'AI Usage',
  'AI Tools',
  'AI Goals',
  'Devices',
  'Three Month Goal',
  'Ready For Tasks',
  'Work Style',
  'Subscription Verified',
  'Registration Status',
] as const;

/** Ustunlar indeksi (0 dan). Ustunlar tartibini o'zgartirmang. */
export const COL = {
  ID: 0,
  CREATED: 1,
  USER_ID: 2,
  USERNAME: 3,
  FULL_NAME: 4,
  PHONE: 5,
  STATUS: SHEET_HEADERS.length - 1,
} as const;

/** 1 -> A, 27 -> AA */
export function columnLetter(n: number): string {
  let s = '';
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
}

export const LAST_COLUMN = columnLetter(SHEET_HEADERS.length);

/** Google Sheets bilan ishlovchi minimal interfeys. Testlarda oddiy xotira implementatsiyasi ishlatiladi. */
export interface SheetsPort {
  verify(): Promise<void>;
  /** Sarlavhasiz, faqat ma'lumot qatorlari. */
  readRows(): Promise<string[][]>;
  appendRow(values: string[]): Promise<void>;
}

export function toRow(record: RegistrationRecord, timeZone: string): string[] {
  const { answers } = record;
  const label = (key: QuestionKey) => toSheetText(answerLabel(key, answers));
  const contact = answers.phone_contact;
  const portfolio = answers.portfolio;
  return [
    record.id,
    formatLocal(record.createdAt, timeZone),
    String(record.userId),
    toSheetText(record.username),
    label('full_name'),
    // Telefon raqami "+998..." ko'rinishida tekshirilgan; RAW yozilgani uchun formula bo'lmaydi
    answerLabel('phone', answers),
    contact?.kind === 'contact' ? (contact.matchesManual ? 'Ha' : `Yo‘q (${contact.phone})`) : '',
    label('program'),
    label('course'),
    label('occupation'),
    toSheetText(noteOf(answers, 'occupation')),
    label('work_field'),
    toSheetText(noteOf(answers, 'work_field')),
    label('free_time'),
    label('weekly_hours'),
    label('start_time'),
    label('motivation'),
    label('media_interests'),
    label('media_experience'),
    portfolio?.kind === 'portfolio' && portfolio.hasPortfolio ? 'Ha' : 'Yo‘q',
    portfolio?.kind === 'portfolio' && portfolio.url ? toSheetText(portfolio.url) : '',
    label('ai_usage'),
    label('ai_tools'),
    label('ai_goals'),
    label('devices'),
    label('three_month_goal'),
    label('ready_for_tasks'),
    label('work_style'),
    record.subscriptionVerified ? 'Ha' : 'Yo‘q',
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
