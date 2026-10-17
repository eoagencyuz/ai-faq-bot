import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pino from 'pino';
import { Telegram } from 'telegraf';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { createBot } from '../src/bot/index.js';
import { parseConfig } from '../src/config/env.js';
import { SessionStore } from '../src/services/session.js';
import { RegistrationRegistry, SHEET_HEADERS, type SheetsPort } from '../src/services/registry.js';
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
  dir: string;
  cleanup: () => void;
}

/**
 * Telegraf har bir update uchun yangi Telegram nusxasi yaratadi, shuning uchun
 * Telegram API chaqiruvlarini prototipda ushlaymiz (haqiqiy tarmoqqa chiqilmaydi).
 */
type Recorder = { sent: Sent[]; messageId: number; rejectStyled?: boolean };
let recorder: Recorder | null = null;
const telegramProto = Telegram.prototype as unknown as {
  callApi: (method: string, payload: Record<string, any>) => Promise<unknown>;
};
const originalCallApi = telegramProto.callApi;
telegramProto.callApi = async (method: string, payload: Record<string, any>) => {
  if (!recorder) throw new Error('Telegram chaqiruvi kutilmagan joyda');
  if (recorder.rejectStyled && JSON.stringify(payload.reply_markup ?? '').includes('"style"')) {
    throw new Error('Bad Request: BUTTON_STYLE_INVALID');
  }
  recorder.sent.push({ method, payload });
  if (method === 'copyMessage') return { message_id: recorder.messageId++ };
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

let rejectStyled: (on: boolean) => void = () => undefined;

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

/** `shared` berilsa, o'sha sessiya fayli va Sheets qatorlari bilan "qayta ishga tushirilgan" bot yaratiladi. */
function harness(shared?: { dir: string; rows: string[][] }): Harness {
  const dir = shared?.dir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'reg-bot-'));
  if (!shared) dirs.push(dir);
  const config = parseConfig(baseEnv());

  const rows: string[][] = shared?.rows ?? [];
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
    rateLimit: { limit: 10_000, windowMs: 10_000 },
    broadcastDelayMs: 0,
  });

  const sent: Sent[] = [];
  recorder = { sent, messageId: 1 };
  rejectStyled = (on: boolean) => {
    recorder!.rejectStyled = on;
  };
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
    dir,
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

const MOTIVATION = 'Media va AI sohasida amaliy tajriba orttirib, kontent yaratishni o‘rganmoqchiman.';
const GOAL = 'Uch oyda portfolio uchun 10 ta Reels tayyorlash.';

const markupOf = (m: Sent | undefined) => JSON.stringify(m?.payload.reply_markup ?? {});
const lastText = (h: Harness) => String(h.lastMessage()?.payload.text ?? '');

async function startQuestionnaire(h: Harness, uid = USER) {
  await h.handle(text('/start', uid));
  await h.handle(press('sub:check', uid));
  await h.handle(press('reg:start', uid));
}

/** Tanlab, "Keyingi" bosadi. */
async function choose(h: Harness, q: number, ...options: number[]) {
  for (const o of options) await h.handle(press(`a:${q}:${o}`));
  await h.handle(press(`n:${q}`));
}

/** 1–3 savollar: ism, telefon, Telegram kontakti. */
async function answerContactPart(h: Harness) {
  await h.handle(text('Aliyev Vali'));
  await h.handle(text('+998901234567'));
  await h.handle(contact('+998901234567', USER));
}

/** 4-savoldan 20-savolgacha (oxirgisidan tashqari). */
async function answerUntilLast(h: Harness) {
  await answerContactPart(h);
  await choose(h, 3, 10); // Dasturiy injiniring
  await choose(h, 4, 1); // 2-kurs
  await choose(h, 5, 0); // Faqat universitetda — 7-savol avtomatik
  await choose(h, 7, 2); // Kechqurun
  await choose(h, 8, 1); // 6–10 soat
  await choose(h, 9, 0); // Darhol
  await h.handle(text(MOTIVATION));
  await choose(h, 11, 0, 2); // SMM, Reels
  await choose(h, 12, 1);
  await choose(h, 13, 1); // Portfolio yo'q
  await choose(h, 14, 1);
  await choose(h, 15, 0, 1); // ChatGPT, Claude
  await choose(h, 16, 6); // Barchasi
  await choose(h, 17, 2);
  await h.handle(text(GOAL));
  await choose(h, 19, 0);
}

