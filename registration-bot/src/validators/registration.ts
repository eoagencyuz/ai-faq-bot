export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

const good = <T>(value: T): Result<T> => ({ ok: true, value });
const bad = (error: string): Result<never> => ({ ok: false, error });

/** Belgilar soni (emoji va boshqa ko'p baytli belgilar bitta hisoblanadi). */
export const charCount = (value: string): number => [...value].length;

// Harf bilan boshlanib, harf bilan tugaydi; apostrof (lotin va kirill ko'rinishlari), defis va bo'shliq ruxsat etiladi
const NAME_WORD_RE = /^\p{L}[\p{L}'ʻʼ‘’`-]*$/u;

/** Ism va familiya: kamida ikki so'z, har biri harf bilan boshlanadi. */
export function validateFullName(input: string): Result<string> {
  const value = input.replace(/\s+/g, ' ').trim();
  if (!value) return bad('Ism-familiya bo‘sh bo‘lmasligi kerak.');
  const words = value.split(' ');
  if (words.length < 2) return bad('Ism va familiyangizni birga yozing. Masalan: Aliyev Vali');
  if (!words.every((w) => NAME_WORD_RE.test(w) && charCount(w) >= 2)) {
    return bad('Ism-familiya faqat harflardan iborat bo‘lishi kerak (raqam va belgilarsiz).');
  }
  if (charCount(value) > 100) return bad('Ism-familiya 100 belgidan oshmasin.');
  return good(value);
}

/** Qabul qilinadi: +998901234567, 998901234567, 901234567 (bo'shliq va chiziqchalar e'tiborsiz). */
export function normalizePhone(input: string): Result<string> {
  const digits = input.replace(/[\s\-()]/g, '');
  if (/^\+998\d{9}$/.test(digits)) return good(digits);
  if (/^998\d{9}$/.test(digits)) return good(`+${digits}`);
  if (/^\d{9}$/.test(digits)) return good(`+998${digits}`);
  return bad('Telefon raqami noto‘g‘ri. Masalan: +998901234567');
}

/** Kontakt faqat o'zining raqamini yuborishi kerak — boshqa odamning kontakti qabul qilinmaydi. */
export function contactPhone(phoneNumber: string, contactUserId: number | undefined, fromUserId: number): Result<string> {
  if (contactUserId !== fromUserId) {
    return bad('Iltimos, o‘zingizning telefon raqamingizni “📱 Raqamni ulashish” tugmasi orqali yuboring. Boshqa odamning kontakti qabul qilinmaydi.');
  }
  return normalizePhone(phoneNumber);
}

/** Uzun matnli javob: mazmuni o'zgartirilmaydi, faqat boshidagi/oxiridagi bo'shliqlar olib tashlanadi. */
export function validateLongText(input: string, min: number, max: number): Result<string> {
  const value = input.trim();
  const n = charCount(value);
  if (n === 0) return bad('Javob bo‘sh bo‘lmasligi kerak.');
  if (n < min) return bad(`Javob kamida ${min} ta belgidan iborat bo‘lsin (hozir ${n} ta).`);
  if (n > max) return bad(`Javob ${max} belgidan oshmasin (hozir ${n} ta).`);
  return good(value);
}

/** "Boshqa." varianti uchun izoh. */
export function validateNote(input: string): Result<string> {
  const value = input.replace(/\s+/g, ' ').trim();
  if (charCount(value) < 2) return bad('Izoh bo‘sh bo‘lmasligi kerak. Iltimos, qisqacha yozing.');
  if (charCount(value) > 200) return bad('Izoh 200 belgidan oshmasin.');
  return good(value);
}

/** Portfolio havolasi: http(s), nuqtali domen. Sxemasiz yozilsa https:// qo'shiladi. */
export function validatePortfolioUrl(input: string): Result<string> {
  const raw = input.trim();
  if (!raw) return bad('Havola bo‘sh bo‘lmasligi kerak.');
  if (/\s/.test(raw)) return bad('Havolada bo‘sh joy bo‘lmasligi kerak. Masalan: https://behance.net/username');
  if (raw.length > 500) return bad('Havola 500 belgidan oshmasin.');
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return bad('Havola noto‘g‘ri. Masalan: https://behance.net/username');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return bad('Faqat http:// yoki https:// havolalar qabul qilinadi.');
  }
  if (!/^[^.]+\.[^.]+/.test(url.hostname) || url.hostname.endsWith('.')) {
    return bad('Havola noto‘g‘ri. Masalan: https://behance.net/username');
  }
  return good(url.toString());
}

/** Google Sheets'da matn formula sifatida bajarilmasligi uchun. */
export function toSheetText(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

/** Loglar va admin ro'yxatlari uchun: +998 90 *** ** 67 */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 7) return '***';
  return `+${digits.slice(0, 5)}*****${digits.slice(-2)}`;
}
