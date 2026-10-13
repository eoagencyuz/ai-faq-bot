import { randomBytes } from 'node:crypto';
import { Telegraf, type Context } from 'telegraf';
import type { Config, FieldKey } from '../types/index.js';
import type { SessionStore } from '../services/session.js';
import type { Draft } from '../services/registration.js';
import type { RegistrationRegistry } from '../services/registry.js';
import { computeStats, recentRows } from '../services/registry.js';
import { checkSubscriptions, type MemberFetcher, type SubscriptionReport } from '../services/subscription.js';
import * as flow from '../services/registration.js';
import { contactPhone } from '../validators/registration.js';
import { createRateLimiter } from '../middleware/rate-limit.js';
import { describeError, hashId, type Logger } from '../utils/logger.js';
import { dateOf, formatLocal } from '../utils/time.js';
import { BTN, FIELD_PROMPTS, TEXT, escapeHtml, summaryText } from './texts.js';
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
}

const MAX_MESSAGE_CHARS = 1000;
const RATE_LIMIT = { limit: 20, windowMs: 10_000 };

function newRegistrationId(date: Date): string {
  return `REG-${date.getTime().toString(36).toUpperCase()}-${randomBytes(3).toString('hex').toUpperCase()}`;
}

export function createBot(deps: BotDeps): Telegraf {
  const { config, sessions, registry, fetchMember, logger, startedAt } = deps;
  const now = deps.now ?? (() => new Date());
  const bot = new Telegraf(config.botToken, { handlerTimeout: 20_000 });
  const allowUpdate = createRateLimiter(RATE_LIMIT.limit, RATE_LIMIT.windowMs);

  const uidOf = (ctx: Context): number => {
    const id = ctx.from?.id;
    if (id === undefined) throw new Error('Update tarkibida foydalanuvchi yo\'q');
    return id;
  };
  const isAdmin = (uid: number) => config.adminIds.includes(uid);
  const validationCtx = () => ({ todayIso: dateOf(formatLocal(now(), config.timezone)), regions: config.regions });

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

  const ack = (ctx: Context) => ctx.answerCbQuery().catch(() => undefined);

  const verify = (uid: number): Promise<SubscriptionReport> =>
    checkSubscriptions(config.channels, uid, fetchMember, (channel, err) =>
      logger.warn({ channel: channel.key, err: describeError(err) }, 'Obuna tekshiruvi xatosi'),
    );

  /** Obuna tasdiqlanmagan bo'lsa, tegishli xabarni yuboradi va false qaytaradi. */
  const gate = async (ctx: Context, uid: number): Promise<boolean> => {
    const report = await verify(uid);
    if (report.subscribed) return true;
    sessions.setStage(uid, 'subscribe', sessions.get(uid)?.draft ?? null);
    logger.info({ userHash: hashId(uid), missing: report.missing.length, failed: report.failed.length }, 'Obuna talab qilindi');
    if (report.missing.length > 0) {
      await say(ctx, TEXT.missing(report.missing.map((c) => c.name)), kb.subscribeKeyboard(config.channels));
    } else {
      await say(ctx, TEXT.subscriptionError, kb.retryKeyboard('sub:check'));
    }
    return false;
  };

  const askStep = async (ctx: Context, uid: number, draft: Draft): Promise<void> => {
    const field = draft.step as FieldKey;
    sessions.setStage(uid, 'filling', draft);
    const n = config.fields.indexOf(field) + 1;
    const header = `<b>${n}/${config.fields.length}</b>. ${FIELD_PROMPTS[field]}`;
    const canBack = draft.history.length > 0 || draft.editing;

    if (field === 'phone') {
      await say(ctx, header, kb.phoneReplyKeyboard);
      return;
    }
    if (field === 'gender') {
      await say(ctx, header, kb.genderKeyboard(canBack));
      return;
    }
    if (field === 'region' && config.regions) {
      await say(ctx, header, kb.regionKeyboard(Object.keys(config.regions), canBack));
      return;
    }
    if (field === 'district' && draft.data.region && config.regions) {
      const list = Object.prototype.hasOwnProperty.call(config.regions, draft.data.region)
        ? config.regions[draft.data.region]
        : undefined;
      if (list && list.length > 0) {
        await say(ctx, header, kb.districtKeyboard(list, canBack));
        return;
      }
    }
    if (field === 'additional_info') {
      await say(ctx, header, kb.skipKeyboard(canBack));
      return;
    }
    await say(ctx, header, kb.navKeyboard(canBack));
  };

  const showConfirm = async (ctx: Context, uid: number, draft: Draft): Promise<void> => {
    const confirmed: Draft = { ...draft, step: 'confirm', editing: false };
    sessions.setStage(uid, 'confirm', confirmed);
    await say(
      ctx,
      `${TEXT.confirmHeader}\n\n${summaryText(confirmed, config.fields)}\n\n${TEXT.confirmQuestion}`,
      kb.confirmKeyboard,
    );
  };

  const resume = (ctx: Context, uid: number, draft: Draft): Promise<void> =>
    draft.step === 'confirm' ? showConfirm(ctx, uid, draft) : askStep(ctx, uid, draft);

  const afterVerified = async (ctx: Context, uid: number): Promise<void> => {
    const session = sessions.get(uid);
    if (session?.stage === 'done') {
      await say(ctx, TEXT.alreadyRegistered);
      return;
    }
    if (session?.draft) {
      await resume(ctx, uid, session.draft);
      return;
    }
    sessions.setStage(uid, 'verified');
    await say(ctx, TEXT.verified, kb.regKeyboard);
  };

  const startRegistration = async (ctx: Context, uid: number): Promise<void> => {
    if (await registry.isRegistered(uid)) {
      sessions.setStage(uid, 'done');
      await say(ctx, TEXT.alreadyRegistered);
      return;
    }
    logger.info({ userHash: hashId(uid) }, "Ro'yxatdan o'tish boshlandi");
    await askStep(ctx, uid, flow.createDraft(config.fields));
  };

  const answerValue = async (ctx: Context, uid: number, draft: Draft, raw: string): Promise<void> => {
    const field = draft.step as FieldKey;
    const result = flow.validateValue(field, raw, { ...validationCtx(), region: draft.data.region });
    if (!result.ok) {
      await say(ctx, `⚠️ ${escapeHtml(result.error)}`);
      await askStep(ctx, uid, draft);
      return;
    }
    if (field === 'phone') await say(ctx, TEXT.phoneSaved, kb.removeKeyboard);
    const next = flow.answer(draft, config.fields, result.value);
    if (next.step === 'confirm') await showConfirm(ctx, uid, next);
    else await askStep(ctx, uid, next);
  };

  const onBack = async (ctx: Context, uid: number): Promise<void> => {
    const session = sessions.get(uid);
    if (!session?.draft) {
      await say(ctx, TEXT.stale);
      return;
    }
    const prev = flow.goBack(session.draft);
    if (!prev) {
      await say(ctx, TEXT.noBack);
      return;
    }
    if (session.draft.step === 'phone') await say(ctx, TEXT.backFromPhone, kb.removeKeyboard);
    if (prev.step === 'confirm') await showConfirm(ctx, uid, prev);
    else await askStep(ctx, uid, prev);
  };

  const onCancel = async (ctx: Context, uid: number): Promise<void> => {
    sessions.clear(uid);
    await say(ctx, TEXT.cancelled, kb.removeKeyboard);
  };

  const safe = async (ctx: Context, action: string, fn: () => Promise<void>): Promise<void> => {
    try {
      await fn();
    } catch (err) {
      logger.error({ action, userHash: hashId(ctx.from?.id ?? 0), err: describeError(err) }, 'Amal bajarishda xato');
      await say(ctx, TEXT.tempError).catch(() => undefined);
    }
  };

  const runAdmin = async (ctx: Context, key: string): Promise<void> => {
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
          sessions: sessions.size,
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
    if (key === 'total') await say(ctx, `👥 Jami ro'yxatdan o'tganlar: <b>${stats.total}</b>`);
    else if (key === 'today') await say(ctx, `📅 Bugun ro'yxatdan o'tganlar: <b>${stats.today}</b>`);
    else await say(ctx, formatStats(stats, config.googleSheetName));
  };

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

  bot.catch((err, ctx) => {
    logger.error({ err: describeError(err), userHash: hashId(ctx.from?.id ?? 0) }, 'Kutilmagan xato');
    ctx.reply(TEXT.tempError).catch(() => undefined);
  });

  // ---- Buyruqlar ----
  bot.start((ctx) =>
    safe(ctx, 'start', async () => {
      const uid = uidOf(ctx);
      const session = sessions.get(uid);
      if (session?.stage === 'done') {
        await say(ctx, TEXT.alreadyRegistered);
        return;
      }
      if (session?.draft) {
        await say(ctx, TEXT.resume, kb.resumeKeyboard);
        return;
      }
      sessions.clear(uid);
      await say(ctx, TEXT.welcome, kb.subscribeKeyboard(config.channels));
    }),
  );

  bot.command('cancel', (ctx) => safe(ctx, 'cancel', () => onCancel(ctx, uidOf(ctx))));

  bot.command('help', (ctx) =>
    safe(ctx, 'help', async () => {
      await say(ctx, TEXT.help);
    }),
  );

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

  // ---- Matnli xabarlar ----
  bot.on('text', (ctx) =>
    safe(ctx, 'text', async () => {
      const uid = uidOf(ctx);
      const text = ctx.message.text.trim();
      if (text === BTN.back) return onBack(ctx, uid);
      if (text === BTN.cancel) return onCancel(ctx, uid);
      if (text.startsWith('/')) {
        await say(ctx, TEXT.unknownCommand);
        return;
      }
      const session = sessions.get(uid);
      if (session?.stage === 'filling' && session.draft && session.draft.step !== 'confirm') {
        if (session.draft.step === 'gender') {
          await say(ctx, TEXT.useButtons);
          await askStep(ctx, uid, session.draft);
          return;
        }
        return answerValue(ctx, uid, session.draft, text);
      }
      switch (session?.stage) {
        case 'confirm':
        case 'submitting':
          await say(ctx, TEXT.useButtons);
          return;
        case 'subscribe':
          await say(ctx, TEXT.subscribeHint, kb.subscribeKeyboard(config.channels));
          return;
        case 'done':
          await say(ctx, TEXT.alreadyRegistered);
          return;
        default:
          await say(ctx, TEXT.startHint);
      }
    }),
  );

  // ---- Telefon kontakti ----
  bot.on('contact', (ctx) =>
    safe(ctx, 'contact', async () => {
      const uid = uidOf(ctx);
      const session = sessions.get(uid);
      const draft = session?.stage === 'filling' ? session.draft : null;
      if (!draft || draft.step !== 'phone') {
        await say(ctx, TEXT.contactNotExpected);
        return;
      }
      const contact = ctx.message.contact;
      const result = contactPhone(contact.phone_number, contact.user_id, uid);
      if (!result.ok) {
        await say(ctx, `⚠️ ${escapeHtml(result.error)}`);
        await askStep(ctx, uid, draft);
        return;
      }
      await answerValue(ctx, uid, draft, result.value);
    }),
  );

  // ---- Matn, kontakt va tugmadan boshqa xabar turlari (rasm, stiker, ovoz va h.k.) ----
  bot.on('message', (ctx) =>
    safe(ctx, 'unsupported', async () => {
      await say(ctx, TEXT.textOnly);
    }),
  );

  // ---- Inline tugmalar ----
  bot.action('sub:check', async (ctx) => {
    await ack(ctx);
    await safe(ctx, 'sub:check', async () => {
      const uid = uidOf(ctx);
      if (await gate(ctx, uid)) await afterVerified(ctx, uid);
    });
  });

  bot.action('reg:start', async (ctx) => {
    await ack(ctx);
    await safe(ctx, 'reg:start', async () => {
      const uid = uidOf(ctx);
      if (await gate(ctx, uid)) await startRegistration(ctx, uid);
    });
  });

  bot.action('resume:go', async (ctx) => {
    await ack(ctx);
    await safe(ctx, 'resume', async () => {
      const uid = uidOf(ctx);
      const draft = sessions.get(uid)?.draft;
      if (!draft) {
        await say(ctx, TEXT.startHint);
        return;
      }
      if (await gate(ctx, uid)) await resume(ctx, uid, draft);
    });
  });

  bot.action('resume:restart', async (ctx) => {
    await ack(ctx);
    await safe(ctx, 'restart', async () => {
      sessions.clear(uidOf(ctx));
      await say(ctx, TEXT.welcome, kb.subscribeKeyboard(config.channels));
    });
  });

  bot.action('flow:back', async (ctx) => {
    await ack(ctx);
    await safe(ctx, 'flow:back', () => onBack(ctx, uidOf(ctx)));
  });

  bot.action('flow:cancel', async (ctx) => {
    await ack(ctx);
    await safe(ctx, 'flow:cancel', () => onCancel(ctx, uidOf(ctx)));
  });

  const answerIfStep = (field: FieldKey) => async (ctx: Context, uid: number, raw: string) => {
    const session = sessions.get(uid);
    if (session?.stage !== 'filling' || !session.draft || session.draft.step !== field) {
      await say(ctx, TEXT.stale);
      return;
    }
    await answerValue(ctx, uid, session.draft, raw);
  };

  bot.action(/^gender:(male|female|skip)$/, async (ctx) => {
    await ack(ctx);
    await safe(ctx, 'gender', () => answerIfStep('gender')(ctx, uidOf(ctx), ctx.match[1]));
  });

  bot.action(/^region:(\d+)$/, async (ctx) => {
    await ack(ctx);
    await safe(ctx, 'region', async () => {
      const names = config.regions ? Object.keys(config.regions) : [];
      const name = names[Number(ctx.match[1])];
      if (name === undefined) {
        await say(ctx, TEXT.stale);
        return;
      }
      await answerIfStep('region')(ctx, uidOf(ctx), name);
    });
  });

  bot.action(/^district:(\d+)$/, async (ctx) => {
    await ack(ctx);
    await safe(ctx, 'district', async () => {
      const uid = uidOf(ctx);
      const region = sessions.get(uid)?.draft?.data.region;
      const list = config.regions && region && Object.prototype.hasOwnProperty.call(config.regions, region)
        ? config.regions[region]
        : undefined;
      const name = list?.[Number(ctx.match[1])];
      if (name === undefined) {
        await say(ctx, TEXT.stale);
        return;
      }
      await answerIfStep('district')(ctx, uid, name);
    });
  });

  bot.action('skip:additional_info', async (ctx) => {
    await ack(ctx);
    await safe(ctx, 'skip', () => answerIfStep('additional_info')(ctx, uidOf(ctx), ''));
  });

  bot.action('confirm:edit', async (ctx) => {
    await ack(ctx);
    await safe(ctx, 'confirm:edit', async () => {
      const session = sessions.get(uidOf(ctx));
      if (session?.stage !== 'confirm') {
        await say(ctx, TEXT.stale);
        return;
      }
      await say(ctx, TEXT.editMenu, kb.editKeyboard(config.fields));
    });
  });

  bot.action('confirm:back', async (ctx) => {
    await ack(ctx);
    await safe(ctx, 'confirm:back', async () => {
      const uid = uidOf(ctx);
      const draft = sessions.get(uid)?.draft;
      if (!draft) {
        await say(ctx, TEXT.stale);
        return;
      }
      await showConfirm(ctx, uid, draft);
    });
  });

  bot.action(/^edit:(\w+)$/, async (ctx) => {
    await ack(ctx);
    await safe(ctx, 'edit', async () => {
      const uid = uidOf(ctx);
      const session = sessions.get(uid);
      const field = ctx.match[1] as FieldKey;
      const draft = session?.stage === 'confirm' ? session.draft : null;
      if (!draft || !config.fields.includes(field)) {
        await say(ctx, TEXT.stale);
        return;
      }
      await askStep(ctx, uid, flow.startEdit(draft, field));
    });
  });

  bot.action('confirm:yes', async (ctx) => {
    await ack(ctx);
    const uid = uidOf(ctx);
    const session = sessions.get(uid);
    if (session?.stage === 'done') {
      await say(ctx, TEXT.alreadyRegistered);
      return;
    }
    // Ikki marta bosilsa, ikkinchi so'rov e'tiborsiz qoldiriladi
    if (session?.stage === 'submitting') return;
    if (!session?.draft || session.draft.step !== 'confirm') {
      await say(ctx, TEXT.stale);
      return;
    }
    const draft = session.draft;
    const userHash = hashId(uid);
    sessions.setStage(uid, 'submitting', draft);
    try {
      const invalid = flow.findInvalidField(draft, config.fields, validationCtx());
      if (invalid) {
        await say(ctx, TEXT.dataChanged);
        const fixed: Draft = {
          ...draft,
          step: invalid,
          history: config.fields.slice(0, config.fields.indexOf(invalid)),
          editing: false,
        };
        await askStep(ctx, uid, fixed);
        return;
      }
      const report = await verify(uid);
      if (!report.subscribed) {
        sessions.setStage(uid, 'subscribe', draft);
        if (report.missing.length > 0) {
          await say(ctx, TEXT.missing(report.missing.map((c) => c.name)), kb.subscribeKeyboard(config.channels));
        } else {
          await say(ctx, TEXT.subscriptionError, kb.retryKeyboard('sub:check'));
        }
        return;
      }
      const record = flow.buildRecord(draft, {
        id: newRegistrationId(now()),
        createdAt: now(),
        userId: uid,
        username: ctx.from?.username ?? '',
        subscriptionVerified: true,
      });
      const outcome = await registry.save(record);
      sessions.setStage(uid, 'done');
      logger.info({ userHash, outcome }, "Ro'yxatdan o'tish yakunlandi");
      await say(ctx, outcome === 'saved' ? TEXT.success : TEXT.alreadyRegistered);
    } catch (err) {
      logger.error({ userHash, err: describeError(err) }, "Ro'yxatga yozishda xato");
      sessions.setStage(uid, 'confirm', draft);
      await say(ctx, TEXT.saveError, kb.retryKeyboard('confirm:yes'));
    }
  });

  // ---- Admin tugmalari ----
  bot.action(/^admin:(stats|total|today|recent|sheets|bot)$/, async (ctx) => {
    await ack(ctx);
    const uid = uidOf(ctx);
    if (!isAdmin(uid)) return;
    await safe(ctx, 'admin', () => runAdmin(ctx, ctx.match[1]));
  });

  return bot;
}

