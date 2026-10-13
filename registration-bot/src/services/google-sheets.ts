import { google, type sheets_v4 } from 'googleapis';
import type { Logger } from '../utils/logger.js';
import { LAST_COLUMN, SHEET_HEADERS, type SheetsPort } from './registry.js';
import { SESSION_HEADERS, type SessionSheetPort } from './session-backup.js';

export interface SheetsOptions {
  spreadsheetId: string;
  sheetName: string;
  email: string;
  privateKey: string;
  logger: Logger;
}

const RETRYABLE_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ECONNREFUSED']);

function isRetryable(err: unknown): boolean {
  const e = err as { code?: unknown; status?: unknown; response?: { status?: unknown } };
  const status = e.response?.status ?? e.status ?? (typeof e.code === 'number' ? e.code : undefined);
  if (typeof status === 'number') return status === 429 || status >= 500;
  return typeof e.code === 'string' && RETRYABLE_CODES.has(e.code);
}

/** Faqat o'qish va sozlash chaqiruvlari uchun. Append'ni qayta urinmaymiz (dublikat xavfi). */
export async function withRetry<T>(fn: () => Promise<T>, attempts = 3, baseMs = 500): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= attempts || !isRetryable(err)) throw err;
      await new Promise((resolve) => setTimeout(resolve, baseMs * 2 ** (attempt - 1)));
    }
  }
}

export class SheetsSetupError extends Error {}

export class GoogleSheetsAdapter implements SheetsPort {
  private readonly api: sheets_v4.Sheets;
  private readonly quoted: string;
  private readonly lastColumn = LAST_COLUMN;

  constructor(private readonly opts: SheetsOptions) {
    const auth = new google.auth.JWT({
      email: opts.email,
      key: opts.privateKey,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    this.api = google.sheets({ version: 'v4', auth });
    this.quoted = `'${opts.sheetName.replace(/'/g, "''")}'`;
  }

  async verify(): Promise<void> {
    const { spreadsheetId, sheetName, logger } = this.opts;
    await withRetry(async () => {
      const meta = await this.api.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties.title' });
      const titles = (meta.data.sheets ?? []).map((s) => s.properties?.title);
      if (!titles.includes(sheetName)) {
        await this.api.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: { requests: [{ addSheet: { properties: { title: sheetName } } }] },
        });
        logger.info({ sheetName }, "Varaq yaratildi");
      }
      const head = await this.api.spreadsheets.values.get({
        spreadsheetId,
        range: `${this.quoted}!A1:${this.lastColumn}1`,
      });
      const row = (head.data.values?.[0] ?? []) as string[];
      if (row.length === 0) {
        await this.api.spreadsheets.values.update({
          spreadsheetId,
          range: `${this.quoted}!A1:${this.lastColumn}1`,
          valueInputOption: 'RAW',
          requestBody: { values: [[...SHEET_HEADERS]] },
        });
        logger.info("Sarlavhalar yozildi");
        return;
      }
      const mismatch = SHEET_HEADERS.findIndex((h, i) => row[i] !== h);
      if (mismatch !== -1) {
        // Sarlavhalar boshqacha bo'lsa, ma'lumot noto'g'ri ustunlarga tushib qolmasligi uchun to'xtaymiz
        throw new SheetsSetupError(`"${sheetName}" varag'ining ${mismatch + 1}-ustun sarlavhasi mos emas`);
      }
    });
  }

  async readRows(): Promise<string[][]> {
    return withRetry(async () => {
      const res = await this.api.spreadsheets.values.get({
        spreadsheetId: this.opts.spreadsheetId,
        range: `${this.quoted}!A2:${this.lastColumn}`,
      });
      return (res.data.values ?? []).map((r) => r.map(String));
    });
  }

  async appendRow(values: string[]): Promise<void> {
    // Bu yerda qayta urinish yo'q: noaniq xatoda qator aslida yozilgan bo'lishi mumkin, buni registry tekshiradi
    await this.api.spreadsheets.values.append({
      spreadsheetId: this.opts.spreadsheetId,
      range: `${this.quoted}!A:${this.lastColumn}`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [values] },
    });
  }
}

/** Sessiyalar zaxirasi uchun alohida varaq: `<GOOGLE_SHEET_NAME>_sessions`, ustunlar A–C. */
export class GoogleSessionSheet implements SessionSheetPort {
  private readonly api: sheets_v4.Sheets;
  private readonly quoted: string;
  readonly sheetName: string;

  constructor(private readonly opts: SheetsOptions) {
    const auth = new google.auth.JWT({
      email: opts.email,
      key: opts.privateKey,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    this.api = google.sheets({ version: 'v4', auth });
    this.sheetName = `${opts.sheetName}_sessions`;
    this.quoted = `'${this.sheetName.replace(/'/g, "''")}'`;
  }

  async verify(): Promise<void> {
    const { spreadsheetId, logger } = this.opts;
    await withRetry(async () => {
      const meta = await this.api.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties.title' });
      const titles = (meta.data.sheets ?? []).map((s) => s.properties?.title);
      if (!titles.includes(this.sheetName)) {
        await this.api.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: { requests: [{ addSheet: { properties: { title: this.sheetName } } }] },
        });
        logger.info({ sheetName: this.sheetName }, 'Sessiyalar zaxirasi varag\'i yaratildi');
      }
      const head = await this.api.spreadsheets.values.get({ spreadsheetId, range: `${this.quoted}!A1:C1` });
      const row = (head.data.values?.[0] ?? []) as string[];
      if (row.length === 0) {
        await this.api.spreadsheets.values.update({
          spreadsheetId,
          range: `${this.quoted}!A1:C1`,
          valueInputOption: 'RAW',
          requestBody: { values: [[...SESSION_HEADERS]] },
        });
        return;
      }
      if (SESSION_HEADERS.some((h, i) => row[i] !== h)) {
        throw new SheetsSetupError(`"${this.sheetName}" varag'ining sarlavhalari mos emas`);
      }
    });
  }

  readAll(): Promise<Array<{ row: number; values: string[] }>> {
    return withRetry(async () => {
      const res = await this.api.spreadsheets.values.get({
        spreadsheetId: this.opts.spreadsheetId,
        range: `${this.quoted}!A2:C`,
      });
      return (res.data.values ?? []).map((r, i) => ({ row: i + 2, values: r.map(String) }));
    });
  }

  async writeRows(updates: Array<{ row: number; values: string[] }>): Promise<void> {
    await this.api.spreadsheets.values.batchUpdate({
      spreadsheetId: this.opts.spreadsheetId,
      requestBody: {
        valueInputOption: 'RAW',
        data: updates.map((u) => ({ range: `${this.quoted}!A${u.row}:C${u.row}`, values: [u.values] })),
      },
    });
  }

  async appendRows(rows: string[][]): Promise<void> {
    await this.api.spreadsheets.values.append({
      spreadsheetId: this.opts.spreadsheetId,
      range: `${this.quoted}!A:C`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: rows },
    });
  }
}