async function completeQuestionnaire(h: Harness) {
  await startQuestionnaire(h);
  await answerUntilLast(h);
  await choose(h, 20, 2);
}

const SUCCESS =
  '🎉 Media & AI shogirdlik anketangiz muvaffaqiyatli qabul qilindi!\nMa’lumotlaringiz uchun rahmat. Anketangiz ko‘rib chiqiladi. Keyingi bosqich bo‘yicha siz bilan bog‘lanishimiz mumkin.';

describe('/start va obuna', () => {
  it('/start kanal tugmalari va maxfiylik xabarini yuboradi', async () => {
    const h = harness();
    await h.handle(text('/start'));
    const msg = h.lastMessage()!;
    expect(msg.payload.text).toContain('Assalomu alaykum');
    expect(msg.payload.text).toContain('Ma’lumotlaringiz');
    const buttons = markupOf(msg);
    expect(buttons).toContain('sub:check');
    expect(buttons).toContain('https://t.me/kanal_bir');
    expect(buttons).toContain('https://t.me/kanal_ikki');
  });

  it("obuna bo'lgan foydalanuvchi qoidalarni ko'radi va anketani boshlaydi", async () => {
    const h = harness();
    await startQuestionnaire(h);
    expect(h.texts().some((t) => t.includes('Anketa qoidalari'))).toBe(true);
    expect(lastText(h)).toContain('Savol 1/21');
    expect(lastText(h)).toContain('Ism-familiyangizni to‘liq kiriting.');
  });

  it("obuna bo'lmagan foydalanuvchi anketani boshlay olmaydi", async () => {
    const h = harness();
    h.setMember('@kanal_bir', { status: 'left' });
    await h.handle(text('/start'));
    await h.handle(press('reg:start'));
    expect(h.texts().some((t) => t.includes('Savol 1/21'))).toBe(false);
    expect(lastText(h)).toContain('obuna bo‘lmagansiz');
    await h.handle(text('Aliyev Vali'));
    expect(h.texts().some((t) => t.includes('Savol 2/21'))).toBe(false);
  });

  it("faqat birinchi kanalga obuna bo'lsa, ikkinchisi aytiladi", async () => {
    const h = harness();
    h.setMember('-1001234567890', { status: 'left' });
    await h.handle(text('/start'));
    await h.handle(press('sub:check'));
    expect(lastText(h)).toContain('2-kanal');
    expect(lastText(h)).not.toContain('• 1-kanal');
  });

  it("Telegram API xatosi obuna yo'q deb ko'rsatilmaydi", async () => {
    const h = harness();
    h.setMember('-1001234567890', 'error');
    await h.handle(text('/start'));
    await h.handle(press('sub:check'));
    expect(lastText(h)).toContain('vaqtinchalik');
    expect(markupOf(h.lastMessage())).toContain('sub:check');
  });
});

