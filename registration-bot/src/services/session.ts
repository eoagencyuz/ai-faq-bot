import fs from 'node:fs';
import path from 'node:path';
import { QUESTIONS, QUESTION_KEYS, autoAnswer, type Answer, type Answers, type Question, type QuestionKey } from './questionnaire.js';

export type SessionStatus = 'awaiting_subscription' | 'in_progress' | 'saving' | 'completed';

export interface PendingState {
  /** Joriy savol uchun tanlangan variant(lar) — "➡️ Keyingi" bosilguncha. */
  selection: string[];
  /** Asosiy javob tanlangandan keyin kutilayotgan qo'shimcha qadam. */
  awaiting?: 'other_note' | 'portfolio_url' | 'phone_confirm';
  /** Telegram kontakti qo'lda kiritilgan raqamdan farq qilsa, tasdiqlashgacha shu yerda turadi. */
  contactPhone?: string;
}

export interface UserSession {
  telegramUserId: number;
  telegramUsername: string;
  status: SessionStatus;
  currentQuestionIndex: number;
  answers: Answers;
  /** Foydalanuvchi o'zi javob bergan savollar. */
  answeredQuestions: QuestionKey[];
  /** Yopilgan savollar: javob berilgan va avtomatik to'ldirilganlar. */
  completedQuestions: QuestionKey[];
  pending: PendingState;
  createdAt: number;
  updatedAt: number;
}

export class AnswerRejected extends Error {}

export function newSession(userId: number, username: string, now: number): UserSession {
  return {
    telegramUserId: userId,
    telegramUsername: username,
    status: 'awaiting_subscription',
    currentQuestionIndex: 0,
    answers: {},
    answeredQuestions: [],
    completedQuestions: [],
    pending: { selection: [] },
    createdAt: now,
    updatedAt: now,
  };
}

export function currentQuestion(session: UserSession): Question | null {
  return session.status === 'in_progress' ? (QUESTIONS[session.currentQuestionIndex] ?? null) : null;
}

export const allAnswered = (session: UserSession): boolean =>
  QUESTIONS.every((q) => session.completedQuestions.includes(q.key) && session.answers[q.key] !== undefined);

/** Joriy savoldan boshlab avtomatik javob beriladigan savollarni yopadi. */
function applyAutoAnswers(session: UserSession): void {
  for (let q = QUESTIONS[session.currentQuestionIndex]; q; q = QUESTIONS[session.currentQuestionIndex]) {
    const auto = autoAnswer(q.key, session.answers);
    if (!auto) return;
    session.answers[q.key] = auto;
    session.completedQuestions.push(q.key);
    session.currentQuestionIndex++;
  }
}

/**
 * Javobni qabul qiladi va keyingi savolga o'tadi. Asl sessiya o'zgarmaydi — yangi nusxa qaytadi,
 * shuning uchun diskka yozish muvaffaqiyatsiz bo'lsa, eski holat saqlanib qoladi.
 * Faqat joriy va hali javob berilmagan savolga javob qabul qilinadi.
 */
export function acceptAnswer(session: UserSession, key: QuestionKey, answer: Answer, now: number): UserSession {
  const q = currentQuestion(session);
  if (!q || q.key !== key) throw new AnswerRejected(`"${key}" joriy savol emas`);
  if (session.completedQuestions.includes(key) || session.answers[key] !== undefined) {
    throw new AnswerRejected(`"${key}" savoliga allaqachon javob berilgan`);
  }
  const next: UserSession = structuredClone(session);
  next.answers[key] = answer;
  next.answeredQuestions.push(key);
  next.completedQuestions.push(key);
  next.currentQuestionIndex++;
  next.pending = { selection: [] };
  next.updatedAt = now;
  applyAutoAnswers(next);
  return next;
}

interface FileShape {
  version: 2;
  sessions: Record<string, UserSession>;
}

export function isSession(value: unknown): value is UserSession {
  const s = value as Partial<UserSession> | null;
  return (
    !!s &&
    typeof s === 'object' &&
    typeof s.telegramUserId === 'number' &&
    typeof s.status === 'string' &&
    ['awaiting_subscription', 'in_progress', 'saving', 'completed'].includes(s.status) &&
    typeof s.currentQuestionIndex === 'number' &&
    !!s.answers &&
    typeof s.answers === 'object' &&
    Array.isArray(s.answeredQuestions) &&
    Array.isArray(s.completedQuestions) &&
    s.completedQuestions.every((k) => (QUESTION_KEYS as readonly string[]).includes(k)) &&
    !!s.pending &&
    Array.isArray(s.pending.selection) &&
    typeof s.updatedAt === 'number'
  );
}

