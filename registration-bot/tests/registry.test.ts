import { describe, expect, it } from 'vitest';
import {
  LAST_COLUMN,
  RegistrationRegistry,
  SHEET_HEADERS,
  columnLetter,
  computeStats,
  recentRows,
  toRow,
  type SheetsPort,
} from '../src/services/registry.js';
import type { RegistrationRecord } from '../src/services/questionnaire.js';
import { sampleAnswers } from './helpers.js';

function memorySheets(opts: { failNextAppend?: 'throw' | 'write-then-throw' } = {}): SheetsPort & { rows: string[][] } {
  const rows: string[][] = [];
  let fail = opts.failNextAppend;
  return {
    rows,
    verify: async () => undefined,
    readRows: async () => rows.map((r) => [...r]),
    appendRow: async (values) => {
      if (fail === 'throw') {
        fail = undefined;
        throw new Error('503 Service Unavailable');
      }
      rows.push([...values]);
      if (fail === 'write-then-throw') {
        fail = undefined;
        throw new Error('socket hang up');
      }
    },
  };
}

const record = (userId: number, overrides: Partial<RegistrationRecord> = {}): RegistrationRecord => ({
  id: `REG-${userId}`,
  createdAt: new Date('2026-10-12T09:00:00Z'),
  userId,
  username: 'ali',
  answers: sampleAnswers(),
  subscriptionVerified: true,
  ...overrides,
});

describe('RegistrationRegistry.save', () => {
  it('yangi foydalanuvchini bir marta yozadi', async () => {
    const sheets = memorySheets();
    const registry = new RegistrationRegistry(sheets, 'Asia/Tashkent');
    expect(await registry.save(record(1))).toBe('saved');
    expect(sheets.rows).toHaveLength(1);
    expect(await registry.isRegistered(1)).toBe(true);
  });

  it('takroriy so\'rov dublikat yozuv yaratmaydi', async () => {
    const sheets = memorySheets();
    const registry = new RegistrationRegistry(sheets, 'Asia/Tashkent');
    await registry.save(record(1));
    expect(await registry.save(record(1))).toBe('duplicate');
    expect(sheets.rows).toHaveLength(1);
  });

  it('bir vaqtda kelgan so\'rovlar bitta yozuv qoldiradi', async () => {
    const sheets = memorySheets();
    const registry = new RegistrationRegistry(sheets, 'Asia/Tashkent');
    const outcomes = await Promise.all([registry.save(record(5)), registry.save(record(5)), registry.save(record(5))]);
    expect(outcomes.sort()).toEqual(['duplicate', 'duplicate', 'saved']);
    expect(sheets.rows).toHaveLength(1);
  });

  it('noaniq xatoda qator aslida yozilgan bo\'lsa, qayta qo\'shmaydi', async () => {
    const sheets = memorySheets({ failNextAppend: 'write-then-throw' });
    const registry = new RegistrationRegistry(sheets, 'Asia/Tashkent');
    expect(await registry.save(record(9))).toBe('saved');
    expect(sheets.rows).toHaveLength(1);
  });

  it('yozish xatosi bo\'lsa, xato uzatiladi (muvaffaqiyat deb hisoblanmaydi)', async () => {
    const sheets = memorySheets({ failNextAppend: 'throw' });
    const registry = new RegistrationRegistry(sheets, 'Asia/Tashkent');
    await expect(registry.save(record(10))).rejects.toThrow(/503/);
    expect(sheets.rows).toHaveLength(0);
  });
});

describe('RegistrationRegistry keshi', () => {
  it("bir vaqtdagi tekshiruvlar bitta o'qishga birlashadi va keshdan foydalanadi", async () => {
    const sheets = memorySheets();
    let reads = 0;
    const read = sheets.readRows;
    sheets.readRows = async () => {
      reads++;
      return read();
    };
    let clock = 0;
    const registry = new RegistrationRegistry(sheets, 'Asia/Tashkent', 30_000, () => clock);
    await Promise.all(Array.from({ length: 50 }, (_, i) => registry.isRegistered(i)));
    expect(reads).toBe(1);
    await registry.isRegistered(1);
    expect(reads).toBe(1);
    clock += 31_000;
    await registry.isRegistered(1);
    expect(reads).toBe(2);
  });

  it("saqlangan qator keshga darhol qo'shiladi (qayta yuborish dublikat bo'lmaydi)", async () => {
    const sheets = memorySheets();
    const registry = new RegistrationRegistry(sheets, 'Asia/Tashkent', 60_000, () => 0);
    expect(await registry.isRegistered(3)).toBe(false);
    expect(await registry.save(record(3))).toBe('saved');
    expect(await registry.isRegistered(3)).toBe(true);
    expect(await registry.save(record(3))).toBe('duplicate');
    expect(sheets.rows).toHaveLength(1);
  });

  it('noaniq xatoda keshsiz qayta tekshiriladi', async () => {
    const sheets = memorySheets({ failNextAppend: 'write-then-throw' });
    const registry = new RegistrationRegistry(sheets, 'Asia/Tashkent', 60_000, () => 0);
    await registry.isRegistered(4);
    expect(await registry.save(record(4))).toBe('saved');
    expect(sheets.rows).toHaveLength(1);
  });
});