describe('telefon raqami', () => {
  it("noto'g'ri formatdagi raqam rad etiladi, to'g'risi qabul qilinadi", async () => {
    const h = harness();
    await startQuestionnaire(h);
    await h.handle(text('Aliyev Vali'));
    await h.handle(text('12345'));
    expect(lastText(h)).toContain('Telefon raqami noto‘g‘ri');
    await h.handle(text('+998901234567'));
    expect(lastText(h)).toContain('Savol 3/21');
  });

  it('kontakt "📱 Raqamni ulashish" tugmasi orqali so\'raladi va qabul qilinadi', async () => {
    const h = harness();
    await startQuestionnaire(h);
    await h.handle(text('Aliyev Vali'));
    await h.handle(text('+998901234567'));
    const ask = h.lastMessage()!;
    expect(ask.payload.reply_markup.keyboard[0][0]).toMatchObject({ text: '📱 Raqamni ulashish', request_contact: true });
    await h.handle(text('+998901234567'));
    expect(lastText(h)).toContain('Raqamni ulashish');
    await h.handle(contact('998901234567', USER));
    expect(h.texts()).toContain('✅ Telefon raqami qabul qilindi.');
    expect(lastText(h)).toContain('Savol 4/21');
  });

  it("boshqa odamning kontakti rad etiladi, keyin o'zinikini yuborish mumkin", async () => {
    const h = harness();
    await startQuestionnaire(h);
    await h.handle(text('Aliyev Vali'));
    await h.handle(text('+998901234567'));
    await h.handle(contact('+998905550000', 999));
    expect(lastText(h)).toContain('Boshqa odamning kontakti qabul qilinmaydi');
    await h.handle(contact('+998901234567', USER));
    expect(lastText(h)).toContain('Savol 4/21');
  });

  it('raqamlar farq qilsa, tasdiqlashsiz davom etilmaydi', async () => {
    const h = harness();
    await startQuestionnaire(h);
    await h.handle(text('Aliyev Vali'));
    await h.handle(text('+998901234567'));
    await h.handle(contact('+998931112233', USER));
    expect(lastText(h)).toContain('farq qiladi');
    expect(markupOf(h.lastMessage())).toContain('pc:2:y');
    await h.handle(text('salom'));
    expect(h.texts().some((t) => t.includes('Savol 4/21'))).toBe(false);
    await h.handle(press('pc:2:y'));
    expect(lastText(h)).toContain('Savol 4/21');
    await h.handle(press('pc:2:y'));
    expect(h.texts().filter((t) => t.includes('Savol 4/21'))).toHaveLength(1);
  });
});