/** Saqlash jarayonida to'xtagan anketa qayta yakunlanishi mumkin bo'lsin (Sheets'ga yozish idempotent). */
const normalizeLoaded = (s: UserSession): UserSession => (s.status === 'saving' ? { ...s, status: 'in_progress' } : s);

/**
 * Foydalanuvchi holatlari. Har o'zgarishda diskka atomik yoziladi (tmp + rename),
 * shuning uchun server qayta ishga tushganda tugallanmagan anketalar shu savoldan davom etadi.
 */
export class SessionStore {
  private readonly sessions = new Map<number, UserSession>();

  /** Har o'zgarishda chaqiriladi (masalan, Google Sheets'dagi zaxira nusxa uchun). null — sessiya o'chirildi. */
  onChange: (userId: number, session: UserSession | null) => void = () => undefined;

  constructor(
    private readonly file: string,
    private readonly ttlMs: number,
    private readonly onLoadError: (message: string) => void = () => undefined,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.load();
  }

  private expired(session: UserSession): boolean {
    // Saqlanayotgan va yakunlangan anketalar muddati tufayli o'chirilmaydi
    if (session.status === 'saving' || session.status === 'completed') return false;
    return this.now() - session.updatedAt > this.ttlMs;
  }

  /** Nusxa qaytaradi: o'zgartirishlar faqat save() orqali kuchga kiradi. */
  get(userId: number): UserSession | undefined {
    const session = this.sessions.get(userId);
    if (!session) return undefined;
    if (this.expired(session)) {
      this.sessions.delete(userId);
      this.persist();
      this.onChange(userId, null);
      return undefined;
    }
    return structuredClone(session);
  }

  /** Diskka yozib bo'lmasa, xotiradagi holat ham eski holatga qaytariladi va xato tashlanadi. */
  save(session: UserSession): void {
    const userId = session.telegramUserId;
    const previous = this.sessions.get(userId);
    const copy = structuredClone(session);
    copy.updatedAt = this.now();
    this.sessions.set(userId, copy);
    try {
      this.persist();
    } catch (err) {
      if (previous) this.sessions.set(userId, previous);
      else this.sessions.delete(userId);
      throw err;
    }
    this.onChange(userId, structuredClone(copy));
  }

  delete(userId: number): void {
    if (!this.sessions.delete(userId)) return;
    this.persist();
    this.onChange(userId, null);
  }

  /**
   * Zaxira nusxadan tiklash: lokal faylda yo'q yoki eskiroq bo'lgan sessiyalar olinadi.
   * Lokal nusxa yangiroq bo'lsa, u saqlanib qoladi. Tiklangan sessiyalar soni qaytariladi.
   */
  restore(list: UserSession[]): number {
    let restored = 0;
    for (const remote of list) {
      if (!isSession(remote) || this.expired(remote)) continue;
      const local = this.sessions.get(remote.telegramUserId);
      if (local && local.updatedAt >= remote.updatedAt) continue;
      this.sessions.set(remote.telegramUserId, normalizeLoaded(remote));
      restored++;
    }
    if (restored > 0) this.persist();
    return restored;
  }

  purgeExpired(): number {
    let removed = 0;
    for (const [userId, session] of this.sessions) {
      if (this.expired(session)) {
        this.sessions.delete(userId);
        this.onChange(userId, null);
        removed++;
      }
    }
    if (removed > 0) this.persist();
    return removed;
  }

  /** Faol (yakunlanmagan) anketalar soni. */
  get activeCount(): number {
    let n = 0;
    for (const s of this.sessions.values()) if (s.status !== 'completed') n++;
    return n;
  }

  get size(): number {
    return this.sessions.size;
  }

  private load(): void {
    if (!fs.existsSync(this.file)) return;
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8')) as { version?: unknown; sessions?: Record<string, unknown> };
      // Eski (1-versiya) ro'yxatdan o'tish sessiyalari yangi anketaga mos emas — e'tiborsiz qoldiriladi
      if (raw.version !== 2) return;
      for (const [key, value] of Object.entries(raw.sessions ?? {})) {
        const userId = Number(key);
        if (Number.isSafeInteger(userId) && isSession(value) && value.telegramUserId === userId) {
          this.sessions.set(userId, normalizeLoaded(value));
        }
      }
    } catch {
      this.onLoadError("Sessiya fayli o'qilmadi; anketalar yangidan boshlanadi");
    }
  }

  private persist(): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    const data: FileShape = { version: 2, sessions: Object.fromEntries(this.sessions) };
    fs.writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }
}
