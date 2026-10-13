import { createPrivateKey } from 'node:crypto';
import { z } from 'zod';
import type { Config } from '../types/index.js';
import { isValidTimeZone } from '../utils/time.js';

export class ConfigError extends Error {}

const channelIdSchema = z
  .string()
  .regex(/^(@[A-Za-z]\w{4,}|-100\d{5,})$/, "@username yoki -100... ko'rinishidagi ID bo'lishi kerak");

const channelUrlSchema = z
  .string()
  .regex(/^https:\/\/t\.me\/[\w+/-]+$/, "https://t.me/... ko'rinishidagi havola bo'lishi kerak");

function emptyAsUndefined<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), schema.optional());
}

const schema = z.object({
  BOT_TOKEN: z
    .string()
    .regex(/^\d{6,}:[A-Za-z0-9_-]{30,}$/, "BOT_TOKEN BotFather bergan to'liq token bo'lishi kerak"),
  CHANNEL_1_ID: channelIdSchema,
  CHANNEL_1_URL: channelUrlSchema,
  CHANNEL_1_NAME: emptyAsUndefined(z.string().trim().min(1).max(40)),
  CHANNEL_2_ID: channelIdSchema,
  CHANNEL_2_URL: channelUrlSchema,
  CHANNEL_2_NAME: emptyAsUndefined(z.string().trim().min(1).max(40)),
  GOOGLE_SPREADSHEET_ID: z.string().min(20, "GOOGLE_SPREADSHEET_ID noto'g'ri"),
  GOOGLE_SHEET_NAME: z.string().trim().min(1).max(100).default('Media_AI'),
  // Ikki usul: alohida (EMAIL + PRIVATE_KEY) yoki butun service account JSON'i (GOOGLE_SERVICE_ACCOUNT_JSON)
  GOOGLE_SERVICE_ACCOUNT_EMAIL: emptyAsUndefined(z.string().email("GOOGLE_SERVICE_ACCOUNT_EMAIL noto'g'ri")),
  GOOGLE_PRIVATE_KEY: emptyAsUndefined(z.string()),
  GOOGLE_SERVICE_ACCOUNT_JSON: emptyAsUndefined(z.string()),
  ADMIN_IDS: z.string().min(1, "ADMIN_IDS kamida bitta Telegram ID bo'lishi kerak"),
  TIMEZONE: z.string().default('Asia/Tashkent'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  SESSION_TTL_HOURS: z.coerce.number().positive().max(720).default(24),
  SESSION_FILE: z.string().min(1).default('./data/sessions.json'),
  ADMIN_CONTACT_URL: emptyAsUndefined(channelUrlSchema),
  PORT: z.coerce.number().int().min(1).max(65535).optional(),
});

/** Render va boshqa hostinglarda kalit turlicha kiritilishi mumkin: \n belgilari, qo'shtirnoq, bo'sh joylar. */
export function normalizePrivateKey(raw: string): string {
  let key = raw.trim();
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
    key = key.slice(1, -1).trim();
  }
  return key.replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').replace(/\r\n/g, '\n').trim();
}

/** Kalit qiymatini ko'rsatmasdan tekshiradi. Muammo bo'lsa, xabar qaytaradi. */
export function checkPrivateKey(key: string): string | null {
  if (!key.includes('-----BEGIN PRIVATE KEY-----') || !key.includes('-----END PRIVATE KEY-----')) {
    return "GOOGLE_PRIVATE_KEY '-----BEGIN PRIVATE KEY-----' bilan boshlanib, '-----END PRIVATE KEY-----' bilan tugashi kerak";
  }
  try {
    createPrivateKey(key);
  } catch {
    return "GOOGLE_PRIVATE_KEY o'qib bo'lmadi: kalit to'liq va o'zgartirilmagan holda nusxalanganini tekshiring (qo'shtirnoqsiz, boshidan oxirigacha)";
  }
  return null;
}