describe('anketa oqimi', () => {
  it("21 savol ketma-ket so'raladi va to'liq anketa Sheets'ga yoziladi", async () => {
    const h = harness();
    await completeQuestionnaire(h);
    const asked = h.texts().map((t) => /Savol (\d+)\/21/.exec(t)?.[1]).filter(Boolean).map(Number);
    // 7-savol avtomatik ("Faqat universitetda tahsil olaman")
    expect(asked).toEqual([1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21]);
    expect(lastText(h)).toBe(SUCCESS);
    expect(h.rows).toHaveLength(1);
    const row = h.rows[0]!;
    const col = (name: (typeof SHEET_HEADERS)[number]) => row[SHEET_HEADERS.indexOf(name)];
    expect(row).toHaveLength(30);
    expect(col('Telegram User ID')).toBe(String(USER));
    expect(col('Full Name')).toBe('Aliyev Vali');
    expect(col('Phone')).toBe('+998901234567');
    expect(col('Telegram Phone Match')).toBe('Ha');
    expect(col('Program')).toBe('Dasturiy injiniring');
    expect(col('Work Field')).toBe('Hozir ishlamayman.');
    expect(col('Motivation')).toBe(MOTIVATION);
    expect(col('Media Interests')).toBe('SMM va ijtimoiy tarmoqlar.; Reels va qisqa videolar yaratish.');
    expect(col('AI Tools')).toBe('ChatGPT.; Claude.');
    expect(col('AI Goals')).toBe('Barchasini bosqichma-bosqich o‘rganish.');
    expect(col('Has Portfolio')).toBe('Yo‘q');
    expect(col('Three Month Goal')).toBe(GOAL);
    expect(col('Work Style')).toBe('Har ikkala usul ham menga mos.');
    expect(col('Subscription Verified')).toBe('Ha');
  });

  it("bo'sh va qisqa javoblar qabul qilinmaydi", async () => {
    const h = harness();
    await startQuestionnaire(h);
    await h.handle(text('   '));
    expect(lastText(h)).toContain('⚠️');
    await h.handle(text('Ali'));
    expect(lastText(h)).toContain('⚠️');
    await answerContactPart(h);
    await choose(h, 3, 10);
    await choose(h, 4, 1);
    await choose(h, 5, 0);
    await choose(h, 7, 2);
    await choose(h, 8, 1);
    await choose(h, 9, 0);
    await h.handle(text('juda qisqa'));
    expect(lastText(h)).toContain('kamida 30');
    expect(h.texts().some((t) => t.includes('Savol 12/21'))).toBe(false);
  });

  it("tanlovsiz 'Keyingi' ishlamaydi va tugma tanlovdan keyin paydo bo'ladi", async () => {
    const h = harness();
    await startQuestionnaire(h);
    await answerContactPart(h);
    expect(markupOf(h.lastMessage())).not.toContain('n:3');
    await h.handle(press('n:3'));
    expect(h.texts().some((t) => t.includes('Savol 5/21'))).toBe(false);
    await h.handle(press('a:3:0'));
    const edit = [...h.sent].reverse().find((s) => s.method === 'editMessageReplyMarkup')!;
    expect(JSON.stringify(edit.payload.reply_markup)).toContain('n:3');
    expect(JSON.stringify(edit.payload.reply_markup)).toContain('✅');
  });

  it("'Boshqa.' tanlansa izoh majburiy va asosiy javob bilan birga saqlanadi", async () => {
    const h = harness();
    await startQuestionnaire(h);
    await answerContactPart(h);
    await choose(h, 3, 0);
    await choose(h, 4, 0);
    await choose(h, 5, 6); // Boshqa.
    expect(lastText(h)).toContain('izoh');
    await h.handle(text('  '));
    expect(lastText(h)).toContain('Izoh bo‘sh bo‘lmasligi kerak');
    await h.handle(text('Volontyorlik qilaman'));
    expect(lastText(h)).toContain('Savol 7/21');
    await choose(h, 6, 6); // ish sohasi: Boshqa.
    await h.handle(text('Tadbirlar tashkilotchisi'));
    expect(lastText(h)).toContain('Savol 8/21');
    await choose(h, 7, 0);
    await choose(h, 8, 0);
    await choose(h, 9, 0);
    await h.handle(text(MOTIVATION));
    await choose(h, 11, 8);
    await choose(h, 12, 0);
    await choose(h, 13, 1);
    await choose(h, 14, 0);
    await choose(h, 15, 7);
    await choose(h, 16, 0);
    await choose(h, 17, 0);
    await h.handle(text(GOAL));
    await choose(h, 19, 1);
    await choose(h, 20, 0);
    const row = h.rows[0]!;
    const col = (name: (typeof SHEET_HEADERS)[number]) => row[SHEET_HEADERS.indexOf(name)];
    expect(col('Occupation')).toBe('Boshqa.');
    expect(col('Occupation Other')).toBe('Volontyorlik qilaman');
    expect(col('Work Field')).toBe('Boshqa.');
    expect(col('Work Field Other')).toBe('Tadbirlar tashkilotchisi');
    expect(col('AI Tools')).toBe('Hozircha hech qaysisini bilmayman.');
    expect(col('Ready For Tasks')).toBe('Avval dastur shartlari va talablar bilan tanishmoqchiman.');
  });

  it("ko'p tanlov: eksklyuziv variantlar boshqalarini olib tashlaydi", async () => {
    const h = harness();
    await startQuestionnaire(h);
    await answerContactPart(h);
    await choose(h, 3, 0);
    await choose(h, 4, 0);
    await choose(h, 5, 0);
    await choose(h, 7, 0);
    await choose(h, 8, 0);
    await choose(h, 9, 0);
    await h.handle(text(MOTIVATION));
    await choose(h, 11, 0);
    await choose(h, 12, 0);
    await choose(h, 13, 1);
    await choose(h, 14, 0);
    // AI vositalari: ChatGPT, Claude, keyin "hech qaysisini bilmayman", keyin Gemini
    await choose(h, 15, 0, 1, 7, 2);
    // Ko'nikmalar: Matn, Video, keyin "Barchasi"
    await choose(h, 16, 0, 2, 6);
    await choose(h, 17, 0);
    await h.handle(text(GOAL));
    await choose(h, 19, 0);
    await choose(h, 20, 0);
    const row = h.rows[0]!;
    expect(row[SHEET_HEADERS.indexOf('AI Tools')]).toBe('Gemini.');
    expect(row[SHEET_HEADERS.indexOf('AI Goals')]).toBe('Barchasini bosqichma-bosqich o‘rganish.');
  });

  it('portfolio: havola tekshiriladi va alohida ustunga yoziladi', async () => {
    const h = harness();
    await startQuestionnaire(h);
    await answerContactPart(h);
    await choose(h, 3, 0);
    await choose(h, 4, 0);
    await choose(h, 5, 0);
    await choose(h, 7, 0);
    await choose(h, 8, 0);
    await choose(h, 9, 0);
    await h.handle(text(MOTIVATION));
    await choose(h, 11, 0);
    await choose(h, 12, 0);
    await choose(h, 13, 0); // havola yuboraman
    expect(lastText(h)).toContain('Portfolio havolasini yuboring');
    await h.handle(text('portfolio yoq'));
    expect(lastText(h)).toContain('⚠️');
    await h.handle(text('behance.net/aliyev'));
    expect(lastText(h)).toContain('Savol 15/21');
    await choose(h, 14, 0);
    await choose(h, 15, 0);
    await choose(h, 16, 0);
    await choose(h, 17, 0);
    await h.handle(text(GOAL));
    await choose(h, 19, 0);
    await choose(h, 20, 0);
    const row = h.rows[0]!;
    expect(row[SHEET_HEADERS.indexOf('Has Portfolio')]).toBe('Ha');
    expect(row[SHEET_HEADERS.indexOf('Portfolio URL')]).toBe('https://behance.net/aliyev');
  });
});

