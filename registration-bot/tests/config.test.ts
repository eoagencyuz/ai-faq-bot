import { describe, expect, it } from 'vitest';
import { ConfigError, parseConfig, parseFields } from '../src/config/env.js';
import { baseEnv } from './helpers.js';

describe('parseConfig', () => {
  it("to'g'ri sozlamalarni qabul qiladi", () => {
    const config = parseConfig(baseEnv());
    expect(config.channels).toHaveLength(2);
    expect(config.adminIds).toEqual([111111111, 222222222]);
    expect(config.fields).toContain('phone');
    expect(config.regions).toBeNull();
  });

  it("noto'g'ri bot tokenini rad etadi", () => {
    expect(() => parseConfig(baseEnv({ BOT_TOKEN: 'abc' }))).toThrow(ConfigError);
  });

  it("ADMIN_IDS raqam bo'lmasa rad etadi", () => {
    expect(() => parseConfig(baseEnv({ ADMIN_IDS: 'ali,111' }))).toThrow(/ADMIN_IDS/);
  });

  it("noma'lum maydon nomini ko'rsatadi", () => {
    expect(() => parseConfig(baseEnv({ REGISTRATION_FIELDS: 'first_name,phone,foo' }))).toThrow(/foo/);
  });

  it('ism va telefon doim yoqilgan bo\'ladi', () => {
    const config = parseConfig(baseEnv({ REGISTRATION_FIELDS: 'birth_date' }));
    expect(config.fields).toEqual(expect.arrayContaining(['first_name', 'phone', 'birth_date']));
    expect(config.fields).not.toContain('gender');
  });

  it("noto'g'ri REGIONS_JSON ni rad etadi", () => {
    expect(() => parseConfig(baseEnv({ REGIONS_JSON: '{bad' }))).toThrow(/REGIONS_JSON/);
  });

  it("ikkala kanal bir xil bo'lsa rad etadi", () => {
    expect(() => parseConfig(baseEnv({ CHANNEL_2_ID: '@kanal_bir' }))).toThrow(/bir xil/);
  });

  it("private key ichidagi \\n belgilarini haqiqiy qator qiladi", () => {
    const config = parseConfig(baseEnv({ GOOGLE_PRIVATE_KEY: `line1\\nline2${'x'.repeat(120)}` }));
    expect(config.googlePrivateKey.startsWith('line1\nline2')).toBe(true);
  });

  it("noto'g'ri vaqt zonasini rad etadi", () => {
    expect(() => parseConfig(baseEnv({ TIMEZONE: 'Mars/Olympus' }))).toThrow(/TIMEZONE/);
  });
});

describe('PORT', () => {
  it("berilmasa undefined, berilsa raqam bo'ladi", () => {
    expect(parseConfig(baseEnv()).port).toBeUndefined();
    expect(parseConfig(baseEnv({ PORT: '10000' })).port).toBe(10000);
    expect(() => parseConfig(baseEnv({ PORT: 'abc' }))).toThrow(ConfigError);
  });
});

describe('parseFields', () => {
  it('kanonik tartibda qaytaradi va majburiy maydonlarni qo\'shadi', () => {
    expect(parseFields('phone,last_name').fields).toEqual(['first_name', 'last_name', 'phone']);
  });
});
