import { describe, expect, it } from 'vitest';
import {
  contactPhone,
  maskPhone,
  normalizePhone,
  toSheetText,
  validateFullName,
  validateLongText,
  validateNote,
  validatePortfolioUrl,
} from '../src/validators/registration.js';

describe('validateFullName', () => {
  it('ism va familiyani qabul qiladi (lotin, kirill, apostrof)', () => {
    expect(validateFullName('  Aliyev   Vali ')).toEqual({ ok: true, value: 'Aliyev Vali' });
    expect(validateFullName('Валиев Али').ok).toBe(true);
    expect(validateFullName("O'roqov G‘ayrat").ok).toBe(true);
  });

  it("bo'sh, bitta so'z, raqam va belgilarni rad etadi", () => {
    expect(validateFullName('').ok).toBe(false);
    expect(validateFullName('   ').ok).toBe(false);
    expect(validateFullName('Ali').ok).toBe(false);
    expect(validateFullName('Ali 2Vali').ok).toBe(false);
    expect(validateFullName('Ali !!').ok).toBe(false);
  });
});

describe('normalizePhone', () => {
  it("O'zbekiston raqamlarini +998 formatiga keltiradi", () => {
    expect(normalizePhone('+998901234567')).toEqual({ ok: true, value: '+998901234567' });
    expect(normalizePhone('+998 90 123 45 67')).toEqual({ ok: true, value: '+998901234567' });
    expect(normalizePhone('998901234567')).toEqual({ ok: true, value: '+998901234567' });
    expect(normalizePhone('90-123-45-67')).toEqual({ ok: true, value: '+998901234567' });
  });

  it("noto'g'ri raqamni rad etadi", () => {
    expect(normalizePhone('').ok).toBe(false);
    expect(normalizePhone('12345').ok).toBe(false);
    expect(normalizePhone('+7 999 123 45 67').ok).toBe(false);
    expect(normalizePhone('+9989012345678').ok).toBe(false);
    expect(normalizePhone('abc').ok).toBe(false);
  });
});

describe('contactPhone', () => {
  it("faqat o'zining kontaktini qabul qiladi", () => {
    expect(contactPhone('998901234567', 42, 42)).toEqual({ ok: true, value: '+998901234567' });
    expect(contactPhone('+998901234567', 99, 42).ok).toBe(false);
    expect(contactPhone('+998901234567', undefined, 42).ok).toBe(false);
  });
});

describe('validateLongText', () => {
  it("chegaralarni belgilar soni bo'yicha tekshiradi va matnni o'zgartirmaydi", () => {
    const text = 'Birinchi qator.\nIkkinchi qator — to‘liq saqlanadi!';
    expect(validateLongText(`  ${text}  `, 30, 1000)).toEqual({ ok: true, value: text });
    expect(validateLongText('qisqa', 30, 1000).ok).toBe(false);
    expect(validateLongText('   ', 30, 1000).ok).toBe(false);
    expect(validateLongText('x'.repeat(1001), 30, 1000).ok).toBe(false);
    expect(validateLongText('x'.repeat(1000), 30, 1000).ok).toBe(true);
  });
});

describe('validateNote', () => {
  it("bo'sh izohni rad etadi", () => {
    expect(validateNote('').ok).toBe(false);
    expect(validateNote('  ').ok).toBe(false);
    expect(validateNote('Volontyorlik')).toEqual({ ok: true, value: 'Volontyorlik' });
  });
});

describe('validatePortfolioUrl', () => {
  it('http(s) havolalarni qabul qiladi, sxemasizga https qo\'shadi', () => {
    expect(validatePortfolioUrl('https://behance.net/ali')).toEqual({ ok: true, value: 'https://behance.net/ali' });
    expect(validatePortfolioUrl('instagram.com/ali')).toEqual({ ok: true, value: 'https://instagram.com/ali' });
  });

  it("noto'g'ri havolalarni rad etadi", () => {
    expect(validatePortfolioUrl('').ok).toBe(false);
    expect(validatePortfolioUrl('portfolio yoq').ok).toBe(false);
    expect(validatePortfolioUrl('javascript:alert(1)').ok).toBe(false);
    expect(validatePortfolioUrl('ftp://site.com').ok).toBe(false);
    expect(validatePortfolioUrl('localhost').ok).toBe(false);
  });
});

describe('maskPhone', () => {
  it("raqamning o'rtasini yashiradi", () => {
    expect(maskPhone('+998901234567')).toBe('+99890*****67');
  });
});

describe('toSheetText', () => {
  it("formula sifatida bajarilishi mumkin bo'lgan matnni himoyalaydi", () => {
    expect(toSheetText('=HYPERLINK("x")')).toBe('\'=HYPERLINK("x")');
    expect(toSheetText('+998901234567')).toBe("'+998901234567");
    expect(toSheetText('Ali')).toBe('Ali');
  });
});
