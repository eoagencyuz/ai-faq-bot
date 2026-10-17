import { randomBytes } from 'node:crypto';
import { Telegraf, type Context } from 'telegraf';
import type { InlineKeyboardMarkup } from 'telegraf/types';
import type { Config } from '../types/index.js';
import {
  AnswerRejected,
  acceptAnswer,
  allAnswered,
  currentQuestion,
  newSession,
  type SessionStore,
  type UserSession,
} from '../services/session.js';
import type { RegistrationRegistry } from '../services/registry.js';
import { computeStats, recentRows } from '../services/registry.js';
import {
  hasNamePlaceholder,
  namesFromRows,
  parseIdList,
  personalize,
  recipientsFromRows,
  sendBroadcast,
} from '../services/broadcast.js';
import { checkSubscriptions, type MemberFetcher, type SubscriptionReport } from '../services/subscription.js';
import {
  findInvalidAnswer,
  optionsOf,
  toggleSelection,
  validateSelection,
  type Answer,
  type Question,
} from '../services/questionnaire.js';
import {
  contactPhone,
  normalizePhone,
  validateFullName,
  validateLongText,
  validateNote,
  validatePortfolioUrl,
} from '../validators/registration.js';
import { createRateLimiter } from '../middleware/rate-limit.js';
import { describeError, hashId, type Logger } from '../utils/logger.js';
import { TEXT, escapeHtml, questionText } from './texts.js';
import * as kb from './keyboards.js';
import type { Markup } from './keyboards.js';
import { formatBotStatus, formatRecent, formatStats } from './admin.js';

export interface BotDeps {
  config: Config;
  sessions: SessionStore;
  registry: RegistrationRegistry;
  fetchMember: MemberFetcher;
  logger: Logger;
  startedAt: Date;
  now?: () => Date;
  /** Spamdan himoya: foydalanuvchi uchun oynadagi maksimal update soni. */
  rateLimit?: { limit: number; windowMs: number };
  /** Rassilkada xabarlar orasidagi kutish (ms). Testlarda 0. */
  broadcastDelayMs?: number;
  /**
   * true (ishlab chiqarishda): har bir update fonda bajariladi, polling keyingi xabarlarni kutmasdan oladi.
   * Telegraf bir paketdagi barcha update'larni kutadi — bitta sekin Sheets so'rovi hammani to'xtatib qo'ymasligi uchun.
   * Bitta foydalanuvchining xabarlari baribir navbat (withLock) bilan ketma-ket bajariladi.
   */
  detachUpdates?: boolean;
}

const MAX_MESSAGE_CHARS = 4000;
const RATE_LIMIT = { limit: 30, windowMs: 10_000 };

function newRegistrationId(date: Date): string {
  return `MAI-${date.getTime().toString(36).toUpperCase()}-${randomBytes(3).toString('hex').toUpperCase()}`;
}

