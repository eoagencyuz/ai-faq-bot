import type {
  InlineKeyboardButton,
  InlineKeyboardMarkup,
  KeyboardButton,
  ReplyKeyboardMarkup,
  ReplyKeyboardRemove,
} from 'telegraf/types';
import type { ChannelConfig, FieldKey } from '../types/index.js';
import { FIELD_LABELS } from '../services/registration.js';

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

const grid = (items: InlineKeyboardButton[], perRow = 2): InlineKeyboardButton[][] => {
  const rows: InlineKeyboardButton[][] = [];
  for (let i = 0; i < items.length; i += perRow) rows.push(items.slice(i, i + perRow));
  return rows;
};

const nav = (canBack: boolean): InlineKeyboardButton[][] =>
  canBack ? [[cb('⬅️ Orqaga', 'flow:back', 'primary'), cb('❌ Bekor qilish', 'flow:cancel', 'danger')]] : [[cb('❌ Bekor qilish', 'flow:cancel', 'danger')]];

export const subscribeKeyboard = (channels: ChannelConfig[]): InlineKeyboardMarkup => ({
  inline_keyboard: [
    ...channels.map((c): InlineKeyboardButton[] => [link(`📢 ${c.name}ga obuna bo'lish`, c.url, 'primary')]),
    [cb('✅ Obunani tekshirish', 'sub:check', 'success')],
  ],
});

export const regKeyboard: InlineKeyboardMarkup = { inline_keyboard: [[cb("📝 Ro'yxatdan o'tish", 'reg:start', 'success')]] };

export const resumeKeyboard: InlineKeyboardMarkup = {
  inline_keyboard: [[cb('▶️ Davom ettirish', 'resume:go', 'success')], [cb('🔄 Yangidan boshlash', 'resume:restart', 'danger')]],
};

export const retryKeyboard = (data: string): InlineKeyboardMarkup => ({
  inline_keyboard: [[cb('🔁 Qayta urinish', data, 'primary')]],
});

export const navKeyboard = (canBack: boolean): InlineKeyboardMarkup => ({ inline_keyboard: nav(canBack) });

export const genderKeyboard = (canBack: boolean): InlineKeyboardMarkup => ({
  inline_keyboard: [
    [cb('👨 Erkak', 'gender:male', 'primary'), cb('👩 Ayol', 'gender:female', 'primary')],
    [cb("🙈 Ko'rsatishni istamayman", 'gender:skip')],
    ...nav(canBack),
  ],
});

export const regionKeyboard = (names: string[], canBack: boolean): InlineKeyboardMarkup => ({
  inline_keyboard: [...grid(names.map((n, i) => cb(n.slice(0, 40), `region:${i}`))), ...nav(canBack)],
});

export const districtKeyboard = (names: string[], canBack: boolean): InlineKeyboardMarkup => ({
  inline_keyboard: [...grid(names.map((n, i) => cb(n.slice(0, 40), `district:${i}`))), ...nav(canBack)],
});

export const skipKeyboard = (canBack: boolean): InlineKeyboardMarkup => ({
  inline_keyboard: [[cb("⏭ O'tkazib yuborish", 'skip:additional_info')], ...nav(canBack)],
});

export const confirmKeyboard: InlineKeyboardMarkup = {
  inline_keyboard: [
    [cb('✅ Tasdiqlash', 'confirm:yes', 'success')],
    [cb('✏️ Tahrirlash', 'confirm:edit', 'primary')],
    [cb('❌ Bekor qilish', 'flow:cancel', 'danger')],
  ],
};

export const editKeyboard = (fields: FieldKey[]): InlineKeyboardMarkup => ({
  inline_keyboard: [
    ...grid(fields.map((f) => cb(FIELD_LABELS[f], `edit:${f}`))),
    [cb('⬅️ Ortga', 'confirm:back', 'primary')],
  ],
});

export const phoneReplyKeyboard: ReplyKeyboardMarkup = {
  keyboard: [[{ text: '📱 Telefon raqamimni yuborish', request_contact: true, style: 'success' } as KeyboardButton], [{ text: '⬅️ Orqaga' }, { text: '❌ Bekor qilish' }]],
  resize_keyboard: true,
  one_time_keyboard: true,
};

export const removeKeyboard: ReplyKeyboardRemove = { remove_keyboard: true };

export const adminKeyboard: InlineKeyboardMarkup = {
  inline_keyboard: [
    [cb('📊 Statistika', 'admin:stats', 'primary'), cb('👥 Jami', 'admin:total', 'primary')],
    [cb('📅 Bugungi', 'admin:today', 'primary'), cb('🕒 Oxirgilar', 'admin:recent', 'primary')],
    [cb('📄 Google Sheets', 'admin:sheets', 'success'), cb('ℹ️ Bot holati', 'admin:bot', 'primary')],
  ],
};
