import type { Gender, Regions } from '../types/index.js';

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

const good = <T>(value: T): Result<T> => ({ ok: true, value });
const bad = (error: string): Result<never> => ({ ok: false, error });

export const GENDER_LABELS: Record<Gender, string> = {
  male: 'Erkak',
  female: 'Ayol',
  skip: "Ko'rsatilmagan",
};

// Harf bilan boshlanib, harf bilan tugaydi; apostrof (lotin va kirill ko'rinishlari), defis va bo'shliq ruxsat etiladi
const NAME_RE = /^\p{L}[\p{L}'ʻʼ‘’`\- ]*\p{L}$/u;

export function validateName(input: string, label: string): Result<string> {
  const value = input.replace(/\s+/g, ' ').trim();
  if (value.length < 2) return bad(`${label} kamida 2 ta harfdan iborat bo'lsin.`);
  if (value.length > 50) return bad(`${label} 50 belgidan oshmasin.`);
  if (!NAME_RE.test(value)) return bad(`${label} faqat harflardan iborat bo'lishi kerak (raqam va belgilarsiz).`);
  return good(value);
}

/** Qabul qilinadi: +998901234567, 998901234567, 901234567 (bo'shliq va chiziqchalar e'tiborsiz). */
export function normalizePhone(input: string): Result<string> {
  const digits = input.replace(/[\s\-()]/g, '');
  if (/^\+998\d{9}$/.test(digits)) return good(digits);
  if (/^998\d{9}$/.test(digits)) return good(`+${digits}`);
  if (/^\d{9}$/.test(digits)) return good(`+998${digits}`);
  return bad("Telefon raqami noto'g'ri. Masalan: +998 90 123 45 67 yoki 90 123 45 67.");
}

/** Kontakt faqat o'zining raqamini yuborishi kerak — boshqa odamning kontakti qabul qilinmaydi. */
export function contactPhone(phoneNumber: string, contactUserId: number | undefined, fromUserId: number): Result<string> {
  if (contactUserId !== fromUserId) {
    return bad("Iltimos, o'zingizning telefon raqamingizni yuboring. Boshqa odamning kontaktini yuborish mumkin emas.");
  }
  return normalizePhone(phoneNumber);
}

/** Format DD.MM.YYYY. Kelajak va mavjud bo'lmagan sanalar rad etiladi. */
export function parseBirthDate(input: string, todayIso: string): Result<string> {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(input.trim());
  if (!m) return bad("Sanani DD.MM.YYYY ko'rinishida yozing, masalan: 15.05.2005");
  const dd = m[1];
  const mm = m[2];
  const yyyy = m[3];
  const iso = `${yyyy}-${mm}-${dd}`;
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== iso) {
    return bad('Bunday sana mavjud emas. Qaytadan kiriting.');
  }
  if (Number(yyyy) < 1920) return bad("Yil 1920 dan kichik bo'lmasin. Sanani tekshirib kiriting.");
  if (iso > todayIso) return bad("Tug'ilgan sana kelajakda bo'lishi mumkin emas.");
  return good(`${dd}.${mm}.${yyyy}`);
}

export function parseGender(key: string): Result<Gender> {
  return key === 'male' || key === 'female' || key === 'skip' ? good(key) : bad('Jinsni tugmalardan tanlang.');
}

export function validateText(input: string, label: string, min: number, max: number): Result<string> {
  const value = input.replace(/\s+/g, ' ').trim();
  if (value.length < min) return bad(`${label} kamida ${min} ta belgidan iborat bo'lsin.`);
  if (value.length > max) return bad(`${label} ${max} belgidan oshmasin.`);
  return good(value);
}

export function validateOptionalText(input: string, max: number): Result<string> {
  const value = input.replace(/\s+/g, ' ').trim();
  if (value.length > max) return bad(`Matn ${max} belgidan oshmasin.`);
  return good(value);
}

const has = (obj: object, key: string) => Object.prototype.hasOwnProperty.call(obj, key);

export function validateRegion(input: string, regions: Regions): Result<string> {
  if (regions) {
    const value = input.trim();
    return has(regions, value) ? good(value) : bad("Ro'yxatdan viloyatni tanlang.");
  }
  return validateText(input, 'Viloyat nomi', 2, 60);
}

export function validateDistrict(input: string, regions: Regions, region: string | undefined): Result<string> {
  const list = regions && region && has(regions, region) ? regions[region] : undefined;
  if (list && list.length > 0) {
    const value = input.trim();
    return list.includes(value) ? good(value) : bad("Ro'yxatdan tumanni tanlang.");
  }
  return validateText(input, 'Tuman nomi', 2, 60);
}

/** Google Sheets'da matn formula sifatida bajarilmasligi uchun. */
export function toSheetText(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}