export function createBot(deps: BotDeps): Telegraf {
  const { config, sessions, registry, fetchMember, logger, startedAt } = deps;
  const now = deps.now ?? (() => new Date());
  const bot = new Telegraf(config.botToken, { handlerTimeout: 30_000 });
  const rate = deps.rateLimit ?? RATE_LIMIT;
  const allowUpdate = createRateLimiter(rate.limit, rate.windowMs);

  const uidOf = (ctx: Context): number => {
    const id = ctx.from?.id;
    if (id === undefined) throw new Error("Update tarkibida foydalanuvchi yo'q");
    return id;
  };
  const isAdmin = (uid: number) => config.adminIds.includes(uid);

  // ---- Har foydalanuvchi uchun navbat: parallel xabarlar ketma-ket bajariladi, birinchi to'g'ri javob qabul qilinadi ----
  const queues = new Map<number, Promise<unknown>>();
  const withLock = <T>(uid: number, fn: () => Promise<T>): Promise<T> => {
    const previous = queues.get(uid) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(fn);
    queues.set(uid, run);
    return run.finally(() => {
      if (queues.get(uid) === run) queues.delete(uid);
    });
  };

  const say = async (ctx: Context, text: string, markup?: Markup) => {
    const send = (m?: Markup) =>
      ctx.reply(text, { parse_mode: 'HTML', link_preview_options: { is_disabled: true }, reply_markup: m });
    try {
      return await send(markup);
    } catch (err) {
      // Telegram tugma rangini qabul qilmasa, xabar yo'qolmasligi uchun rangsiz qayta yuboramiz
      if (markup && kb.hasStyles(markup)) {
        logger.warn({ err: describeError(err) }, 'Tugma ranglari qabul qilinmadi, rangsiz yuborildi');
        return send(kb.withoutStyles(markup));
      }
      throw err;
    }
  };

  /** Tugmali xabarning klaviaturasini yangilaydi. Xato bo'lsa (masalan, o'zgarish yo'q) — e'tiborsiz. */
  const editMarkup = async (ctx: Context, markup: InlineKeyboardMarkup) => {
    try {
      await ctx.editMessageReplyMarkup(markup);
    } catch {
      if (kb.hasStyles(markup)) await ctx.editMessageReplyMarkup(kb.withoutStyles(markup)).catch(() => undefined);
    }
  };

  const adminContact = () => (config.adminContactUrl ? kb.adminContactKeyboard(config.adminContactUrl) : undefined);
  const sayAlreadyRegistered = (ctx: Context) => say(ctx, TEXT.alreadyRegistered, adminContact());

  const ack = (ctx: Context, text?: string) => ctx.answerCbQuery(text).catch(() => undefined);

  const verify = (uid: number): Promise<SubscriptionReport> =>
    checkSubscriptions(config.channels, uid, fetchMember, (channel, err) =>
      logger.warn({ channel: channel.key, err: describeError(err) }, 'Obuna tekshiruvi xatosi'),
    );

  const sendSubscriptionProblem = async (ctx: Context, report: SubscriptionReport) => {
    if (report.missing.length > 0) {
      await say(ctx, TEXT.missing(report.missing.map((c) => c.name)), kb.subscribeKeyboard(config.channels));
    } else {
      await say(ctx, TEXT.subscriptionError, kb.retryKeyboard('sub:check'));
    }
  };

  /** Obuna tasdiqlanmagan bo'lsa, tegishli xabarni yuboradi va false qaytaradi. */
  const gate = async (ctx: Context, uid: number): Promise<boolean> => {
    const report = await verify(uid);
    if (report.subscribed) return true;
    logger.info({ userHash: hashId(uid), missing: report.missing.length, failed: report.failed.length }, 'Obuna talab qilindi');
    await sendSubscriptionProblem(ctx, report);
    return false;
  };

  /** Sheets'da borligini tekshiradi; Sheets ishlamasa, foydalanuvchini to'xtatmaymiz (yakunda yana tekshiriladi). */
  const registeredInSheets = async (uid: number): Promise<boolean> => {
    try {
      return await registry.isRegistered(uid);
    } catch (err) {
      logger.warn({ err: describeError(err) }, 'Dublikat tekshiruvi vaqtincha bajarilmadi');
      return false;
    }
  };

  /** Javoblar Sheets'da saqlangan — sessiyada faqat holat qoladi (fayl va zaxira kichik bo'lsin). */
  const markCompleted = (session: UserSession) => {
    sessions.save({
      ...session,
      status: 'completed',
      answers: {},
      answeredQuestions: [],
      completedQuestions: [],
      pending: { selection: [] },
    });
  };

  // ---- Savollarni ko'rsatish ----

  const askQuestion = async (ctx: Context, session: UserSession): Promise<void> => {
    const q = currentQuestion(session);
    if (!q) return;
    const index = session.currentQuestionIndex;
    const { pending } = session;
    if (pending.awaiting === 'other_note') {
      await say(ctx, TEXT.otherNote);
      return;
    }
    if (pending.awaiting === 'portfolio_url') {
      await say(ctx, TEXT.portfolioUrl);
      return;
    }
    if (pending.awaiting === 'phone_confirm' && pending.contactPhone) {
      const manual = session.answers.phone;
      await say(
        ctx,
        TEXT.phoneMismatch(manual?.kind === 'text' ? manual.value : '', pending.contactPhone),
        kb.phoneConfirmKeyboard(index),
      );
      return;
    }
    const text = questionText(index, q);
    if (q.kind === 'phone_contact') await say(ctx, text, kb.contactKeyboard);
    else if (optionsOf(q).length > 0) await say(ctx, text, kb.choiceKeyboard(index, q, pending.selection));
    else await say(ctx, text);
  };

  /** Javobni qabul qilib, sessiyani saqlaydi va keyingi savolni beradi (yoki anketani yakunlaydi). */
  const commit = async (ctx: Context, session: UserSession, q: Question, answer: Answer): Promise<void> => {
    const next = acceptAnswer(session, q.key, answer, now().getTime());
    // Diskka yozilmaguncha keyingi savolga o'tilmaydi; xato bo'lsa javob qabul qilinmagan hisoblanadi
    sessions.save(next);
    logger.info({ userHash: hashId(session.telegramUserId), question: q.key }, 'Javob qabul qilindi');
    if (q.kind === 'phone_contact') await say(ctx, TEXT.contactSaved, kb.removeKeyboard);
    if (allAnswered(next)) await finalize(ctx, next);
    else await askQuestion(ctx, next);
  };

  // ---- Yakunlash ----

  const finalize = async (ctx: Context, session: UserSession): Promise<void> => {
    const uid = session.telegramUserId;
    const userHash = hashId(uid);
    if (session.status === 'completed') {
      await sayAlreadyRegistered(ctx);
      return;
    }
    if (session.status !== 'in_progress' || !allAnswered(session)) return;

    // 1–2. Barcha javoblarni server tomonida qayta tekshirish
    const invalid = findInvalidAnswer(session.answers);
    if (invalid) {
      logger.error({ userHash, question: invalid.key }, "Saqlangan javob tekshiruvdan o'tmadi");
      await say(ctx, TEXT.invalidStored, adminContact());
      return;
    }
    const saving: UserSession = { ...session, status: 'saving' };
    sessions.save(saving);
    const backToProgress = () => sessions.save({ ...saving, status: 'in_progress' });
    await say(ctx, TEXT.saving);
    try {
      // 3. Avval topshirganmi
      if (await registry.isRegistered(uid)) {
        markCompleted(saving);
        logger.info({ userHash }, 'Anketa avval topshirilgan');
        await sayAlreadyRegistered(ctx);
        return;
      }
      // 4. Obunani qayta tekshirish
      const report = await verify(uid);
      if (!report.subscribed) {
        backToProgress();
        await sendSubscriptionProblem(ctx, report);
        return;
      }
      // 5. Google Sheets'ga yozish (idempotent)
      const outcome = await registry.save({
        id: newRegistrationId(now()),
        createdAt: now(),
        userId: uid,
        username: ctx.from?.username ?? session.telegramUsername,
        answers: session.answers,
        subscriptionVerified: true,
      });
      // 6. Faqat shundan keyin yakunlangan deb belgilanadi
      markCompleted(saving);
      logger.info({ userHash, outcome }, 'Anketa yakunlandi');
      if (outcome === 'saved') await say(ctx, TEXT.success);
      else await sayAlreadyRegistered(ctx);
    } catch (err) {
      logger.error({ userHash, err: describeError(err) }, 'Anketani saqlashda xato');
      backToProgress();
      await say(ctx, TEXT.saveError, kb.retryKeyboard('fin:retry'));
    }
  };

  /** Sessiya holatiga qarab foydalanuvchini to'g'ri joyga qaytaradi. */
  const continueSession = async (ctx: Context, session: UserSession): Promise<void> => {
    if (session.status === 'completed') {
      await sayAlreadyRegistered(ctx);
      return;
    }
    if (session.status === 'saving') {
      await say(ctx, TEXT.saving);
      return;
    }
    if (allAnswered(session)) {
      await finalize(ctx, session);
      return;
    }
    await say(ctx, TEXT.resume);
    await askQuestion(ctx, session);
  };

  const safe = async (ctx: Context, action: string, fn: () => Promise<void>): Promise<void> => {
    try {
      await fn();
    } catch (err) {
      if (err instanceof AnswerRejected) {
        await say(ctx, TEXT.alreadyAnswered).catch(() => undefined);
        return;
      }
      logger.error({ action, userHash: hashId(ctx.from?.id ?? 0), err: describeError(err) }, 'Amal bajarishda xato');
      await say(ctx, TEXT.tempError).catch(() => undefined);
    }
  };

  /** Foydalanuvchi amali: navbat + xatolarni ushlash. */
  const userAction = (ctx: Context, action: string, fn: (uid: number) => Promise<void>) => {
    const uid = uidOf(ctx);
    return withLock(uid, () => safe(ctx, action, () => fn(uid)));
  };

  // ---- Rassilka (faqat admin): /broadcast -> xabar -> tasdiqlash -> yuborish ----
  type BroadcastDraft =
    | { stage: 'awaiting'; targets?: number[] }
    | {
        stage: 'confirm';
        chatId: number;
        messageId: number;
        recipients: number[];
        /** Ism qo'yiladigan matn (bo'lsa, har kimga alohida matn yuboriladi). */
        template?: string;
        names: Record<string, string>;
      };
  const broadcastDrafts = new Map<number, BroadcastDraft>();
  let broadcastRunning = false;

  const askBroadcast = async (ctx: Context, uid: number, targets?: number[]) => {
    if (broadcastRunning) {
      await say(ctx, TEXT.broadcastBusy);
      return;
    }
    broadcastDrafts.set(uid, targets && targets.length > 0 ? { stage: 'awaiting', targets } : { stage: 'awaiting' });
    await say(ctx, targets && targets.length > 0 ? TEXT.broadcastAskTargeted(targets.length) : TEXT.broadcastAsk);
  };

  const runAdmin = async (ctx: Context, key: string): Promise<void> => {
    if (key === 'broadcast') {
      await askBroadcast(ctx, uidOf(ctx));
      return;
    }
    if (key === 'sheets') {
      try {
        await registry.verify();
        await say(ctx, TEXT.sheetsOk);
      } catch (err) {
        logger.error({ err: describeError(err) }, 'Google Sheets holati tekshiruvi muvaffaqiyatsiz');
        await say(ctx, TEXT.sheetsBad);
      }
      return;
    }
    if (key === 'bot') {
      await say(
        ctx,
        formatBotStatus({
          startedAt,
          now: now(),
          sessions: sessions.activeCount,
          timezone: config.timezone,
          adminCount: config.adminIds.length,
        }),
      );
      return;
    }
    let rows: string[][];
    try {
      rows = await registry.listRows();
    } catch (err) {
      logger.error({ err: describeError(err) }, 'Google Sheets o‘qilmadi (admin)');
      await say(ctx, TEXT.adminSheetsDown);
      return;
    }
    if (key === 'recent') {
      await say(ctx, formatRecent(recentRows(rows, 5)));
      return;
    }
    const stats = computeStats(rows, now(), config.timezone);
    if (key === 'total') await say(ctx, `👥 Jami topshirilgan anketalar: <b>${stats.total}</b>`);
    else if (key === 'today') await say(ctx, `📅 Bugun topshirilgan anketalar: <b>${stats.today}</b>`);
    else await say(ctx, formatStats(stats, config.googleSheetName));
  };

  if (deps.detachUpdates) {
    bot.use((ctx, next) => {
      void next().catch((err: unknown) => {
        logger.error({ err: describeError(err), userHash: hashId(ctx.from?.id ?? 0) }, 'Kutilmagan xato');
        ctx.reply(TEXT.tempError).catch(() => undefined);
      });
    });
  }

  // ---- Umumiy filtr: guruhlar, spam va juda uzun xabarlar ----
  bot.use(async (ctx, next) => {
    if (ctx.chat && ctx.chat.type !== 'private') return;
    const uid = ctx.from?.id;
    if (uid !== undefined && !allowUpdate(uid)) {
      if (ctx.callbackQuery) await ack(ctx);
      return;
    }
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    if (text.length > MAX_MESSAGE_CHARS) {
      await say(ctx, TEXT.tooLong);
      return;
    }
    return next();
  });

  // Admin rassilka xabarini yuborayotgan bo'lsa, xabar anketa oqimiga emas, rassilkaga tushadi
  bot.use(async (ctx, next) => {
    const uid = ctx.from?.id;
    const message = ctx.message;
    const draft = uid === undefined ? undefined : broadcastDrafts.get(uid);
    if (uid === undefined || !message || !isAdmin(uid) || draft?.stage !== 'awaiting') return next();
    if ('text' in message && message.text.trim().startsWith('/')) return next();
    let rows: string[][];
    try {
      rows = await registry.listRows();
    } catch (err) {
      logger.error({ err: describeError(err) }, 'Rassilka uchun Google Sheets o‘qilmadi');
      await say(ctx, TEXT.adminSheetsDown);
      return;
    }
    const registered = recipientsFromRows(rows);
    // Ro'yxat berilgan bo'lsa, faqat anketa topshirganlar orasidan shu ID'larga yuboriladi
    const known = new Set(registered);
    const recipients = draft.targets ? draft.targets.filter((id) => known.has(id)) : registered;
    const missing = draft.targets ? draft.targets.length - recipients.length : 0;
    if (recipients.length === 0) {
      broadcastDrafts.delete(uid);
      await say(ctx, TEXT.broadcastNoRecipients);
      return;
    }
    const nameMap = namesFromRows(rows);
    const names: Record<string, string> = {};
    for (const id of recipients) names[id] = nameMap.get(id) ?? '';
    const template = 'text' in message && hasNamePlaceholder(message.text) ? message.text : undefined;
    broadcastDrafts.set(uid, { stage: 'confirm', chatId: message.chat.id, messageId: message.message_id, recipients, template, names });
    if (template) {
      const first = recipients[0] as number;
      // Namuna: birinchi talabaga qanday ko'rinishi (HTML'siz, oddiy matn)
      await ctx.reply(personalize(template, names[first] || 'Talaba'));
    }
    await say(ctx, TEXT.broadcastPreview(recipients.length, missing, Boolean(template)), kb.broadcastConfirmKeyboard);
  });

  bot.catch((err, ctx) => {
    logger.error({ err: describeError(err), userHash: hashId(ctx.from?.id ?? 0) }, 'Kutilmagan xato');
    ctx.reply(TEXT.tempError).catch(() => undefined);
  });

  // ---- Buyruqlar ----
  bot.start((ctx) =>
    userAction(ctx, 'start', async (uid) => {
      const session = sessions.get(uid);
      if (session && session.status !== 'awaiting_subscription') {
        await continueSession(ctx, session);
        return;
      }
      if (await registeredInSheets(uid)) {
        await sayAlreadyRegistered(ctx);
        return;
      }
      sessions.save(session ?? newSession(uid, ctx.from.username ?? '', now().getTime()));
      await say(ctx, TEXT.welcome, kb.subscribeKeyboard(config.channels));
    }),
  );

  bot.command('cancel', (ctx) => {
    if (broadcastDrafts.delete(ctx.from.id)) return say(ctx, TEXT.broadcastCancelled).then(() => undefined);
    return userAction(ctx, 'cancel', async () => void (await say(ctx, TEXT.noCancel)));
  });

  bot.command('broadcast', (ctx) =>
    safe(ctx, 'broadcast', async () => {
      if (!isAdmin(uidOf(ctx))) {
        await say(ctx, TEXT.unknownCommand);
        return;
      }
      // /broadcast 8289758059 6593843272 ... — faqat shu talabalarga
      await askBroadcast(ctx, uidOf(ctx), parseIdList(ctx.message.text.replace(/^\/broadcast(@\w+)?/, '')));
    }),
  );

  bot.command('help', (ctx) => userAction(ctx, 'help', async () => void (await say(ctx, TEXT.help))));

  bot.command('admin', (ctx) =>
    safe(ctx, 'admin', async () => {
      if (!isAdmin(uidOf(ctx))) {
        await say(ctx, TEXT.unknownCommand);
        return;
      }
      await say(ctx, TEXT.adminMenu, kb.adminKeyboard);
    }),
  );

  bot.command('stats', (ctx) =>
    safe(ctx, 'stats', async () => {
      if (!isAdmin(uidOf(ctx))) {
        await say(ctx, TEXT.unknownCommand);
        return;
      }
      await runAdmin(ctx, 'stats');
    }),
  );

  // ---- Matnli javoblar ----
  bot.on('text', (ctx) =>
    userAction(ctx, 'text', async (uid) => {
      const text = ctx.message.text;
      if (text.trim().startsWith('/')) {
        await say(ctx, TEXT.unknownCommand);
        return;
      }
      const session = sessions.get(uid);
      const q = session ? currentQuestion(session) : null;
      if (!session || !q) {
        if (session?.status === 'completed') await sayAlreadyRegistered(ctx);
        else if (session?.status === 'saving') await say(ctx, TEXT.saving);
        else if (session?.status === 'awaiting_subscription') await say(ctx, TEXT.subscribeHint, kb.subscribeKeyboard(config.channels));
        else if (session && allAnswered(session)) await finalize(ctx, session);
        else await say(ctx, TEXT.startHint);
        return;
      }
      const { pending } = session;

      const reject = async (error: string) => {
        await say(ctx, `⚠️ ${escapeHtml(error)}`);
      };

      if (pending.awaiting === 'other_note') {
        const note = validateNote(text);
        const optionId = pending.selection[0];
        if (!note.ok) return reject(note.error);
        if (!optionId) throw new Error("Tanlangan variant yo'q");
        await commit(ctx, session, q, { kind: 'choice', optionId, note: note.value });
        return;
      }
      if (pending.awaiting === 'portfolio_url') {
        const url = validatePortfolioUrl(text);
        if (!url.ok) return reject(url.error);
        await commit(ctx, session, q, { kind: 'portfolio', hasPortfolio: true, url: url.value });
        return;
      }
      if (pending.awaiting === 'phone_confirm') {
        await say(ctx, TEXT.useConfirmButton);
        return;
      }

      switch (q.kind) {
        case 'full_name': {
          const r = validateFullName(text);
          if (!r.ok) return reject(r.error);
          await commit(ctx, session, q, { kind: 'text', value: r.value });
          return;
        }
        case 'phone_manual': {
          const r = normalizePhone(text);
          if (!r.ok) return reject(r.error);
          await commit(ctx, session, q, { kind: 'text', value: r.value });
          return;
        }
        case 'text': {
          const r = validateLongText(text, q.min, q.max);
          if (!r.ok) return reject(r.error);
          await commit(ctx, session, q, { kind: 'text', value: r.value });
          return;
        }
        case 'phone_contact':
          await say(ctx, TEXT.useContactButton, kb.contactKeyboard);
          return;
        default:
          await say(ctx, TEXT.useButtons);
      }
    }),
  );

  // ---- Telefon kontakti ----
  bot.on('contact', (ctx) =>
    userAction(ctx, 'contact', async (uid) => {
      const session = sessions.get(uid);
      const q = session ? currentQuestion(session) : null;
      if (!session || q?.kind !== 'phone_contact') {
        await say(ctx, TEXT.contactNotExpected);
        return;
      }
      const contact = ctx.message.contact;
      const result = contactPhone(contact.phone_number, contact.user_id, uid);
      if (!result.ok) {
        // Javob qabul qilinmagan — qayta yuborish mumkin
        await say(ctx, `⚠️ ${escapeHtml(result.error)}`, kb.contactKeyboard);
        return;
      }
      const manual = session.answers.phone;
      if (manual?.kind === 'text' && manual.value === result.value) {
        await commit(ctx, session, q, { kind: 'contact', phone: result.value, matchesManual: true });
        return;
      }
      // Raqamlar farq qiladi: davom etishdan oldin foydalanuvchi tasdiqlaydi
      const waiting: UserSession = { ...session, pending: { selection: [], awaiting: 'phone_confirm', contactPhone: result.value } };
      sessions.save(waiting);
      await askQuestion(ctx, waiting);
    }),
  );

  // ---- Matn va kontaktdan boshqa xabar turlari (rasm, stiker, ovoz va h.k.) ----
  bot.on('message', (ctx) => userAction(ctx, 'unsupported', async () => void (await say(ctx, TEXT.unsupported))));

  // ---- Inline tugmalar ----
  bot.action('sub:check', async (ctx) => {
    void ack(ctx);
    await userAction(ctx, 'sub:check', async (uid) => {
      const session = sessions.get(uid);
      if (session && session.status !== 'awaiting_subscription') {
        if (session.status === 'completed' || session.status === 'saving' || (await gate(ctx, uid))) {
          await continueSession(ctx, session);
        }
        return;
      }
      if (!(await gate(ctx, uid))) return;
      if (await registeredInSheets(uid)) {
        await sayAlreadyRegistered(ctx);
        return;
      }
      sessions.save(session ?? newSession(uid, ctx.from?.username ?? '', now().getTime()));
      await say(ctx, TEXT.verified, kb.startKeyboard);
    });
  });

  bot.action('reg:start', async (ctx) => {
    void ack(ctx);
    await userAction(ctx, 'reg:start', async (uid) => {
      const session = sessions.get(uid);
      if (session && session.status !== 'awaiting_subscription') {
        await continueSession(ctx, session);
        return;
      }
      if (!(await gate(ctx, uid))) return;
      if (await registeredInSheets(uid)) {
        await sayAlreadyRegistered(ctx);
        return;
      }
      const started: UserSession = {
        ...(session ?? newSession(uid, ctx.from?.username ?? '', now().getTime())),
        status: 'in_progress',
        currentQuestionIndex: 0,
      };
      sessions.save(started);
      logger.info({ userHash: hashId(uid) }, 'Anketa boshlandi');
      await askQuestion(ctx, started);
    });
  });

  /** Tugma joriy savolga tegishli va tanlov hali tugallanmaganmi. */
  const activeChoice = (session: UserSession | undefined, index: number) => {
    const q = session ? currentQuestion(session) : null;
    if (!session || !q || session.currentQuestionIndex !== index || optionsOf(q).length === 0) return null;
    if (session.pending.awaiting) return null;
    return { session, q };
  };

  /** Anketa tugmasi bosildi, lekin sessiya yo'q (masalan, server diski tozalangan) — /start ga yo'naltiramiz. */
  const reportLostSession = async (ctx: Context, uid: number): Promise<boolean> => {
    if (sessions.get(uid)) return false;
    await ack(ctx);
    await say(ctx, TEXT.sessionLost);
    return true;
  };

  // Variantni tanlash yoki belgilash
  bot.action(/^a:(\d{1,2}):(\d{1,2})$/, async (ctx) => {
    const index = Number(ctx.match[1]);
    const optionIndex = Number(ctx.match[2]);
    await userAction(ctx, 'select', async (uid) => {
      if (await reportLostSession(ctx, uid)) return;
      const active = activeChoice(sessions.get(uid), index);
      const option = active ? optionsOf(active.q)[optionIndex] : undefined;
      if (!active || !option) {
        await ack(ctx, index < (sessions.get(uid)?.currentQuestionIndex ?? 0) ? TEXT.alreadyAnswered : TEXT.stale);
        return;
      }
      const { session, q } = active;
      const selection = q.kind === 'multi' ? toggleSelection(q, session.pending.selection, option.id) : [option.id];
      sessions.save({ ...session, pending: { selection } });
      await ack(ctx);
      await editMarkup(ctx, kb.choiceKeyboard(index, q, selection));
    });
  });

  // "➡️ Keyingi"
  bot.action(/^n:(\d{1,2})$/, async (ctx) => {
    const index = Number(ctx.match[1]);
    await userAction(ctx, 'next', async (uid) => {
      if (await reportLostSession(ctx, uid)) return;
      const active = activeChoice(sessions.get(uid), index);
      if (!active) {
        await ack(ctx, index < (sessions.get(uid)?.currentQuestionIndex ?? 0) ? TEXT.alreadyAnswered : TEXT.stale);
        return;
      }
      const { session, q } = active;
      const selection = session.pending.selection;
      const check = validateSelection(q, selection);
      if (!check.ok) {
        await ack(ctx, check.error);
        return;
      }
      await ack(ctx);
      const optionId = selection[0] as string;
      const option = optionsOf(q).find((o) => o.id === optionId);

      if (q.kind === 'portfolio' && optionId === 'link') {
        const waiting: UserSession = { ...session, pending: { selection, awaiting: 'portfolio_url' } };
        sessions.save(waiting);
        await editMarkup(ctx, kb.emptyInline);
        await askQuestion(ctx, waiting);
        return;
      }
      if (q.kind === 'single' && option?.other) {
        const waiting: UserSession = { ...session, pending: { selection, awaiting: 'other_note' } };
        sessions.save(waiting);
        await editMarkup(ctx, kb.emptyInline);
        await askQuestion(ctx, waiting);
        return;
      }

      let answer: Answer;
      if (q.kind === 'multi') answer = { kind: 'multi', optionIds: [...selection] };
      else if (q.kind === 'portfolio') answer = { kind: 'portfolio', hasPortfolio: false };
      else answer = { kind: 'choice', optionId };
      await commit(ctx, session, q, answer);
      await editMarkup(ctx, kb.emptyInline);
    });
  });

  // Telefon raqamlari farqini tasdiqlash
  bot.action(/^pc:(\d{1,2}):y$/, async (ctx) => {
    const index = Number(ctx.match[1]);
    await userAction(ctx, 'phone_confirm', async (uid) => {
      if (await reportLostSession(ctx, uid)) return;
      const session = sessions.get(uid);
      const q = session ? currentQuestion(session) : null;
      const phone = session?.pending.contactPhone;
      if (!session || q?.kind !== 'phone_contact' || session.currentQuestionIndex !== index || session.pending.awaiting !== 'phone_confirm' || !phone) {
        await ack(ctx, TEXT.stale);
        return;
      }
      await ack(ctx);
      await commit(ctx, session, q, { kind: 'contact', phone, matchesManual: false });
      await editMarkup(ctx, kb.emptyInline);
    });
  });

  bot.action('fin:retry', async (ctx) => {
    void ack(ctx);
    await userAction(ctx, 'fin:retry', async (uid) => {
      const session = sessions.get(uid);
      if (!session) {
        await say(ctx, TEXT.startHint);
        return;
      }
      if (session.status === 'in_progress' && !allAnswered(session)) {
        await continueSession(ctx, session);
        return;
      }
      await finalize(ctx, session);
    });
  });

  // ---- Admin tugmalari ----
  bot.action(/^admin:(stats|total|today|recent|sheets|bot|broadcast)$/, async (ctx) => {
    await ack(ctx);
    const uid = uidOf(ctx);
    if (!isAdmin(uid)) return;
    await safe(ctx, 'admin', () => runAdmin(ctx, ctx.match[1] as string));
  });

  bot.action('bc:cancel', async (ctx) => {
    await ack(ctx);
    const uid = uidOf(ctx);
    if (!isAdmin(uid)) return;
    broadcastDrafts.delete(uid);
    await editMarkup(ctx, kb.emptyInline);
    await say(ctx, TEXT.broadcastCancelled);
  });

  bot.action('bc:send', async (ctx) => {
    const uid = uidOf(ctx);
    const draft = broadcastDrafts.get(uid);
    if (!isAdmin(uid) || draft?.stage !== 'confirm') {
      await ack(ctx, TEXT.stale);
      return;
    }
    if (broadcastRunning) {
      await ack(ctx, TEXT.broadcastBusy);
      return;
    }
    await ack(ctx);
    broadcastDrafts.delete(uid);
    broadcastRunning = true;
    try {
      await editMarkup(ctx, kb.emptyInline);
      const { recipients, template, names } = draft;
      await say(ctx, TEXT.broadcastStarted(recipients.length));
      logger.info({ recipients: recipients.length, personalized: Boolean(template) }, 'Rassilka boshlandi');
      const stats = await sendBroadcast(
        recipients,
        (userId) =>
          template
            ? ctx.telegram.sendMessage(userId, personalize(template, names[userId] || 'Talaba'))
            : ctx.telegram.copyMessage(userId, draft.chatId, draft.messageId),
        { delayMs: deps.broadcastDelayMs ?? 50 },
      );
      logger.info(stats, 'Rassilka yakunlandi');
      await say(ctx, TEXT.broadcastReport(stats));
    } catch (err) {
      logger.error({ err: describeError(err) }, 'Rassilka xatosi');
      await say(ctx, TEXT.tempError).catch(() => undefined);
    } finally {
      broadcastRunning = false;
    }
  });

  // ---- Eski yoki noma'lum tugmalar (masalan, avvalgi versiyadagi "Orqaga") hech narsa qilmaydi ----
  bot.on('callback_query', (ctx) => ack(ctx, TEXT.stale));

  return bot;
}
