import type { InlineKeyboardButton, InlineKeyboardMarkup, ReplyKeyboardMarkup, ReplyKeyboardRemove } from 'telegraf/types';
import type { ChannelConfig, FieldKey } from '../types/index.js';
import { FIELD_LABELS } from '../services/registration.js';

export type Markup = InlineKeyboardMarkup | ReplyKeyboardMarkup | ReplyKeyboardRemove;

const cb = (text: string, data: string): InlineKeyboardButton => ({ text, callback_data: data });

const grid = (items: InlineKeyboardButton[], perRow = 2): InlineKeyboardButton[][] => {
  const rows: InlineKeyboardButton[][] = [];
  for (let i = 0; i < items.length; i += perRow) rows.push(items.slice(i, i + perRow));
  return rows;
};

const nav = (canBack: boolean): InlineKeyboardButton[][] =>
  canBack ? [[cb('⬅️ Orqaga', 'flow:back'), cb('❌ Bekor qilish', 'flow:cancel')]] : [[cb('❌ Bekor qilish', 'flow:cancel')]];

export const subscribeKeyboard = (channels: ChannelConfig[]): InlineKeyboardMarkup => ({
  inline_keyboard: [
    ...channels.map((c): InlineKeyboardButton[] => [{ text: `📢 ${c.name}ga obuna bo'lish`, url: c.url }]),
    [cb('✅ Obunani tekshirish', 'sub:check')],
  ],
});

export const regKeyboard: InlineKeyboardMarkup = { inline_keyboard: [[cb("📝 Ro'yxatdan o'tish", 'reg:start')]] };

export const resumeKeyboard: InlineKeyboardMarkup = {
  inline_keyboard: [[cb('▶️ Davom ettirish', 'resume:go')], [cb('🔄 Yangidan boshlash', 'resume:restart')]],
};

export const retryKeyboard = (data: string): InlineKeyboardMarkup => ({
  inline_keyboard: [[cb('🔁 Qayta urinish', data)]],
});

export const navKeyboard = (canBack: boolean): InlineKeyboardMarkup => ({ inline_keyboard: nav(canBack) });

export const genderKeyboard = (canBack: boolean): InlineKeyboardMarkup => ({
  inline_keyboard: [
    [cb('👨 Erkak', 'gender:male'), cb('👩 Ayol', 'gender:female')],
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
    [cb('✅ Tasdiqlash', 'confirm:yes')],
    [cb('✏️ Tahrirlash', 'confirm:edit')],
    [cb('❌ Bekor qilish', 'flow:cancel')],
  ],
};

export const editKeyboard = (fields: FieldKey[]): InlineKeyboardMarkup => ({
  inline_keyboard: [
    ...grid(fields.map((f) => cb(FIELD_LABELS[f], `edit:${f}`))),
    [cb('⬅️ Ortga', 'confirm:back')],
  ],
});

export const phoneReplyKeyboard: ReplyKeyboardMarkup = {
  keyboard: [[{ text: '📱 Telefon raqamimni yuborish', request_contact: true }], [{ text: '⬅️ Orqaga' }, { text: '❌ Bekor qilish' }]],
  resize_keyboard: true,
  one_time_keyboard: true,
};

export const removeKeyboard: ReplyKeyboardRemove = { remove_keyboard: true };

export const adminKeyboard: InlineKeyboardMarkup = {
  inline_keyboard: [
    [cb('📊 Statistika', 'admin:stats'), cb('👥 Jami', 'admin:total')],
    [cb('📅 Bugungi', 'admin:today'), cb('🕒 Oxirgilar', 'admin:recent')],
    [cb('📄 Google Sheets', 'admin:sheets'), cb('ℹ️ Bot holati', 'admin:bot')],
  ],
};
