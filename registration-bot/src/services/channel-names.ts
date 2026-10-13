import type { ChannelConfig } from '../types/index.js';
import { describeError, type Logger } from '../utils/logger.js';

/** "1-kanal" kabi standart o'rinbosar: haqiqiy nom Telegram'dan olinadi. */
export const isPlaceholderName = (name: string): boolean => /^\d+-kanal$/.test(name.trim());

/**
 * Kanal nomini Telegram'dan oladi (bot kanalda admin bo'lishi kerak). Nom sozlamada yozilgan bo'lsa, u o'zgarmaydi.
 * Telegram javob bermasa: ochiq kanal uchun @username, qolgan holatda o'rinbosar nom qoladi.
 */
export async function resolveChannelNames(
  channels: ChannelConfig[],
  getChat: (chatId: string) => Promise<{ title?: string }>,
  logger: Logger,
): Promise<void> {
  for (const channel of channels) {
    if (!isPlaceholderName(channel.name)) continue;
    try {
      const title = (await getChat(channel.id)).title?.trim();
      if (title) {
        channel.name = title.slice(0, 40);
        continue;
      }
    } catch (err) {
      logger.warn({ channel: channel.key, err: describeError(err) }, 'Kanal nomini Telegram\'dan olib bo\'lmadi');
    }
    if (channel.id.startsWith('@')) channel.name = channel.id;
  }
}
