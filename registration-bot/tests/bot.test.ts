import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pino from 'pino';
import { Telegram } from 'telegraf';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { createBot } from '../src/bot/index.js';
import { parseConfig } from '../src/config/env.js';
import { SessionStore } from '../src/services/session.js';
import { RegistrationRegistry, type SheetsPort } from '../src/services/registry.js';
import type { Config } from '../src/types/index.js';
import { baseEnv } from './helpers.js';

const ADMIN = 111111111;
const USER = 42;
const NOW = new Date('2026-10-12T09:00:00Z');

type Sent = { method: string; payload: Record<string, any> };

interface Harness {
  handle: (update: unknown) => Promise<void>;
  sent: Sent[];
  rows: string[][];
  failNextAppend: () => void;
  texts: () => string[];
  lastMessage: () => Sent | undefined;
  setMember: (chatId: string, value: { status: string; is_member?: boolean } | 'error') => void;
  config: Config;
  cleanup: () => void;
}

/**
 * Telegraf har bir update uchun yangi Telegram nusxasi yaratadi, shuning uchun
 * Telegram API chaqiruvlarini prototipda ushlaymiz (haqiqiy tarmoqqa chiqilmaydi).
 */
type Recorder = { sent: Sent[]; messageId: number };
let recorder: Recorder | null = null;
const telegramProto = Telegram.prototype as unknown as {
  callApi: (method: string, payload: Record<string, any>) => Promise<unknown>;
};
const originalCallApi = telegramProto.callApi;
telegramProto.callApi = async (method: string, payload: Record<string, any>) => {
  if (!recorder) throw new Error('Telegram chaqiruvi kutilmagan joyda');
  recorder.sent.push({ method, payload });
  if (method === 'sendMessage') {
    return {
      message_id: recorder.messageId++,
      date: 0,
      chat: { id: payload.chat_id, type: 'private' },
      text: payload.text,
    };
  }
  return true;
};

afterAll(() => {
  telegramProto.callApi = originalCallApi;
});

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function harness(envOverrides: Record<string, string | undefined> = {}): Harness {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reg-bot-'));
  dirs.push(dir);
  const config = parseConfig(baseEnv(envOverrides));

  const rows: string[][] = [];
  let failNext = false;
  const sheets: SheetsPort = {
    verify: async () => undefined,
    readRows: async () => rows.map((r) => [...r]),
    appendRow: async (values) => {
      if (failNext) {
        failNext = false;
        throw new Error('503 Service Unavailable');
      }
      rows.push([...values]);
    },
  };
  const registry = new RegistrationRegistry(sheets, config.timezone);
  const sessions = new SessionStore(path.join(dir, 'sessions.json'), 24 * 3_600_000);

  const members: Record<string, { status: string; is_member?: boolean } | 'error'> = {
    '@kanal_bir': { status: 'member' },
    '-1001234567890': { status: 'member' },
  };
  const fetchMember = async (chatId: string) => {
    const m = members[chatId];
    if (!m || m === 'error') throw new Error('Bad Request: chat not found');
    return m;
  };

  const bot = createBot({
    config,
    sessions,
    registry,
    fetchMember,
    logger: pino({ level: 'silent' }),
    startedAt: NOW,
    now: () => NOW,
  });

  const sent: Sent[] = [];
  recorder = { sent, messageId: 1 };
  bot.botInfo = { id: 1, is_bot: true, first_name: 'Test', username: 'test_bot' } as never;

  let updateId = 1;
  const handle = (update: unknown) => bot.handleUpdate({ update_id: updateId++, ...(update as object) } as never);

  return {
    handle,
    sent,
    rows,
    failNextAppend: () => {
      failNext = true;
    },
    texts: () => sent.filter((s) => s.method === 'sendMessage').map((s) => String(s.payload.text)),
    lastMessage: () => [...sent].reverse().find((s) => s.method === 'sendMessage'),
    setMember: (chatId, value) => {
      members[chatId] = value;
    },
    config,
    cleanup: () => undefined,
  };
}

const chat = (id: number) => ({ id, type: 'private' as const, first_name: 'Ali' });

const text = (t: string, uid = USER) => ({
  message: {
    message_id: 1,
    date: 0,
    chat: chat(uid),
    from: { id: uid, is_bot: false, first_name: 'Ali', username: 'ali_v' },
    text: t,
    ...(t.startsWith('/')
      ? { entities: [{ type: 'bot_command', offset: 0, length: t.split(' ')[0]!.length }] }
      : {}),
  },
});