function resolveGoogleCredentials(
  e: { GOOGLE_SERVICE_ACCOUNT_EMAIL?: string; GOOGLE_PRIVATE_KEY?: string; GOOGLE_SERVICE_ACCOUNT_JSON?: string },
  errors: string[],
): { email: string; key: string } {
  let email = e.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  let key = e.GOOGLE_PRIVATE_KEY;
  if (e.GOOGLE_SERVICE_ACCOUNT_JSON) {
    try {
      const json = JSON.parse(e.GOOGLE_SERVICE_ACCOUNT_JSON) as { client_email?: unknown; private_key?: unknown };
      email = typeof json.client_email === 'string' ? json.client_email : undefined;
      key = typeof json.private_key === 'string' ? json.private_key : undefined;
      if (!email || !key) errors.push("GOOGLE_SERVICE_ACCOUNT_JSON ichida client_email yoki private_key yo'q");
    } catch {
      errors.push("GOOGLE_SERVICE_ACCOUNT_JSON to'g'ri JSON emas (faylning butun mazmuni kiritilishi kerak)");
    }
  } else {
    if (!email) errors.push("GOOGLE_SERVICE_ACCOUNT_EMAIL kerak (yoki GOOGLE_SERVICE_ACCOUNT_JSON)");
    if (!key) errors.push("GOOGLE_PRIVATE_KEY kerak (yoki GOOGLE_SERVICE_ACCOUNT_JSON)");
  }
  const normalized = normalizePrivateKey(key ?? '');
  if (key) {
    const problem = checkPrivateKey(normalized);
    if (problem) errors.push(problem);
  }
  return { email: email ?? '', key: normalized };
}

/** Nom berilmasa, o'rinbosar qoladi; haqiqiy nomni bot ishga tushganda Telegram'dan oladi. */
function channelName(name: string | undefined, n: number): string {
  return name ?? `${n}-kanal`;
}

/** Muhit o'zgaruvchilarini tekshiradi. Xato bo'lsa, qiymatlarni emas, faqat nomlarini ko'rsatadi. */
export function parseConfig(env: Record<string, string | undefined>): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    throw new ConfigError(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n'));
  }
  const e = parsed.data;
  const errors: string[] = [];

  const adminTokens = e.ADMIN_IDS.split(/[\s,]+/).filter(Boolean);
  if (adminTokens.length === 0 || !adminTokens.every((t) => /^\d+$/.test(t))) {
    errors.push("ADMIN_IDS: faqat raqamli Telegram ID lar, vergul bilan ajratilgan bo'lsin");
  }
  if (!isValidTimeZone(e.TIMEZONE)) errors.push(`TIMEZONE: noto'g'ri vaqt zonasi (${e.TIMEZONE})`);
  if (e.CHANNEL_1_ID === e.CHANNEL_2_ID) errors.push("CHANNEL_1_ID va CHANNEL_2_ID bir xil bo'lmasin");

  const google = resolveGoogleCredentials(e, errors);

  if (errors.length > 0) throw new ConfigError(errors.join('\n'));

  return {
    botToken: e.BOT_TOKEN,
    channels: [
      { key: 'channel1', id: e.CHANNEL_1_ID, url: e.CHANNEL_1_URL, name: channelName(e.CHANNEL_1_NAME, 1) },
      { key: 'channel2', id: e.CHANNEL_2_ID, url: e.CHANNEL_2_URL, name: channelName(e.CHANNEL_2_NAME, 2) },
    ],
    googleSpreadsheetId: e.GOOGLE_SPREADSHEET_ID,
    googleSheetName: e.GOOGLE_SHEET_NAME,
    googleServiceAccountEmail: google.email,
    googlePrivateKey: google.key,
    adminIds: adminTokens.map(Number),
    timezone: e.TIMEZONE,
    logLevel: e.LOG_LEVEL,
    sessionTtlHours: e.SESSION_TTL_HOURS,
    sessionFile: e.SESSION_FILE,
    port: e.PORT,
    adminContactUrl: e.ADMIN_CONTACT_URL,
  };
}