describe('toRow', () => {
  const col = (name: (typeof SHEET_HEADERS)[number]) => SHEET_HEADERS.indexOf(name);

  it("barqaror ustunlar, o'qiladigan ko'p tanlov va bitta telefon ustuni", () => {
    const row = toRow(record(1), 'Asia/Tashkent');
    expect(row).toHaveLength(SHEET_HEADERS.length);
    expect(SHEET_HEADERS).toHaveLength(30);
    expect(LAST_COLUMN).toBe('AD');
    expect(row[col('Created At')]).toBe('2026-10-12 14:00:00');
    expect(row[col('Full Name')]).toBe('Aliyev Vali');
    expect(row[col('Phone')]).toBe('+998901234567');
    expect(SHEET_HEADERS.filter((h) => /phone/i.test(h) && h !== 'Telegram Phone Match')).toEqual(['Phone']);
    expect(row[col('Program')]).toBe('Dasturiy injiniring');
    expect(row[col('Work Field')]).toBe('Hozir ishlamayman.');
    expect(row[col('Media Interests')]).toBe('SMM va ijtimoiy tarmoqlar.; Reels va qisqa videolar yaratish.');
    expect(row[col('AI Tools')]).toBe('ChatGPT.; Claude.');
    expect(row[col('Has Portfolio')]).toBe('Yo‘q');
    expect(row[col('Portfolio URL')]).toBe('');
    expect(row[col('Registration Status')]).toBe('Yakunlandi');
  });

  it("'Boshqa' izohi va portfolio havolasi alohida ustunlarda", () => {
    const answers = sampleAnswers();
    answers.occupation = { kind: 'choice', optionId: 'other', note: 'Volontyorman' };
    answers.work_field = { kind: 'choice', optionId: 'other', note: 'Tadbirlar' };
    answers.portfolio = { kind: 'portfolio', hasPortfolio: true, url: 'https://behance.net/ali' };
    const row = toRow(record(1, { answers }), 'Asia/Tashkent');
    expect(row[col('Occupation')]).toBe('Boshqa.');
    expect(row[col('Occupation Other')]).toBe('Volontyorman');
    expect(row[col('Work Field Other')]).toBe('Tadbirlar');
    expect(row[col('Has Portfolio')]).toBe('Ha');
    expect(row[col('Portfolio URL')]).toBe('https://behance.net/ali');
  });

  it('formulalardan himoyalaydi', () => {
    const answers = sampleAnswers();
    answers.motivation = { kind: 'text', value: '=HYPERLINK("x") bu matn formula bolmasligi kerak' };
    const row = toRow(record(1, { username: '=cmd', answers }), 'Asia/Tashkent');
    expect(row[col('Telegram Username')]).toBe("'=cmd");
    expect(row[col('Motivation')]!.startsWith("'=")).toBe(true);
  });
});

describe('columnLetter', () => {
  it('ustun harflarini hisoblaydi', () => {
    expect([1, 14, 26, 27, 30].map(columnLetter)).toEqual(['A', 'N', 'Z', 'AA', 'AD']);
  });
});

describe('computeStats', () => {
  const rows = [
    ['R1', '2026-10-12 10:00:00', '1'],
    ['R2', '2026-10-10 10:00:00', '2'],
    ['R3', '2026-09-20 10:00:00', '3'],
    ['R4', '2026-08-01 10:00:00', '4'],
    ['', '', ''],
  ];

  it('bugun, 7 kun va 30 kun bo\'yicha hisoblaydi (Asia/Tashkent)', () => {
    const stats = computeStats(rows, new Date('2026-10-12T09:00:00Z'), 'Asia/Tashkent');
    expect(stats).toEqual({ total: 4, today: 1, last7: 2, last30: 3 });
  });

  it('oxirgi yozuvlarni teskari tartibda qaytaradi', () => {
    expect(recentRows(rows, 2).map((r) => r[0])).toEqual(['R4', 'R3']);
  });
});
