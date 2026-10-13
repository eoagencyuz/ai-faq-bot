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
    GOOGLE_SHEET_NAME: 'Registrations',
    GOOGLE_SERVICE_ACCOUNT_EMAIL: 'bot@loyiha.iam.gserviceaccount.com',
    GOOGLE_PRIVATE_KEY: TEST_PRIVATE_KEY.replace(/\n/g, '\\n'),
    ADMIN_IDS: '111111111, 222222222',
    TIMEZONE: 'Asia/Tashkent',
    LOG_LEVEL: 'info',
    ...overrides,
  };
}