describe('bir martalik javob va eski tugmalar', () => {
  it("bir savolga ikkinchi javob qabul qilinmaydi (eski tugmalar ishlamaydi)", async () => {
    const h = harness();
    await startQuestionnaire(h);
    await answerContactPart(h);
    await choose(h, 3, 10);
    expect(lastText(h)).toContain('Savol 5/21');
    const before = h.texts().length;
    await h.handle(press('a:3:0'));
    await h.handle(press('n:3'));
    expect(h.texts().length).toBe(before);
    const answers = h.sent.filter((s) => s.method === 'answerCallbackQuery').slice(-2);
    expect(answers.every((a) => a.payload.text === 'Bu savolga javob berib bo‘lingan.')).toBe(true);
    await choose(h, 4, 0);
    await choose(h, 5, 0);
    await choose(h, 7, 0);
    await choose(h, 8, 0);
    await choose(h, 9, 0);
    await h.handle(text(MOTIVATION));
    await choose(h, 11, 0);
    await choose(h, 12, 0);
    await choose(h, 13, 1);
    await choose(h, 14, 0);
    await choose(h, 15, 0);
    await choose(h, 16, 0);
    await choose(h, 17, 0);
    await h.handle(text(GOAL));
    await choose(h, 19, 0);
    await choose(h, 20, 0);
    expect(h.rows[0]![SHEET_HEADERS.indexOf('Program')]).toBe('Dasturiy injiniring');
  });

  it("orqaga, tahrirlash yoki bekor qilish tugmalari yo'q", async () => {
    const h = harness();
    await completeQuestionnaire(h);
    const all = h.sent.map((s) => JSON.stringify(s.payload.reply_markup ?? {})).join('\n');
    expect(all).not.toMatch(/Orqaga|Ortga|Tahrirlash|Bekor qilish|flow:back|flow:cancel|edit:|confirm:/);
  });

  it('avvalgi versiyadagi orqaga/tahrirlash tugmalari hech narsa qilmaydi', async () => {
    const h = harness();
    await startQuestionnaire(h);
    await h.handle(text('Aliyev Vali'));
    const before = h.texts().length;
    for (const data of ['flow:back', 'flow:cancel', 'confirm:edit', 'edit:full_name', 'resume:restart']) {
      await h.handle(press(data));
    }
    expect(h.texts().length).toBe(before);
    await h.handle(text('/cancel'));
    expect(lastText(h)).toContain('bekor qilib yoki qayta boshlab bo‘lmaydi');
    await h.handle(text('/start'));
    expect(lastText(h)).toContain('Savol 2/21');
  });

  it('parallel bosishlar bitta javob va bitta yozuv beradi', async () => {
    const h = harness();
    await startQuestionnaire(h);
    await answerUntilLast(h);
    await h.handle(press('a:20:0'));
    await Promise.all([h.handle(press('n:20')), h.handle(press('n:20')), h.handle(press('n:20'))]);
    expect(h.rows).toHaveLength(1);
    expect(h.texts().filter((t) => t === SUCCESS)).toHaveLength(1);
  });

  it('parallel matnli xabarlardan birinchisi qabul qilinadi', async () => {
    const h = harness();
    await startQuestionnaire(h);
    await Promise.all([h.handle(text('Aliyev Vali')), h.handle(text('Karimov Sardor'))]);
    // Birinchi javob ism sifatida qabul qilinadi; ikkinchisi keyingi savol (telefon) uchun noto'g'ri deb rad etiladi
    const saved = JSON.parse(fs.readFileSync(path.join(h.dir, 'sessions.json'), 'utf8'));
    expect(saved.sessions[String(USER)].answers.full_name).toEqual({ kind: 'text', value: 'Aliyev Vali' });
    expect(saved.sessions[String(USER)].currentQuestionIndex).toBe(1);
    expect(lastText(h)).toContain('Telefon raqami noto‘g‘ri');
  });
});

