import { z } from 'zod';
import { FIELD_KEYS, REQUIRED_FIELDS, type Config, type FieldKey, type Regions } from '../types/index.js';
import { isValidTimeZone } from '../utils/time.js';

export class ConfigError extends Error {}

const channelIdSchema = z
  .string()
  .regex(/^(@[A-Za-z]\w{4,}|-100\d{5,})$/, "@username yoki -100... ko'rinishidagi ID bo'lishi kerak");

const channelUrlSchema = z
  .string()
  .regex(/^https:\/\/t\.me\/[\w+/-]+$/, "https://t.me/... ko'rinishidagi havola bo'lishi kerak");

const schema = z.object({
  BOT_TOKEN: z
    .string()
    .regex(/^\d{6,}:[A-Za-z0-9_-]{30,}$/, "BOT_TOKEN BotFather bergan to'liq token bo'lishi kerak"),
  CHANNEL_1_ID: channelIdSchema,
  CHANNEL_1_URL: channelUrlSchema,
  CHANNEL_1_NAME: z.string().trim().min(1).max(40).default('1-kanal'),
  CHANNEL_2_ID: channelIdSchema,
  CHANNEL_2_URL: channelUrlSchema,
  CHANNEL_2_NAME: z.string().trim().min(1).max(40).default('2-kanal'),
  GOOGLE_SPREADSHEET_ID: z.string().min(20, "GOOGLE_SPREADSHEET_ID noto'g'ri"),
  GOOGLE_SHEET_NAME: z.string().trim().min(1).max(100).default('Registrations'),
  GOOGLE_SERVICE_ACCOUNT_EMAIL: z.string().email("GOOGLE_SERVICE_ACCOUNT_EMAIL noto'g'ri"),
  GOOGLE_PRIVATE_KEY: z.string().min(100, "GOOGLE_PRIVATE_KEY to'liq kiritilmagan"),
  ADMIN_IDS: z.string().min(1, "ADMIN_IDS kamida bitta Telegram ID bo'lishi kerak"),
  TIMEZONE: z.string().default('Asia/Tashkent'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  SESSION_TTL_HOURS: z.coerce.number().positive().max(720).default(24),
  SESSION_FILE: z.string().min(1).default('./data/sessions.json'),
  REGISTRATION_FIELDS: z.string().default(FIELD_KEYS.join(',')),
  REGIONS_JSON: z.string().optional(),
  PORT: z.coerce.number().int().min(1).max(65535).optional(),
});

export function parseFields(raw: string): { fields: FieldKey[]; unknown: string[] } {
  const tokens = raw
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  const known = new Set<string>(FIELD_KEYS);
  const unknown = tokens.filter((t) => !known.has(t));
  const selected = new Set<string>([...tokens, ...REQUIRED_FIELDS]);
  return { fields: FIELD_KEYS.filter((k) => selected.has(k)), unknown };
}

export function parseRegions(raw: string | undefined): { regions: Regions; error?: string } {
  if (!raw || !raw.trim()) return { regions: null };
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { regions: null, error: "JSON noto'g'ri" };
  }
  if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).length === 0) {
    return { regions: null, error: '{"Viloyat": ["Tuman", ...]} ko\'rinishida bo\'lsin' };
  }
  for (const [region, districts] of Object.entries(data)) {
    const valid = Array.isArray(districts) && districts.every((d) => typeof d === 'string' && d.trim() !== '');
    if (!valid) return { regions: null, error: `"${region}" uchun tumanlar ro'yxati noto'g'ri` };
  }
  return { regions: data as Record<string, string[]> };
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

  const { fields, unknown } = parseFields(e.REGISTRATION_FIELDS);
  if (unknown.length > 0) errors.push(`REGISTRATION_FIELDS: noma'lum maydon(lar): ${unknown.join(', ')}`);

  const regionsResult = parseRegions(e.REGIONS_JSON);
  if (regionsResult.error) errors.push(`REGIONS_JSON: ${regionsResult.error}`);

  if (errors.length > 0) throw new ConfigError(errors.join('\n'));

  return {
    botToken: e.BOT_TOKEN,
    channels: [
      { key: 'channel1', id: e.CHANNEL_1_ID, url: e.CHANNEL_1_URL, name: e.CHANNEL_1_NAME },
      { key: 'channel2', id: e.CHANNEL_2_ID, url: e.CHANNEL_2_URL, name: e.CHANNEL_2_NAME },
    ],
    googleSpreadsheetId: e.GOOGLE_SPREADSHEET_ID,
    googleSheetName: e.GOOGLE_SHEET_NAME,
    googleServiceAccountEmail: e.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    googlePrivateKey: e.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    adminIds: adminTokens.map(Number),
    timezone: e.TIMEZONE,
    logLevel: e.LOG_LEVEL,
    sessionTtlHours: e.SESSION_TTL_HOURS,
    sessionFile: e.SESSION_FILE,
    fields,
    regions: regionsResult.regions,
    port: e.PORT,
  };
}
