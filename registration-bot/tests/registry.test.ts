import { describe, expect, it } from 'vitest';
import { RegistrationRegistry, computeStats, recentRows, toRow, type SheetsPort } from '../src/services/registry.js';
import type { RegistrationRecord } from '../src/types/index.js';

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
  firstName: 'Ali',
  lastName: 'Valiyev',
  phone: '+998901234567',
  birthDate: '15.05.2005',
  gender: 'male',
  region: 'Qashqadaryo',
  district: 'Qarshi',
  additionalInfo: '',
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

describe('toRow', () => {
  it('telefonni matn sifatida saqlaydi va formulalardan himoyalaydi', () => {
    const row = toRow(record(1, { username: '=cmd', additionalInfo: '+1+1' }), 'Asia/Tashkent');
    expect(row[6]).toBe('+998901234567');
    expect(row[3]).toBe("'=cmd");
    expect(row[11]).toBe("'+1+1");
    expect(row[8]).toBe('Erkak');
    expect(row[1]).toBe('2026-10-12 14:00:00');
    expect(row).toHaveLength(14);
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
