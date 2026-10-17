import { TOTAL_QUESTIONS, optionsOf, type Question } from '../services/questionnaire.js';
import { hasLongLabels } from './keyboards.js';

export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export const TEXT = {
  welcome:
    'Assalomu alaykum!\n\n<b>Media & AI shogirdlik dasturi</b> anketasiga xush kelibsiz.\n\n' +
    'Anketani to‘ldirish uchun quyidagi ikkita Telegram kanaliga obuna bo‘ling va ' +
    '“✅ Obunani tekshirish” tugmasini bosing.\n\n' +
    '🔒 Ma’lumotlaringiz faqat anketani ko‘rib chiqish va siz bilan bog‘lanish uchun ishlatiladi.',
  verified:
    'Rahmat! Ikkala kanalga obunangiz tasdiqlandi.\n\n' +
    '📋 <b>Anketa qoidalari:</b>\n' +
    `• Anketa ${TOTAL_QUESTIONS} ta savoldan iborat.\n` +
    '• Har bir savolga faqat bir marta javob beriladi.\n' +
    '• Javob qabul qilingandan keyin uni o‘zgartirib yoki orqaga qaytib bo‘lmaydi — diqqat bilan javob bering.\n' +
    '• Variantni tanlab, “➡️ Keyingi” tugmasini bosing.\n' +
    '• Anketa faqat barcha savollarga javob berilgandan keyin yuboriladi.\n\n' +
    'Tayyor bo‘lsangiz, “📝 Anketani boshlash” tugmasini bosing.',
  missing: (names: string[]) =>
    'Siz quyidagi kanal(lar)ga obuna bo‘lmagansiz:\n' +
    names.map((n) => `• ${escapeHtml(n)}`).join('\n') +
    '\n\nObuna bo‘lib, “✅ Obunani tekshirish” tugmasini bosing.',
  subscriptionError:
    'Obunangizni hozir tekshira olmadik (vaqtinchalik xato). Bir ozdan so‘ng “🔁 Qayta urinish” tugmasini bosing.',
  alreadyRegistered:
    'Siz anketani allaqachon topshirgansiz. Anketani qayta yuborib yoki o‘zgartirib bo‘lmaydi. ' +
    'Savollar bo‘lsa, administratorga murojaat qiling.',
  success:
    '🎉 Media & AI shogirdlik anketangiz muvaffaqiyatli qabul qilindi!\n' +
    'Ma’lumotlaringiz uchun rahmat. Anketangiz ko‘rib chiqiladi. Keyingi bosqich bo‘yicha siz bilan bog‘lanishimiz mumkin.',
  saving: '⏳ Anketangiz saqlanmoqda, biroz kuting…',
  saveError:
    'Anketani saqlashda vaqtinchalik xato yuz berdi. Javoblaringiz yo‘qolmadi — ' +
    '“🔁 Qayta urinish” tugmasi bilan qayta urinib ko‘ring.',
  invalidStored:
    'Anketangizni tekshirishda muammo topildi va u yuborilmadi. Iltimos, administratorga murojaat qiling.',
  tempError: 'Kechirasiz, vaqtinchalik xato yuz berdi. Javobingiz qabul qilinmadi — iltimos, qayta yuboring.',
  stale: 'Bu tugma endi faol emas.',
  sessionLost:
    '⚠️ Anketangiz holati topilmadi (bot qayta ishga tushgan bo‘lishi mumkin). Davom etish uchun /start bosing.',
  alreadyAnswered: 'Bu savolga javob berib bo‘lingan.',
  resume: '▶️ Anketangiz shu savoldan davom etadi:',
  useButtons: 'Iltimos, javobni tugmalar orqali tanlang va “➡️ Keyingi” tugmasini bosing.',
  useContactButton: 'Iltimos, raqamingizni pastdagi “📱 Raqamni ulashish” tugmasi orqali yuboring.',
  useConfirmButton: 'Iltimos, yuqoridagi “✅ Tasdiqlayman” tugmasini bosing.',
  unknownCommand: 'Noma’lum buyruq. /start bosing.',
  unsupported: 'Iltimos, javobni matn ko‘rinishida yozing yoki tugmalardan foydalaning.',
  tooLong: 'Xabar juda uzun. Iltimos, qisqaroq yozing.',
  contactNotExpected: 'Hozir telefon kontakti so‘ralmayapti.',
  contactSaved: '✅ Telefon raqami qabul qilindi.',
  phoneMismatch: (manual: string, telegram: string) =>
    '⚠️ Kiritgan raqamingiz Telegram raqamingizdan farq qiladi:\n' +
    `• Kiritilgan raqam: <b>${escapeHtml(manual)}</b>\n` +
    `• Telegram raqami: <b>${escapeHtml(telegram)}</b>\n\n` +
    'Ikkala raqam ham sizniki ekanini tasdiqlaysizmi? Siz bilan kiritilgan raqam orqali bog‘lanamiz.',
  otherNote: '✍️ “Boshqa.” variantini tanladingiz. Iltimos, qisqacha izoh yozing:',
  portfolioUrl: '🔗 Portfolio havolasini yuboring (masalan: https://behance.net/username):',
  startHint: 'Anketani boshlash uchun /start bosing.',
  subscribeHint: 'Avval kanallarga obuna bo‘ling va “✅ Obunani tekshirish” tugmasini bosing.',
  noCancel:
    'Anketani bekor qilib yoki qayta boshlab bo‘lmaydi. Javob berishni shu savoldan davom ettirishingiz mumkin.',
  adminMenu: '🛠 <b>Admin menyusi</b>',
  broadcastAsk:
    '📣 <b>Rassilka</b>\n\nAnketa topshirgan barcha talabalarga yuboriladigan xabarni jo‘nating: matn, rasm, video yoki fayl (izohi bilan).\n\nBekor qilish: /cancel',
  broadcastPreview: (n: number) =>
    `👆 Shu xabar <b>${n}</b> ta talabaga yuboriladi. Tasdiqlaysizmi?`,
  broadcastNoRecipients: 'Hozircha anketa topshirgan talabalar yo‘q — rassilka yuborilmadi.',
  broadcastStarted: (n: number) => `⏳ Rassilka boshlandi: ${n} ta talaba. Tugagach hisobot yuboriladi.`,
  broadcastBusy: 'Boshqa rassilka hali davom etyapti. U tugagach qayta urinib ko‘ring.',
  broadcastCancelled: 'Rassilka bekor qilindi.',
  broadcastReport: (s: { total: number; sent: number; blocked: number; failed: number }) =>
    '📣 <b>Rassilka yakunlandi</b>\n\n' +
    `👥 Jami: <b>${s.total}</b>\n` +
    `✅ Yetkazildi: <b>${s.sent}</b>\n` +
    `🚫 Botni bloklagan: <b>${s.blocked}</b>\n` +
    `⚠️ Xato: <b>${s.failed}</b>`,
  adminSheetsDown: 'Google Sheets bilan bog‘lanib bo‘lmadi. Statistika ko‘rsatilmaydi. Loglarni tekshiring.',
  sheetsOk: '✅ Google Sheets ulanishi ishlayapti.',
  sheetsBad: '❌ Google Sheets bilan muammo bor. Loglarni tekshiring.',
  help:
    'ℹ️ <b>Yordam</b>\n\n/start — anketani boshlash yoki davom ettirish\n\n' +
    'Har bir savolga bir marta javob beriladi, javoblarni o‘zgartirib bo‘lmaydi.',
};

const HINT: Record<Question['kind'], string> = {
  full_name: 'Masalan: Aliyev Vali',
  phone_manual: '',
  phone_contact: 'Pastdagi “📱 Raqamni ulashish” tugmasini bosing.',
  text: '',
  single: 'Bitta variantni tanlang va “➡️ Keyingi” tugmasini bosing.',
  multi: 'Variantlarni belgilang va “➡️ Keyingi” tugmasini bosing.',
  portfolio: 'Variantni tanlang va “➡️ Keyingi” tugmasini bosing.',
};

export function questionText(index: number, q: Question): string {
  const lines = [`<b>Savol ${index + 1}/${TOTAL_QUESTIONS}</b>`, '', escapeHtml(q.text)];
  if (hasLongLabels(q)) {
    lines.push('', ...optionsOf(q).map((o, i) => `${i + 1}. ${escapeHtml(o.label)}`));
  }
  const hint = q.kind === 'text' ? `Javobni yozing (${q.min}–${q.max} belgi).` : HINT[q.kind];
  if (hint) lines.push('', `<i>${escapeHtml(hint)}</i>`);
  return lines.join('\n');
}
