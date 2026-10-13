import { describe, expect, it } from 'vitest';
import { ConfigError, parseConfig } from '../src/config/env.js';
import { TEST_PRIVATE_KEY, baseEnv } from './helpers.js';

describe('parseConfig', () => {
  it("to'g'ri sozlamalarni qabul qiladi", () => {
    const config = parseConfig(baseEnv());
    expect(config.channels).toHaveLength(2);
    expect(config.adminIds).toEqual([111111111, 222222222]);
    expect(config.googleSheetName).toBe('Media_AI');
  });

  it("noto'g'ri bot tokenini rad etadi", () => {
    expect(() => parseConfig(baseEnv({ BOT_TOKEN: 'abc' }))).toThrow(ConfigError);
  });

  it("ADMIN_IDS raqam bo'lmasa rad etadi", () => {
    expect(() => parseConfig(baseEnv({ ADMIN_IDS: 'ali,111' }))).toThrow(/ADMIN_IDS/);
  });

  it("varaq nomi berilmasa Media_AI bo'ladi", () => {
    expect(parseConfig(baseEnv({ GOOGLE_SHEET_NAME: undefined })).googleSheetName).toBe('Media_AI');
  });

  it("ikkala kanal bir xil bo'lsa rad etadi", () => {
    expect(() => parseConfig(baseEnv({ CHANNEL_2_ID: '@kanal_bir' }))).toThrow(/bir xil/);
  });

  it("noto'g'ri vaqt zonasini rad etadi", () => {
    expect(() => parseConfig(baseEnv({ TIMEZONE: 'Mars/Olympus' }))).toThrow(/TIMEZONE/);
  });
});

describe('Google kalit', () => {
  const email = 'bot@loyiha.iam.gserviceaccount.com';

  it("\\n belgili (bir qatorli) kalitni qabul qiladi va haqiqiy qatorlarga aylantiradi", () => {
    const config = parseConfig(baseEnv({ GOOGLE_PRIVATE_KEY: TEST_PRIVATE_KEY.replace(/\n/g, '\\n') }));
    expect(config.googlePrivateKey).toContain('-----BEGIN PRIVATE KEY-----\n');
    expect(config.googlePrivateKey).not.toContain('\\n');
  });

  it('haqiqiy qatorlar bilan kiritilgan kalitni qabul qiladi', () => {
    expect(() => parseConfig(baseEnv({ GOOGLE_PRIVATE_KEY: TEST_PRIVATE_KEY }))).not.toThrow();
  });

  it("qo'shtirnoq ichida kiritilgan kalitni tuzatadi", () => {
    const quoted = `"${TEST_PRIVATE_KEY.replace(/\n/g, '\\n')}"`;
    expect(() => parseConfig(baseEnv({ GOOGLE_PRIVATE_KEY: quoted }))).not.toThrow();
  });

  it("buzilgan yoki kesilgan kalitni tushunarli xabar bilan rad etadi va qiymatni ko'rsatmaydi", () => {
    const broken = TEST_PRIVATE_KEY.slice(0, 120) + '\n-----END PRIVATE KEY-----\n';
    try {
      parseConfig(baseEnv({ GOOGLE_PRIVATE_KEY: broken }));
      throw new Error("xato kutilgan edi");
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      expect((err as Error).message).toContain('GOOGLE_PRIVATE_KEY');
      expect((err as Error).message).not.toContain('MII');
    }
    expect(() => parseConfig(baseEnv({ GOOGLE_PRIVATE_KEY: 'bu kalit emas' }))).toThrow(/BEGIN PRIVATE KEY/);
  });

  it('butun service account JSON orqali ham sozlanadi', () => {
    const json = JSON.stringify({ client_email: email, private_key: TEST_PRIVATE_KEY });
    const config = parseConfig(
      baseEnv({ GOOGLE_SERVICE_ACCOUNT_JSON: json, GOOGLE_SERVICE_ACCOUNT_EMAIL: undefined, GOOGLE_PRIVATE_KEY: undefined }),
    );
    expect(config.googleServiceAccountEmail).toBe(email);
    expect(config.googlePrivateKey).toContain('BEGIN PRIVATE KEY');
  });

  it("noto'g'ri JSON yoki kalitlar yo'q bo'lsa rad etadi", () => {
    expect(() => parseConfig(baseEnv({ GOOGLE_SERVICE_ACCOUNT_JSON: '{bad' }))).toThrow(/GOOGLE_SERVICE_ACCOUNT_JSON/);
    expect(() =>
      parseConfig(baseEnv({ GOOGLE_SERVICE_ACCOUNT_EMAIL: undefined, GOOGLE_PRIVATE_KEY: undefined })),
    ).toThrow(/GOOGLE_SERVICE_ACCOUNT_EMAIL/);
  });

  it("bo'sh qiymat berilmagan deb hisoblanadi", () => {
    expect(() => parseConfig(baseEnv({ GOOGLE_SERVICE_ACCOUNT_JSON: '' }))).not.toThrow();
  });
});

describe('kanal nomlari', () => {
  it("nom berilmasa, @username ishlatiladi", () => {
    const config = parseConfig(baseEnv({ CHANNEL_1_NAME: undefined, CHANNEL_2_NAME: '' }));
    expect(config.channels.map((c) => c.name)).toEqual(['@kanal_bir', '2-kanal']);
  });
});

describe('PORT', () => {
  it("berilmasa undefined, berilsa raqam bo'ladi", () => {
    expect(parseConfig(baseEnv()).port).toBeUndefined();
    expect(parseConfig(baseEnv({ PORT: '10000' })).port).toBe(10000);
    expect(() => parseConfig(baseEnv({ PORT: 'abc' }))).toThrow(ConfigError);
  });
});
