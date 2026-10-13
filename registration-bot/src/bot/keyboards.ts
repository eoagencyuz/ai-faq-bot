import type {
  InlineKeyboardButton,
  InlineKeyboardMarkup,
  KeyboardButton,
  ReplyKeyboardMarkup,
  ReplyKeyboardRemove,
} from 'telegraf/types';
import type { ChannelConfig } from '../types/index.js';
import { optionsOf, validateSelection, type Question } from '../services/questionnaire.js';

export type Markup = InlineKeyboardMarkup | ReplyKeyboardMarkup | ReplyKeyboardRemove;

/** Tugma rangi: primary — ko'k, success — yashil, danger — qizil. Rangni bilmaydigan Telegram ilovalarida tugma oddiy ko'rinadi. */
export type ButtonStyle = 'primary' | 'success' | 'danger';

const cb = (text: string, data: string, style?: ButtonStyle): InlineKeyboardButton =>
  ({ text, callback_data: data, ...(style ? { style } : {}) }) as InlineKeyboardButton;

const link = (text: string, url: string, style?: ButtonStyle): InlineKeyboardButton =>
  ({ text, url, ...(style ? { style } : {}) }) as InlineKeyboardButton;

/** Telegram rangni qabul qilmasa, xabarni rangsiz qayta yuborish uchun. */
export function withoutStyles<T extends Markup>(markup: T): T {
  return JSON.parse(JSON.stringify(markup, (key, value) => (key === 'style' ? undefined : value))) as T;
}

export const hasStyles = (markup: Markup): boolean => JSON.stringify(markup).includes('"style"');

export const subscribeKeyboard = (channels: ChannelConfig[]): InlineKeyboardMarkup => ({
  inline_keyboard: [
    // Kanal tugmalari rangsiz (Telegram mavzusidagi oddiy rang), faqat tekshirish tugmasi yashil
    ...channels.map((c, i): InlineKeyboardButton[] => [link(`${i + 1}. ${c.name}`, c.url)]),
    [cb('✅ Obunani tekshirish', 'sub:check', 'success')],
  ],
});

export const adminContactKeyboard = (url: string): InlineKeyboardMarkup => ({
  inline_keyboard: [[link('👤 Administrator', url)]],
});

export const startKeyboard: InlineKeyboardMarkup = { inline_keyboard: [[cb('📝 Anketani boshlash', 'reg:start', 'success')]] };

export const retryKeyboard = (data: string): InlineKeyboardMarkup => ({
  inline_keyboard: [[cb('🔁 Qayta urinish', data, 'primary')]],
});

/** Variant matni shundan uzun bo'lsa, savol matnida to'liq ro'yxat beriladi, tugmada raqam bilan qisqartiriladi. */
export const LONG_LABEL = 32;

export const hasLongLabels = (q: Question): boolean => optionsOf(q).some((o) => o.label.length > LONG_LABEL);

const shorten = (label: string, max: number) => (label.length > max ? `${label.slice(0, max - 1).trimEnd()}…` : label);

/**
 * Savol tugmalari: a:<savol>:<variant> — tanlash/belgilash, n:<savol> — "➡️ Keyingi".
 * Orqaga yoki tahrirlash tugmalari yo'q. "Keyingi" faqat tanlov to'g'ri bo'lganda ko'rinadi.
 */
export function choiceKeyboard(index: number, q: Question, selection: string[]): InlineKeyboardMarkup {
  const multi = q.kind === 'multi';
  const numbered = hasLongLabels(q);
  const rows: InlineKeyboardButton[][] = optionsOf(q).map((o, i) => {
    const selected = selection.includes(o.id);
    const mark = selected ? '✅ ' : multi ? '⬜️ ' : '';
    const label = numbered ? `${i + 1}. ${shorten(o.label, 40)}` : o.label;
    return [cb(`${mark}${label}`, `a:${index}:${i}`, selected ? 'primary' : undefined)];
  });
  if (validateSelection(q, selection).ok) rows.push([cb('➡️ Keyingi', `n:${index}`, 'success')]);
  return { inline_keyboard: rows };
}

export const phoneConfirmKeyboard = (index: number): InlineKeyboardMarkup => ({
  inline_keyboard: [[cb('✅ Tasdiqlayman', `pc:${index}:y`, 'success')]],
});

export const contactKeyboard: ReplyKeyboardMarkup = {
  keyboard: [[{ text: '📱 Raqamni ulashish', request_contact: true, style: 'success' } as KeyboardButton]],
  resize_keyboard: true,
  one_time_keyboard: false,
  is_persistent: true,
};

export const emptyInline: InlineKeyboardMarkup = { inline_keyboard: [] };

export const removeKeyboard: ReplyKeyboardRemove = { remove_keyboard: true };

export const adminKeyboard: InlineKeyboardMarkup = {
  inline_keyboard: [
    [cb('📊 Statistika', 'admin:stats', 'primary'), cb('👥 Jami', 'admin:total', 'primary')],
    [cb('📅 Bugungi', 'admin:today', 'primary'), cb('🕒 Oxirgilar', 'admin:recent', 'primary')],
    [cb('📄 Google Sheets', 'admin:sheets', 'success'), cb('ℹ️ Bot holati', 'admin:bot', 'primary')],
  ],
};
