import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { resolveChannelNames } from '../src/services/channel-names.js';
import type { ChannelConfig } from '../src/types/index.js';

const logger = pino({ level: 'silent' });
const channels = (): ChannelConfig[] => [
  { key: 'channel1', id: '@kiu_uz', url: 'https://t.me/kiu_uz', name: '1-kanal' },
  { key: 'channel2', id: '-1001234567890', url: 'https://t.me/+abc', name: 'Yozilgan nom' },
];

describe('resolveChannelNames', () => {
  it("o'rinbosar nomni Telegram'dagi haqiqiy kanal nomi bilan almashtiradi", async () => {
    const list = channels();
    await resolveChannelNames(list, async () => ({ title: 'Qarshi xalqaro universiteti' }), logger);
    expect(list[0]!.name).toBe('Qarshi xalqaro universiteti');
    expect(list[1]!.name).toBe('Yozilgan nom');
  });

  it("sozlamada yozilgan nomga tegmaydi", async () => {
    const list = channels();
    let calls = 0;
    await resolveChannelNames(list, async () => (calls++, { title: 'Boshqa' }), logger);
    expect(calls).toBe(1);
    expect(list[1]!.name).toBe('Yozilgan nom');
  });

  it("Telegram javob bermasa, ochiq kanal uchun @username ishlatiladi", async () => {
    const list = channels();
    await resolveChannelNames(list, async () => {
      throw new Error('Bad Request: chat not found');
    }, logger);
    expect(list[0]!.name).toBe('@kiu_uz');
  });

  it("yopiq kanal nomi olinmasa, o'rinbosar qoladi", async () => {
    const list = [{ key: 'channel2' as const, id: '-1001234567890', url: 'https://t.me/+abc', name: '2-kanal' }];
    await resolveChannelNames(list, async () => ({}), logger);
    expect(list[0]!.name).toBe('2-kanal');
  });

  it('uzun nomni 40 belgigacha qisqartiradi', async () => {
    const list = [channels()[0]!];
    await resolveChannelNames(list, async () => ({ title: 'a'.repeat(60) }), logger);
    expect(list[0]!.name).toHaveLength(40);
  });
});