const contact = (phone: string, contactUserId: number, uid = USER) => ({
  message: {
    message_id: 1,
    date: 0,
    chat: chat(uid),
    from: { id: uid, is_bot: false, first_name: 'Ali' },
    contact: { phone_number: phone, first_name: 'X', user_id: contactUserId },
  },
});

const press = (data: string, uid = USER) => ({
  callback_query: {
    id: `cb-${Math.random()}`,
    from: { id: uid, is_bot: false, first_name: 'Ali' },
    chat_instance: 'x',
    data,
    message: { message_id: 1, date: 0, chat: chat(uid), text: 'x' },
  },
});

async function completeRegistration(h: Harness) {
  await h.handle(text('/start'));
  await h.handle(press('sub:check'));
  await h.handle(press('reg:start'));
  await h.handle(text('Ali'));
  await h.handle(text('Valiyev'));
  await h.handle(text('90 123 45 67'));
  await h.handle(text('15.05.2005'));
  await h.handle(press('gender:male'));
  await h.handle(text('Qashqadaryo'));
  await h.handle(text('Qarshi'));
  await h.handle(press('skip:additional_info'));
}

describe('/start va obuna', () => {
  it('/start kanal tugmalari va maxfiylik xabarini yuboradi', async () => {
    const h = harness();
    await h.handle(text('/start'));
    const msg = h.lastMessage()!;
    expect(msg.payload.text).toContain('Assalomu alaykum');
    expect(msg.payload.text).toContain('maxfiyl'.length ? 'Ma\'lumotlaringiz' : '');
    const buttons = JSON.stringify(msg.payload.reply_markup);
    expect(buttons).toContain('sub:check');
    expect(buttons).toContain('https://t.me/kanal_bir');
    expect(buttons).toContain('https://t.me/kanal_ikki');
  });

  it('ikkala kanalga obuna bo\'lganda ro\'yxatdan o\'tish tugmasi chiqadi', async () => {
    const h = harness();
    await h.handle(text('/start'));
    await h.handle(press('sub:check'));
    expect(h.lastMessage()!.payload.text).toContain('Rahmat');
    expect(JSON.stringify(h.lastMessage()!.payload.reply_markup)).toContain('reg:start');
  });

  it('faqat birinchi kanalga obuna bo\'lsa, ikkinchisi aytiladi', async () => {
    const h = harness();
    h.setMember('-1001234567890', { status: 'left' });
    await h.handle(text('/start'));
    await h.handle(press('sub:check'));
    const t = h.lastMessage()!.payload.text as string;
    expect(t).toContain('obuna bo\'lmagansiz');
    expect(t).toContain('2-kanal');
    expect(t).not.toContain('• 1-kanal');
  });

  it('Telegram API xatosi obuna yo\'q deb ko\'rsatilmaydi', async () => {
    const h = harness();
    h.setMember('-1001234567890', 'error');
    await h.handle(text('/start'));
    await h.handle(press('sub:check'));
    const t = h.lastMessage()!.payload.text as string;
    expect(t).toContain('vaqtinchalik');
    expect(t).not.toContain('obuna bo\'lmagansiz');
    expect(JSON.stringify(h.lastMessage()!.payload.reply_markup)).toContain('sub:check');
  });

  it('obuna bo\'lmasdan ro\'yxatdan o\'tishni boshlab bo\'lmaydi', async () => {
    const h = harness();
    h.setMember('@kanal_bir', { status: 'left' });
    await h.handle(text('/start'));
    await h.handle(press('reg:start'));
    expect(h.texts().some((t) => t.includes('Ism'))).toBe(false);
    expect(h.lastMessage()!.payload.text).toContain('obuna bo\'lmagansiz');
  });
});

