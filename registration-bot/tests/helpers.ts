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
    GOOGLE_PRIVATE_KEY: 'x'.repeat(120),
    ADMIN_IDS: '111111111, 222222222',
    TIMEZONE: 'Asia/Tashkent',
    LOG_LEVEL: 'info',
    ...overrides,
  };
}
