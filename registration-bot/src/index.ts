import 'dotenv/config';
import path from 'node:path';
import type { Telegraf } from 'telegraf';
import { parseConfig } from './config/env.js';
import { createBot } from './bot/index.js';
import { GoogleSessionSheet, GoogleSheetsAdapter } from './services/google-sheets.js';
import { SessionBackup } from './services/session-backup.js';
import { RegistrationRegistry } from './services/registry.js';
import { SessionStore } from './services/session.js';
import type { MemberFetcher } from './services/subscription.js';
import { startHealthServer, startKeepAlive } from './utils/health.js';
import { acquireInstanceLock } from './utils/instance-lock.js';
import { createLogger, describeError, registerSecrets } from './utils/logger.js';

const fetchMemberVia =
  (bot: () => Telegraf): MemberFetcher =>
  async (chatId, userId) => {
    const member = await bot().telegram.getChatMember(chatId, userId);
    return { status: member.status, is_member: 'is_member' in member ? member.is_member : undefined };
  };

async function main(): Promise<void> {
  let config: ReturnType<typeof parseConfig>;
  try {
    config = parseConfig(process.env);
  } catch (err) {
    // Konfiguratsiya xato bo'lsa, servis ishga tushmaydi. Qiymatlar emas, faqat nomlar chiqadi.
    console.error(`Konfiguratsiya xato — bot ishga tushmadi:\n${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  registerSecrets([config.botToken, config.googlePrivateKey]);
  const logger = createLogger(config.logLevel);

  let release: () => void;
  try {
    release = acquireInstanceLock(path.join(path.dirname(config.sessionFile), 'bot.lock'));
  } catch (err) {
    logger.fatal({ err: describeError(err) }, 'Bot ishga tushmadi');
    process.exit(1);
  }

  const sheetsOptions = {
    spreadsheetId: config.googleSpreadsheetId,
    sheetName: config.googleSheetName,
    email: config.googleServiceAccountEmail,
    privateKey: config.googlePrivateKey,
    logger,
  };
  const sheets = new GoogleSheetsAdapter(sheetsOptions);
  const registry = new RegistrationRegistry(sheets, config.timezone);

  try {
    await registry.verify();
  } catch (err) {
    logger.fatal({ err: describeError(err) }, "Google Sheets'ga ulanib bo'lmadi yoki sarlavhalar mos emas");
    release();
    process.exit(1);
  }

  const sessions = new SessionStore(
    config.sessionFile,
    config.sessionTtlHours * 3_600_000,
    (message) => logger.warn(message),
  );

  // Disk o'chib ketsa (masalan, Render'da qayta deploy), tugallanmagan anketalar Google Sheets'dagi zaxiradan tiklanadi
  const backup = new SessionBackup(new GoogleSessionSheet(sheetsOptions), logger);
  const restoreFromBackup = async (stage: string) => {
    try {
      const restored = sessions.restore(await backup.restore());
      logger.info({ restored, stage }, 'Sessiyalar zaxiradan tekshirildi');
    } catch (err) {
      logger.warn({ err: describeError(err), stage }, "Sessiyalar zaxirasini o'qib bo'lmadi");
    }
  };
  let backupEnabled = false;
  try {
    await backup.verify();
    await restoreFromBackup('startup');
    sessions.onChange = (userId, session) => backup.mark(userId, session);
    backup.start(5_000);
    backupEnabled = true;
  } catch (err) {
    logger.error({ err: describeError(err) }, "Sessiyalar zaxirasi o'chirildi: varaqni sozlab bo'lmadi");
  }
  const flushBackup = async () => {
    if (!backupEnabled) return;
    await Promise.race([backup.stop(), new Promise((resolve) => setTimeout(resolve, 8_000))]);
  };

  let botRef: Telegraf | undefined;
  const bot = createBot({
    config,
    sessions,
    registry,
    logger,
    startedAt: new Date(),
    fetchMember: fetchMemberVia(() => botRef as Telegraf),
  });
  botRef = bot;

  try {
    const me = await bot.telegram.getMe();
    logger.info(
      { bot: me.username, channels: config.channels.map((c) => c.key), admins: config.adminIds.length },
      'Bot ishga tushdi (polling)',
    );
  } catch (err) {
    logger.fatal({ err: describeError(err) }, 'Telegram tokenini tekshirib bo\'lmadi');
    release();
    process.exit(1);
  }

  const purge = setInterval(() => {
    const removed = sessions.purgeExpired();
    if (removed > 0) logger.info({ removed }, 'Muddati o\'tgan sessiyalar tozalandi');
  }, 60 * 60_000);

  void bot.launch({ dropPendingUpdates: true }).catch(async (err: unknown) => {
    logger.fatal({ err: describeError(err) }, 'Polling to\'xtadi');
    await flushBackup();
    release();
    process.exit(1);
  });

  // Deploy paytida eski nusxa o'chishdan oldin oxirgi javoblarni yozib ulguradi — ularni ham olamiz
  if (backupEnabled) setTimeout(() => void restoreFromBackup('after-launch'), 20_000).unref();

  const healthServer = config.port ? startHealthServer(config.port, logger) : undefined;
  const publicUrl = process.env.RENDER_EXTERNAL_URL;
  const keepAlive = healthServer && publicUrl ? startKeepAlive(publicUrl, 10 * 60_000, logger) : undefined;

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "To'xtatilmoqda");
    clearInterval(purge);
    if (keepAlive) clearInterval(keepAlive);
    healthServer?.close();
    bot.stop(signal);
    await flushBackup();
    release();
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err: unknown) => {
  console.error('Kutilmagan xato:', describeError(err));
  process.exit(1);
});