describe('ro\'yxatdan o\'tish', () => {
  it('to\'liq oqim: ma\'lumot Google Sheets\'ga yoziladi', async () => {
    const h = harness();
    await completeRegistration(h);
    expect(h.texts().join('\n')).toContain('Ma\'lumotlaringizni tekshiring');
    await h.handle(press('confirm:yes'));
    expect(h.lastMessage()!.payload.text).toContain('muvaffaqiyatli');
    expect(h.rows).toHaveLength(1);
    const row = h.rows[0]!;
    expect(row[2]).toBe(String(USER));
    expect(row[6]).toBe('+998901234567');
    expect(row[8]).toBe('Erkak');
    expect(row[13]).toBe('Yakunlandi');
  });

  it('tasdiqlash ikki marta bosilsa, dublikat yozuv bo\'lmaydi', async () => {
    const h = harness();
    await completeRegistration(h);
    await Promise.all([h.handle(press('confirm:yes')), h.handle(press('confirm:yes'))]);
    expect(h.rows).toHaveLength(1);
  });

  it('yakunlangandan keyin qayta ro\'yxatdan o\'tish dublikat yaratmaydi', async () => {
    const h = harness();
    await completeRegistration(h);
    await h.handle(press('confirm:yes'));
    await h.handle(text('/start'));
    expect(h.lastMessage()!.payload.text).toContain('avval ro\'yxatdan o\'tgansiz');
    expect(h.rows).toHaveLength(1);
  });

  it('noto\'g\'ri ism qayta so\'raladi', async () => {
    const h = harness();
    await h.handle(text('/start'));
    await h.handle(press('sub:check'));
    await h.handle(press('reg:start'));
    await h.handle(text('A'));
    expect(h.texts().some((t) => t.includes('kamida 2'))).toBe(true);
    // Xato bo'lsa, bot shu savolni qayta so'raydi
    expect(h.lastMessage()!.payload.text).toContain('Ismingizni');
  });

  it('boshqa odamning kontaktini qabul qilmaydi', async () => {
    const h = harness();
    await h.handle(text('/start'));
    await h.handle(press('sub:check'));
    await h.handle(press('reg:start'));
    await h.handle(text('Ali'));
    await h.handle(text('Vali'));
    await h.handle(contact('+998905550000', 999));
    expect(h.texts().some((t) => t.includes('o\'zingizning'))).toBe(true);
    expect(h.rows).toHaveLength(0);
  });

  it('Google Sheets xatosi muvaffaqiyat xabarini yubormaydi va qayta urinish imkonini beradi', async () => {
    const h = harness();
    await completeRegistration(h);
    h.failNextAppend();
    await h.handle(press('confirm:yes'));
    expect(h.texts().some((t) => t.includes('muvaffaqiyatli'))).toBe(false);
    expect(h.lastMessage()!.payload.text).toContain('saqlashda vaqtinchalik xato');
    expect(h.rows).toHaveLength(0);
    await h.handle(press('confirm:yes'));
    expect(h.rows).toHaveLength(1);
  });

  it('orqaga tugmasi oldingi savolga qaytaradi', async () => {
    const h = harness();
    await h.handle(text('/start'));
    await h.handle(press('sub:check'));
    await h.handle(press('reg:start'));
    await h.handle(text('Ali'));
    await h.handle(press('flow:back'));
    expect(h.lastMessage()!.payload.text).toContain('Ismingizni');
  });

  it('bekor qilish jarayonni to\'xtatadi va hech narsa yozmaydi', async () => {
    const h = harness();
    await completeRegistration(h);
    await h.handle(press('flow:cancel'));
    expect(h.lastMessage()!.payload.text).toContain('bekor qilindi');
    expect(h.rows).toHaveLength(0);
  });
});

describe('admin buyruqlari', () => {
  it('oddiy foydalanuvchi /admin va /stats ni ishlata olmaydi', async () => {
    const h = harness();
    await h.handle(text('/admin'));
    expect(h.lastMessage()!.payload.text).toContain('Noma\'lum buyruq');
    await h.handle(text('/stats'));
    expect(h.lastMessage()!.payload.text).toContain('Noma\'lum buyruq');
  });

  it('admin statistikani ko\'radi', async () => {
    const h = harness();
    await completeRegistration(h);
    await h.handle(press('confirm:yes'));
    await h.handle(text('/stats', ADMIN));
    expect(h.lastMessage()!.payload.text).toContain('Statistika');
    expect(h.lastMessage()!.payload.text).toContain('Jami ro\'yxatdan o\'tganlar: <b>1</b>');
  });

  it('admin menyusining tugmasi oddiy foydalanuvchi uchun ishlamaydi', async () => {
    const h = harness();
    await h.handle(press('admin:stats'));
    expect(h.texts()).toHaveLength(0);
  });
});

describe('ko\'p marta bosish va eskirgan tugmalar', () => {
  it('ro\'yxatdan o\'tishsiz tasdiqlash tugmasi eskirgan deb javob beradi', async () => {
    const h = harness();
    await h.handle(press('confirm:yes'));
    expect(h.lastMessage()!.payload.text).toContain('eskirgan');
    expect(h.rows).toHaveLength(0);
  });
});