describe('sessiya tiklanishi', () => {
  it("sessiya yo'qolgan bo'lsa (disk tozalangan), tugma /start ga yo'naltiradi", async () => {
    const h = harness();
    await startQuestionnaire(h);
    await answerContactPart(h);
    fs.rmSync(path.join(h.dir, 'sessions.json'));
    const restarted = harness({ dir: h.dir, rows: h.rows });
    await restarted.handle(press('a:3:0'));
    expect(lastText(restarted)).toContain('Anketangiz holati topilmadi');
    expect(lastText(restarted)).toContain('/start');
  });

  it('server qayta ishga tushgandan keyin anketa shu savoldan davom etadi', async () => {
    const h = harness();
    await startQuestionnaire(h);
    await answerContactPart(h);
    await choose(h, 3, 10);

    const restarted = harness({ dir: h.dir, rows: h.rows });
    await restarted.handle(text('/start'));
    expect(lastText(restarted)).toContain('Savol 5/21');
    await restarted.handle(press('a:4:1'));
    await restarted.handle(press('n:4'));
    expect(lastText(restarted)).toContain('Savol 6/21');
  });
});

describe('Google Sheets', () => {
  it("tugallanmagan anketa Sheets'ga yozilmaydi", async () => {
    const h = harness();
    await startQuestionnaire(h);
    await answerUntilLast(h);
    expect(h.rows).toHaveLength(0);
    expect(h.texts().some((t) => t.includes('muvaffaqiyatli'))).toBe(false);
  });

  it("yakunlangan anketani qayta yuborib bo'lmaydi", async () => {
    const h = harness();
    await completeQuestionnaire(h);
    await h.handle(text('/start'));
    expect(lastText(h)).toContain('allaqachon topshirgansiz');
    expect(h.lastMessage()!.payload.reply_markup.inline_keyboard[0][0]).toEqual({ text: '👤 Administrator', url: 'https://t.me/admin_kontakt' });
    await h.handle(press('reg:start'));
    await h.handle(press('fin:retry'));
    await h.handle(press('n:20'));
    expect(h.rows).toHaveLength(1);
    expect(h.texts().filter((t) => t === SUCCESS)).toHaveLength(1);
  });

  it("Sheets'da allaqachon bor foydalanuvchi qayta boshlay olmaydi (sessiya o'chgan bo'lsa ham)", async () => {
    const h = harness();
    await completeQuestionnaire(h);
    fs.rmSync(path.join(h.dir, 'sessions.json'));
    const restarted = harness({ dir: h.dir, rows: h.rows });
    await restarted.handle(text('/start'));
    expect(lastText(restarted)).toContain('allaqachon topshirgansiz');
  });

  it("vaqtinchalik xatoda ma'lumot yo'qolmaydi va qayta urinishda bir marta yoziladi", async () => {
    const h = harness();
    await startQuestionnaire(h);
    await answerUntilLast(h);
    h.failNextAppend();
    await choose(h, 20, 2);
    expect(h.texts().some((t) => t === SUCCESS)).toBe(false);
    expect(lastText(h)).toContain('saqlashda vaqtinchalik xato');
    expect(markupOf(h.lastMessage())).toContain('fin:retry');
    expect(h.rows).toHaveLength(0);

    // Qayta ishga tushirilgandan keyin ham javoblar saqlangan
    const restarted = harness({ dir: h.dir, rows: h.rows });
    await restarted.handle(press('fin:retry'));
    expect(lastText(restarted)).toBe(SUCCESS);
    expect(h.rows).toHaveLength(1);
  });

  it("yakunlashda obuna qayta tekshiriladi", async () => {
    const h = harness();
    await startQuestionnaire(h);
    await answerUntilLast(h);
    h.setMember('-1001234567890', { status: 'left' });
    await choose(h, 20, 2);
    expect(h.rows).toHaveLength(0);
    expect(lastText(h)).toContain('obuna bo‘lmagansiz');
    h.setMember('-1001234567890', { status: 'member' });
    await h.handle(press('sub:check'));
    expect(lastText(h)).toBe(SUCCESS);
    expect(h.rows).toHaveLength(1);
  });
});

