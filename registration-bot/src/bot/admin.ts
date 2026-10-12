import { COL, type RegistrationStats } from '../services/registry.js';
import { escapeHtml } from './texts.js';

export function formatStats(s: RegistrationStats, sheetName: string): string {
  return [
    '📊 <b>Statistika</b>',
    '',
    `👥 Jami ro'yxatdan o'tganlar: <b>${s.total}</b>`,
    `📅 Bugun: <b>${s.today}</b>`,
    `🗓 Oxirgi 7 kun: <b>${s.last7}</b>`,
    `🗓 Oxirgi 30 kun: <b>${s.last30}</b>`,
    '',
    `📄 Manba: Google Sheets, varaq: ${escapeHtml(sheetName)}`,
  ].join('\n');
}

/** Ism va telefonning faqat oxirgi 4 raqami ko'rsatiladi (keraksiz shaxsiy ma'lumotsiz). */
export function formatRecent(rows: string[][]): string {
  if (rows.length === 0) return "Hozircha ro'yxatdan o'tganlar yo'q.";
  const lines = rows.map((r, i) => {
    const name = `${r[COL.FIRST] ?? ''} ${r[COL.LAST] ?? ''}`.trim();
    const last4 = (r[COL.PHONE] ?? '').slice(-4);
    return `${i + 1}. ${escapeHtml(name)} — ${escapeHtml(r[COL.CREATED] ?? '')} — ***${escapeHtml(last4)}`;
  });
  return "🕒 <b>Oxirgi ro'yxatdan o'tganlar</b>\n\n" + lines.join('\n');
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
    `💬 Faol sessiyalar: ${info.sessions}`,
    `🕘 Vaqt zonasi: ${escapeHtml(info.timezone)}`,
    `🛠 Adminlar soni: ${info.adminCount}`,
    '🔁 Rejim: polling (bitta instance)',
  ].join('\n');
}
