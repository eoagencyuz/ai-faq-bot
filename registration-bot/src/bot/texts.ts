import type { FieldKey } from '../types/index.js';
import { FIELD_LABELS, displayValue, type Draft } from '../services/registration.js';

export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export const FIELD_PROMPTS: Record<FieldKey, string> = {
  first_name: 'Ismingizni kiriting:',
  last_name: 'Familiyangizni kiriting:',
  phone: "Telefon raqamingizni yuboring: pastdagi tugmani bosing yoki raqamni yozing (masalan: 90 123 45 67).",
  birth_date: "Tug'ilgan sanangizni DD.MM.YYYY formatida yozing (masalan: 15.05.2005):",
  gender: 'Jinsingizni tanlang (ixtiyoriy):',
  region: 'Viloyat yoki shahringizni tanlang yoki yozing:',
  district: 'Tumaningizni tanlang yoki yozing:',
  additional_info: "Qo'shimcha ma'lumot (ixtiyoriy). Yozing yoki o'tkazib yuboring:",
};

export const BTN = {
  back: '⬅️ Orqaga',
  cancel: '❌ Bekor qilish',
};

export const TEXT = {
  welcome:
    "Assalomu alaykum!\n\nRo'yxatdan o'tish botiga xush kelibsiz.\n\n" +
    "Ro'yxatdan o'tishni boshlash uchun quyidagi ikkita Telegram kanaliga obuna bo'ling va " +
    'obunani tekshirish tugmasini bosing.\n\n' +
    "🔒 Ma'lumotlaringiz faqat ro'yxatdan o'tish uchun yig'iladi va uchinchi shaxslarga berilmaydi.",
  verified: "Rahmat! Ikkala kanalga obunangiz tasdiqlandi.\n\nEndi ro'yxatdan o'tishingiz mumkin.",
  missing: (names: string[]) =>
    "Siz quyidagi kanal(lar)ga obuna bo'lmagansiz:\n" +
    names.map((n) => `• ${escapeHtml(n)}`).join('\n') +
    '\n\nObuna bo\'lib, "✅ Obunani tekshirish" tugmasini bosing.',
  subscriptionError:
    "Obunangizni hozir tekshira olmadik (vaqtinchalik xato). Bir ozdan so'ng \"🔁 Qayta urinish\" tugmasini bosing.",
  alreadyRegistered:
    "Siz avval ro'yxatdan o'tgansiz. Agar ma'lumotlaringizni o'zgartirish kerak bo'lsa, administratorga murojaat qiling.",
  success: "🎉 Ro'yxatdan o'tish muvaffaqiyatli yakunlandi!\n\nMa'lumotlaringiz saqlandi. Rahmat!",
  saveError:
    "Ma'lumotlarni saqlashda vaqtinchalik xato yuz berdi. Ma'lumotlaringiz yo'qolmadi — " +
    '"🔁 Qayta urinish" tugmasi bilan qayta urinib ko\'ring.',
  tempError: "Kechirasiz, vaqtinchalik xato yuz berdi. Iltimos, /start bosib qayta urinib ko'ring.",
  stale: 'Bu tugma eskirgan. Jarayonni davom ettirish uchun /start bosing.',
  cancelled: "Ro'yxatdan o'tish bekor qilindi. Qayta boshlash uchun /start bosing.",
  resume: "Sizda tugallanmagan ro'yxatdan o'tish bor. Davom ettirasizmi?",
  confirmHeader: '📋 <b>Ma\'lumotlaringizni tekshiring:</b>',
  confirmQuestion: "Ma'lumotlar to'g'rimi?",
  editMenu: "Qaysi ma'lumotni o'zgartirmoqchisiz?",
  useButtons: 'Iltimos, tugmalardan birini tanlang.',
  unknownCommand: "Noma'lum buyruq. /start bosing.",
  tooLong: 'Xabar juda uzun. Iltimos, qisqaroq yozing.',
  rateLimited: "Biroz sekinroq 🙂 Bir necha soniyadan so'ng yozing.",
  contactNotExpected: "Telefon raqamini hozir so'ramayapmiz. Ro'yxatdan o'tishni /start bilan boshlang.",
  phoneSaved: '✅ Telefon raqami qabul qilindi.',
  backFromPhone: '⬅️ Oldingi savolga qaytdingiz.',
  noBack: 'Bu birinchi savol, orqaga qaytib bo\'lmaydi.',
  startHint: "Ro'yxatdan o'tish uchun /start bosing.",
  subscribeHint: 'Avval kanallarga obuna bo\'ling va "✅ Obunani tekshirish" tugmasini bosing.',
  dataChanged: "⚠️ Ba'zi ma'lumotlar eskirgan yoki noto'g'ri. Iltimos, qayta kiriting.",
  adminMenu: '🛠 <b>Admin menyusi</b>',
  adminSheetsDown: "Google Sheets bilan bog'lanib bo'lmadi. Statistika ko'rsatilmaydi. Loglarni tekshiring.",
  sheetsOk: '✅ Google Sheets ulanishi ishlayapti.',
  sheetsBad: "❌ Google Sheets bilan muammo bor. Loglarni tekshiring.",
  help: "ℹ️ <b>Yordam</b>\n\n/start — ro'yxatdan o'tishni boshlash\n/cancel — jarayonni bekor qilish",
};

export function summaryText(draft: Draft, fields: FieldKey[]): string {
  return fields
    .map((f) => `• ${FIELD_LABELS[f]}: <b>${escapeHtml(displayValue(f, draft.data[f]))}</b>`)
    .join('\n');
}