describe('tugma ranglari', () => {
  it("kanal tugmalari rangsiz va nomi bilan, tekshirish tugmasi yashil", async () => {
    const h = harness();
    await h.handle(text('/start'));
    const rows = h.lastMessage()!.payload.reply_markup.inline_keyboard as Array<Array<Record<string, string>>>;
    expect(rows[0]![0]).toEqual({ text: '1. 1-kanal', url: 'https://t.me/kanal_bir' });
    expect(rows[1]![0]!.style).toBeUndefined();
    expect(rows[2]![0]).toMatchObject({ callback_data: 'sub:check', style: 'success' });
  });

  it('Telegram rangni rad etsa, xabar rangsiz tugmalar bilan baribir yetkaziladi', async () => {
    const h = harness();
    rejectStyled(true);
    await h.handle(text('/start'));
    const msg = h.lastMessage()!;
    expect(msg.payload.text).toContain('Assalomu alaykum');
    expect(markupOf(msg)).toContain('sub:check');
    expect(markupOf(msg)).not.toContain('"style"');
  });
});

describe("qo'llab-quvvatlanmaydigan xabarlar", () => {
  it("rasm yuborilsa, matn so'raladi", async () => {
    const h = harness();
    await h.handle({ message: { message_id: 1, date: 0, chat: chat(USER), from: { id: USER, is_bot: false, first_name: 'Ali' }, photo: [{ file_id: 'x', file_unique_id: 'y', width: 1, height: 1 }] } });
    expect(lastText(h)).toContain('matn');
  });
});

describe('admin buyruqlari', () => {
  it('oddiy foydalanuvchi /admin va /stats ni ishlata olmaydi', async () => {
    const h = harness();
    await h.handle(text('/admin'));
    expect(lastText(h)).toContain('Noma’lum buyruq');
    await h.handle(text('/stats'));
    expect(lastText(h)).toContain('Noma’lum buyruq');
  });

  it("admin statistikani va oxirgi anketalarni ko'radi (telefon yashirilgan)", async () => {
    const h = harness();
    await completeQuestionnaire(h);
    await h.handle(text('/stats', ADMIN));
    expect(lastText(h)).toContain('Statistika');
    expect(lastText(h)).toContain('Jami topshirilgan anketalar: <b>1</b>');
    await h.handle(press('admin:recent', ADMIN));
    expect(lastText(h)).toContain('Aliyev Vali');
    expect(lastText(h)).not.toContain('+998901234567');
  });

  it('admin menyusining tugmasi oddiy foydalanuvchi uchun ishlamaydi', async () => {
    const h = harness();
    await h.handle(press('admin:stats'));
    expect(h.texts()).toHaveLength(0);
  });
});

