import { describe, expect, it } from 'vitest';
import {
  contactPhone,
  normalizePhone,
  parseBirthDate,
  parseGender,
  toSheetText,
  validateDistrict,
  validateName,
  validateRegion,
} from '../src/validators/registration.js';

describe('validateName', () => {
  it('kirill va lotin harflarini qabul qiladi, qiymatni o\'zgartirmaydi', () => {
    expect(validateName('  Ali  Vali ', 'Ism')).toEqual({ ok: true, value: 'Ali Vali' });
    expect(validateName("Abdullayev", 'Familiya')).toEqual({ ok: true, value: 'Abdullayev' });
    expect(validateName('Валиев', 'Familiya')).toEqual({ ok: true, value: 'Валиев' });
    expect(validateName("O'roqov", 'Familiya').ok).toBe(true);
  });

  it('bo\'sh, qisqa va raqamli qiymatni rad etadi', () => {
    expect(validateName('', 'Ism').ok).toBe(false);
    expect(validateName('A', 'Ism').ok).toBe(false);
    expect(validateName('Ali2', 'Ism').ok).toBe(false);
    expect(validateName('Ali!!', 'Ism').ok).toBe(false);
    expect(validateName('x'.repeat(51), 'Ism').ok).toBe(false);
  });
});

describe('normalizePhone', () => {
  it("O'zbekiston raqamlarini +998 formatiga keltiradi", () => {
    expect(normalizePhone('+998 90 123 45 67')).toEqual({ ok: true, value: '+998901234567' });
    expect(normalizePhone('998901234567')).toEqual({ ok: true, value: '+998901234567' });
    expect(normalizePhone('90-123-45-67')).toEqual({ ok: true, value: '+998901234567' });
  });

  it('noto\'g\'ri raqamni rad etadi', () => {
    expect(normalizePhone('12345').ok).toBe(false);
    expect(normalizePhone('+7 999 123 45 67').ok).toBe(false);
    expect(normalizePhone('abc').ok).toBe(false);
  });
});

describe('contactPhone', () => {
  it('faqat o\'zining kontaktini qabul qiladi', () => {
    expect(contactPhone('+998901234567', 42, 42).ok).toBe(true);
    expect(contactPhone('+998901234567', 99, 42).ok).toBe(false);
    expect(contactPhone('+998901234567', undefined, 42).ok).toBe(false);
  });
});

describe('parseBirthDate', () => {
  const today = '2026-10-12';

  it('to\'g\'ri sanani qabul qiladi', () => {
    expect(parseBirthDate('15.05.2005', today)).toEqual({ ok: true, value: '15.05.2005' });
  });

  it('mavjud bo\'lmagan va kelajak sanalarni rad etadi', () => {
    expect(parseBirthDate('31.02.2005', today).ok).toBe(false);
    expect(parseBirthDate('01.01.2030', today).ok).toBe(false);
    expect(parseBirthDate('2005-05-15', today).ok).toBe(false);
    expect(parseBirthDate('15.05.1800', today).ok).toBe(false);
  });
});

describe('gender, region, district', () => {
  it('jins faqat ruxsat etilgan kalitlarni qabul qiladi', () => {
    expect(parseGender('male').ok).toBe(true);
    expect(parseGender('xxx').ok).toBe(false);
  });

  it('ro\'yxat berilganda faqat ro\'yxatdagi viloyat va tuman qabul qilinadi', () => {
    const regions = { Qashqadaryo: ['Qarshi', 'Kitob'] };
    expect(validateRegion('Qashqadaryo', regions).ok).toBe(true);
    expect(validateRegion('Toshkent', regions).ok).toBe(false);
    expect(validateDistrict('Qarshi', regions, 'Qashqadaryo').ok).toBe(true);
    expect(validateDistrict('Shahrisabz', regions, 'Qashqadaryo').ok).toBe(false);
  });

  it('ro\'yxat berilmaganda matn qabul qilinadi', () => {
    expect(validateRegion('Qashqadaryo', null).ok).toBe(true);
    expect(validateDistrict('Qarshi', null, undefined).ok).toBe(true);
  });
});

describe('toSheetText', () => {
  it('formula sifatida bajarilishi mumkin bo\'lgan matnni himoyalaydi', () => {
    expect(toSheetText('=HYPERLINK("x")')).toBe('\'=HYPERLINK("x")');
    expect(toSheetText('+998901234567')).toBe("'+998901234567");
    expect(toSheetText('Ali')).toBe('Ali');
  });
});
