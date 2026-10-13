import { COL, type RegistrationStats } from '../services/registry.js';
import { maskPhone } from '../validators/registration.js';
import { escapeHtml } from './texts.js';

export function formatStats(s: RegistrationStats, sheetName: string): string {
  return [
    '📊 <b>Statistika</b>',
    '',
    `👥 Jami topshirilgan anketalar: <b>${s.total}</b>`,
    `📅 Bugun: <b>${s.today}</b>`,
    `🗓 Oxirgi 7 kun: <b>${s.last7}</b>`,
    `🗓 Oxirgi 30 kun: <b>${s.last30}</b>`,
    '',
    `📄 Manba: Google Sheets, varaq: ${escapeHtml(sheetName)}`,
  ].join('\n');
}

/** Ism va yashirilgan telefon ko'rsatiladi (keraksiz shaxsiy ma'lumotsiz). */
export function formatRecent(rows: string[][]): string {
  if (rows.length === 0) return "Hozircha anketalar yo'q.";
  const lines = rows.map((r, i) => {
    const name = (r[COL.FULL_NAME] ?? '').replace(/^'/, '');
    return `${i + 1}. ${escapeHtml(name)} — ${escapeHtml(r[COL.CREATED] ?? '')} — ${escapeHtml(maskPhone(r[COL.PHONE] ?? ''))}`;
  });
  return "🕒 <b>Oxirgi anketalar</b>\n\n" + lines.join('\n');
}

export function formatBotStatus(info: {
  startedAt: Date;
  now: Date;
  sessions: number;
  timezone: string;
  adminCount: number;
}): string {
  const minutes = Math.floor((info.now.getTime() - info.startedAt.getTime()) / 60_000);
  return [
    'ℹ️ <b>Bot holati</b>',
    '',
    `⏱ Ishlash vaqti: ${Math.floor(minutes / 60)} soat ${minutes % 60} daqiqa`,
    `💬 Jarayondagi anketalar: ${info.sessions}`,
    `🕘 Vaqt zonasi: ${escapeHtml(info.timezone)}`,
    `🛠 Adminlar soni: ${info.adminCount}`,
    '🔁 Rejim: polling (bitta instance)',
  ].join('\n');
}
