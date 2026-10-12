import { describe, expect, it } from 'vitest';
import { checkSubscriptions, interpretStatus } from '../src/services/subscription.js';
import type { ChannelConfig } from '../src/types/index.js';

const ch1: ChannelConfig = { key: 'channel1', id: '@one_kanal', url: 'https://t.me/one_kanal', name: '1-kanal' };
const ch2: ChannelConfig = { key: 'channel2', id: '-1001234567890', url: 'https://t.me/two_kanal', name: '2-kanal' };

describe('interpretStatus', () => {
  it.each([
    [{ status: 'creator' }, 'subscribed'],
    [{ status: 'administrator' }, 'subscribed'],
    [{ status: 'member' }, 'subscribed'],
    [{ status: 'restricted', is_member: true }, 'subscribed'],
    [{ status: 'restricted', is_member: false }, 'not_subscribed'],
    [{ status: 'restricted' }, 'not_subscribed'],
    [{ status: 'left' }, 'not_subscribed'],
    [{ status: 'kicked' }, 'not_subscribed'],
    [{ status: 'weird_status' }, 'error'],
  ])('%j → %s', (lookup, expected) => {
    expect(interpretStatus(lookup)).toBe(expected);
  });
});

describe('checkSubscriptions', () => {
  it('ikkala kanalga obuna bo\'lgan foydalanuvchi', async () => {
    const report = await checkSubscriptions([ch1, ch2], 1, async () => ({ status: 'member' }));
    expect(report.subscribed).toBe(true);
    expect(report.missing).toEqual([]);
  });

  it('faqat birinchi kanalga obuna bo\'lgan — ikkinchisi missing', async () => {
    const report = await checkSubscriptions([ch1, ch2], 1, async (chatId) =>
      chatId === ch1.id ? { status: 'member' } : { status: 'left' },
    );
    expect(report.subscribed).toBe(false);
    expect(report.missing.map((c) => c.key)).toEqual(['channel2']);
  });

  it('faqat ikkinchi kanalga obuna bo\'lgan — birinchisi missing', async () => {
    const report = await checkSubscriptions([ch1, ch2], 1, async (chatId) =>
      chatId === ch2.id ? { status: 'administrator' } : { status: 'kicked' },
    );
    expect(report.missing.map((c) => c.key)).toEqual(['channel1']);
  });

  it('hech biriga obuna bo\'lmagan — ikkalasi missing', async () => {
    const report = await checkSubscriptions([ch1, ch2], 1, async () => ({ status: 'left' }));
    expect(report.missing).toHaveLength(2);
  });

  it('Telegram API xatosi obuna yo\'q deb hisoblanmaydi — failed sifatida qaytadi', async () => {
    const errors: string[] = [];
    const report = await checkSubscriptions(
      [ch1, ch2],
      1,
      async (chatId) => {
        if (chatId === ch2.id) throw new Error('Bad Request: chat not found');
        return { status: 'member' };
      },
      (channel) => errors.push(channel.key),
    );
    expect(report.missing).toEqual([]);
    expect(report.failed.map((c) => c.key)).toEqual(['channel2']);
    expect(report.subscribed).toBe(false);
    expect(errors).toEqual(['channel2']);
  });
});