describe('yuklama', () => {
  it("100 kishi bir vaqtda to'ldirsa, har biri bir marta yoziladi", async () => {
    const h = harness();
    const fill = async (uid: number) => {
      const c = (q: number, ...opts: number[]) => async () => {
        for (const o of opts) await h.handle(press(`a:${q}:${o}`, uid));
        await h.handle(press(`n:${q}`, uid));
      };
      const steps: Array<() => Promise<void>> = [
        () => h.handle(text('/start', uid)),
        () => h.handle(press('sub:check', uid)),
        () => h.handle(press('reg:start', uid)),
        () => h.handle(text('Aliyev Vali', uid)),
        () => h.handle(text('+998901234567', uid)),
        () => h.handle(contact('+998901234567', uid, uid)),
        c(3, 0), c(4, 0), c(5, 0), c(7, 0), c(8, 0), c(9, 0),
        () => h.handle(text(MOTIVATION, uid)),
        c(11, 0), c(12, 0), c(13, 1), c(14, 0), c(15, 0), c(16, 0), c(17, 0),
        () => h.handle(text(GOAL, uid)),
        c(19, 0),
        // Oxirgi savolda "Keyingi" ikki marta parallel bosiladi
        async () => {
          await h.handle(press('a:20:0', uid));
          await Promise.all([h.handle(press('n:20', uid)), h.handle(press('n:20', uid))]);
        },
      ];
      for (const step of steps) await step();
    };
    const users = Array.from({ length: 100 }, (_, i) => 1_000 + i);
    await Promise.all(users.map(fill));
    expect(h.rows).toHaveLength(100);
    expect(new Set(h.rows.map((r) => r[SHEET_HEADERS.indexOf('Telegram User ID')])).size).toBe(100);
    expect(h.texts().filter((t) => t === SUCCESS)).toHaveLength(100);
  }, 60_000);
});

describe('rassilka', () => {
  it("admin xabarni tasdiqlagach, anketa topshirgan barcha talabalarga yuboriladi", async () => {
    const h = harness();
    await completeQuestionnaire(h);
    await h.handle(text('/broadcast', ADMIN));
    expect(lastText(h)).toContain('Rassilka');
    await h.handle(text('Ertaga soat 15:00 da tanishuv uchrashuvi bo‘ladi.', ADMIN));
    expect(lastText(h)).toContain('<b>1</b> ta talabaga yuboriladi');
    expect(markupOf(h.lastMessage())).toContain('bc:send');
    // Admin matni anketa javobi sifatida qabul qilinmagan
    expect(h.texts().some((t) => t.includes('Savol 1/21') && t.includes('⚠️'))).toBe(false);

    await h.handle(press('bc:send', ADMIN));
    const copies = h.sent.filter((s) => s.method === 'copyMessage');
    expect(copies).toHaveLength(1);
    expect(copies[0]!.payload).toMatchObject({ chat_id: USER, from_chat_id: ADMIN });
    expect(lastText(h)).toContain('Rassilka yakunlandi');
    expect(lastText(h)).toContain('Yetkazildi: <b>1</b>');

    // Tugma qayta bosilsa, ikkinchi marta yuborilmaydi
    await h.handle(press('bc:send', ADMIN));
    expect(h.sent.filter((s) => s.method === 'copyMessage')).toHaveLength(1);
  });

  it('bekor qilish mumkin va hech kimga yuborilmaydi', async () => {
    const h = harness();
    await completeQuestionnaire(h);
    await h.handle(text('/broadcast', ADMIN));
    await h.handle(text('Sinov xabari', ADMIN));
    await h.handle(press('bc:cancel', ADMIN));
    expect(lastText(h)).toContain('bekor qilindi');
    await h.handle(press('bc:send', ADMIN));
    expect(h.sent.filter((s) => s.method === 'copyMessage')).toHaveLength(0);

    await h.handle(text('/broadcast', ADMIN));
    await h.handle(text('/cancel', ADMIN));
    expect(lastText(h)).toContain('Rassilka bekor qilindi');
  });

  it('oddiy foydalanuvchi rassilka qila olmaydi', async () => {
    const h = harness();
    await h.handle(text('/broadcast'));
    expect(lastText(h)).toContain('Noma’lum buyruq');
    await h.handle(press('bc:send'));
    expect(h.sent.filter((s) => s.method === 'copyMessage')).toHaveLength(0);
  });

  it("talaba bo'lmasa, rassilka yuborilmaydi", async () => {
    const h = harness();
    await h.handle(text('/broadcast', ADMIN));
    await h.handle(text('Salom', ADMIN));
    expect(lastText(h)).toContain('talabalar yo‘q');
  });
});
