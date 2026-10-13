import type { Answers } from '../src/services/questionnaire.js';
import { generateKeyPairSync } from 'node:crypto';

/** Faqat testlar uchun yaratilgan vaqtinchalik kalit (haqiqiy emas). */
export const TEST_PRIVATE_KEY = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
}).privateKey;

export const TOKEN = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw';

/** To'g'ri to'ldirilgan muhit o'zgaruvchilari (haqiqiy sirlar emas). */
export function baseEnv(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    BOT_TOKEN: TOKEN,
    CHANNEL_1_ID: '@kanal_bir',
    CHANNEL_1_URL: 'https://t.me/kanal_bir',
    CHANNEL_1_NAME: '1-kanal',
    CHANNEL_2_ID: '-1001234567890',
    CHANNEL_2_URL: 'https://t.me/kanal_ikki',
    CHANNEL_2_NAME: '2-kanal',
    GOOGLE_SPREADSHEET_ID: '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789',
    GOOGLE_SHEET_NAME: 'Media_AI',
    GOOGLE_SERVICE_ACCOUNT_EMAIL: 'bot@loyiha.iam.gserviceaccount.com',
    GOOGLE_PRIVATE_KEY: TEST_PRIVATE_KEY.replace(/\n/g, '\\n'),
    ADMIN_IDS: '111111111, 222222222',
    TIMEZONE: 'Asia/Tashkent',
    LOG_LEVEL: 'info',
    ...overrides,
  };
}

/** To'liq va to'g'ri to'ldirilgan anketa javoblari (test uchun). */
export function sampleAnswers(): Answers {
  return {
    full_name: { kind: 'text', value: 'Aliyev Vali' },
    phone: { kind: 'text', value: '+998901234567' },
    phone_contact: { kind: 'contact', phone: '+998901234567', matchesManual: true },
    program: { kind: 'choice', optionId: 'software' },
    course: { kind: 'choice', optionId: 'c2' },
    occupation: { kind: 'choice', optionId: 'study_only' },
    work_field: { kind: 'choice', optionId: 'not_working', auto: true },
    free_time: { kind: 'choice', optionId: 'evening' },
    weekly_hours: { kind: 'choice', optionId: 'h6_10' },
    start_time: { kind: 'choice', optionId: 'now' },
    motivation: { kind: 'text', value: 'Media va AI sohasida amaliy tajriba orttirmoqchiman.' },
    media_interests: { kind: 'multi', optionIds: ['smm', 'reels'] },
    media_experience: { kind: 'choice', optionId: 'self_taught' },
    portfolio: { kind: 'portfolio', hasPortfolio: false },
    ai_usage: { kind: 'choice', optionId: 'chat_info' },
    ai_tools: { kind: 'multi', optionIds: ['chatgpt', 'claude'] },
    ai_goals: { kind: 'multi', optionIds: ['all'] },
    devices: { kind: 'choice', optionId: 'both' },
    three_month_goal: { kind: 'text', value: 'Portfolio uchun 10 ta Reels tayyorlash.' },
    ready_for_tasks: { kind: 'choice', optionId: 'yes' },
    work_style: { kind: 'choice', optionId: 'both' },
  };
}
