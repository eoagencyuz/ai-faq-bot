import type { ChannelConfig } from '../types/index.js';

export type SubscriptionState = 'subscribed' | 'not_subscribed' | 'error';

export interface MemberLookup {
  status: string;
  is_member?: boolean;
}

/** Telegram getChatMember chaqiruvi. Xato bo'lsa, exception otadi. */
export type MemberFetcher = (chatId: string, userId: number) => Promise<MemberLookup>;

export interface ChannelResult {
  channel: ChannelConfig;
  state: SubscriptionState;
}

export interface SubscriptionReport {
  results: ChannelResult[];
  subscribed: boolean;
  missing: ChannelConfig[];
  failed: ChannelConfig[];
}

const ACTIVE_STATUSES = new Set(['creator', 'administrator', 'member']);

export function interpretStatus(lookup: MemberLookup): SubscriptionState {
  if (ACTIVE_STATUSES.has(lookup.status)) return 'subscribed';
  if (lookup.status === 'restricted') return lookup.is_member === true ? 'subscribed' : 'not_subscribed';
  if (lookup.status === 'left' || lookup.status === 'kicked') return 'not_subscribed';
  // Noma'lum holat — obuna yo'q deb hisoblamaymiz, tekshiruv xatosi deb qaraymiz
  return 'error';
}

export async function checkSubscriptions(
  channels: ChannelConfig[],
  userId: number,
  fetchMember: MemberFetcher,
  onError?: (channel: ChannelConfig, err: unknown) => void,
): Promise<SubscriptionReport> {
  const results = await Promise.all(
    channels.map(async (channel): Promise<ChannelResult> => {
      try {
        return { channel, state: interpretStatus(await fetchMember(channel.id, userId)) };
      } catch (err) {
        onError?.(channel, err);
        return { channel, state: 'error' };
      }
    }),
  );
  const missing = results.filter((r) => r.state === 'not_subscribed').map((r) => r.channel);
  const failed = results.filter((r) => r.state === 'error').map((r) => r.channel);
  return { results, subscribed: missing.length === 0 && failed.length === 0, missing, failed };
}
