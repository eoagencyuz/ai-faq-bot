import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AnswerRejected, SessionStore, acceptAnswer, currentQuestion, newSession, type UserSession } from '../src/services/session.js';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reg-session-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const started = (userId = 7): UserSession => ({ ...newSession(userId, 'ali', 1_000), status: 'in_progress' });

describe('acceptAnswer', () => {
  it('javobni qabul qilib, keyingi savolga o\'tadi va asl sessiyani o\'zgartirmaydi', () => {
    const s = started();
    const next = acceptAnswer(s, 'full_name', { kind: 'text', value: 'Aliyev Vali' }, 2_000);
    expect(next.currentQuestionIndex).toBe(1);
    expect(next.answeredQuestions).toEqual(['full_name']);
    expect(s.currentQuestionIndex).toBe(0);
    expect(s.answers.full_name).toBeUndefined();
  });

  it('bir savolga ikkinchi marta javob qabul qilinmaydi', () => {
    const s = acceptAnswer(started(), 'full_name', { kind: 'text', value: 'Aliyev Vali' }, 2_000);
    expect(() => acceptAnswer(s, 'full_name', { kind: 'text', value: 'Boshqa Ism' }, 3_000)).toThrow(AnswerRejected);
  });

  it('joriy bo\'lmagan savolga javob qabul qilinmaydi', () => {
    expect(() => acceptAnswer(started(), 'course', { kind: 'choice', optionId: 'c1' }, 2_000)).toThrow(AnswerRejected);
  });

  it("'Faqat universitetda tahsil olaman' bo'lsa, ish sohasi avtomatik 'Hozir ishlamayman'", () => {
    const s: UserSession = { ...started(), currentQuestionIndex: 5 };
    const next = acceptAnswer(s, 'occupation', { kind: 'choice', optionId: 'study_only' }, 2_000);
    expect(next.answers.work_field).toEqual({ kind: 'choice', optionId: 'not_working', auto: true });
    expect(next.completedQuestions).toContain('work_field');
    expect(next.answeredQuestions).not.toContain('work_field');
    expect(currentQuestion(next)?.key).toBe('free_time');
  });

  it("ishlasa, ish sohasi savoli so'raladi", () => {
    const s: UserSession = { ...started(), currentQuestionIndex: 5 };
    const next = acceptAnswer(s, 'occupation', { kind: 'choice', optionId: 'study_work' }, 2_000);
    expect(currentQuestion(next)?.key).toBe('work_field');
  });
});

describe('SessionStore', () => {
  it('server qayta ishga tushganda anketa shu savoldan davom etadi', () => {
    const file = path.join(dir, 'sessions.json');
    const first = new SessionStore(file, 3_600_000);
    const s = acceptAnswer(started(), 'full_name', { kind: 'text', value: 'Aliyev Vali' }, 2_000);
    first.save({ ...s, pending: { selection: [] } });

    const restarted = new SessionStore(file, 3_600_000);
    const session = restarted.get(7);
    expect(session?.status).toBe('in_progress');
    expect(session && currentQuestion(session)?.key).toBe('phone');
    expect(session?.answers.full_name).toEqual({ kind: 'text', value: 'Aliyev Vali' });
  });

  it("muddati o'tgan tugallanmagan sessiyalarni tozalaydi, yakunlanganlarini saqlaydi", () => {
    let clock = 1_000;
    const store = new SessionStore(path.join(dir, 's.json'), 1_000, () => undefined, () => clock);
    store.save(started(1));
    store.save({ ...started(2), status: 'completed' });
    store.save({ ...started(3), status: 'saving' });
    clock += 5_000;
    expect(store.get(1)).toBeUndefined();
    expect(store.purgeExpired()).toBe(0);
    expect(store.get(2)?.status).toBe('completed');
    expect(store.get(3)?.status).toBe('saving');
  });

  it("get() nusxa qaytaradi: save() siz o'zgarish saqlanmaydi", () => {
    const store = new SessionStore(path.join(dir, 'c.json'), 3_600_000);
    store.save(started(4));
    const copy = store.get(4)!;
    copy.currentQuestionIndex = 10;
    expect(store.get(4)?.currentQuestionIndex).toBe(0);
  });

  it("diskka yozib bo'lmasa, eski holat saqlanib qoladi", () => {
    const file = path.join(dir, 'ro', 'sessions.json');
    const store = new SessionStore(file, 3_600_000);
    store.save(started(5));
    fs.rmSync(path.join(dir, 'ro'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'ro'), 'fayl, papka emas');
    expect(() => store.save({ ...started(5), currentQuestionIndex: 3 })).toThrow();
    expect(store.get(5)?.currentQuestionIndex).toBe(0);
  });

  it("saqlash paytida to'xtagan anketa qayta ishga tushganda yana yakunlanishi mumkin", () => {
    const file = path.join(dir, 'saving.json');
    new SessionStore(file, 3_600_000).save({ ...started(6), status: 'saving' });
    expect(new SessionStore(file, 3_600_000).get(6)?.status).toBe('in_progress');
  });

  it('buzilgan fayl bilan ishga tushadi va xabar beradi', () => {
    const file = path.join(dir, 'bad.json');
    fs.writeFileSync(file, '{not json');
    const messages: string[] = [];
    const store = new SessionStore(file, 3_600_000, (m) => messages.push(m));
    expect(store.size).toBe(0);
    expect(messages).toHaveLength(1);
  });

  it("eski (1-versiya) sessiyalar e'tiborsiz qoldiriladi", () => {
    const file = path.join(dir, 'v1.json');
    fs.writeFileSync(file, JSON.stringify({ version: 1, sessions: { '9': { stage: 'filling', draft: null, updatedAt: 1 } } }));
    expect(new SessionStore(file, 3_600_000).size).toBe(0);
  });

  it('yozish atomik: vaqtinchalik fayl qoldirmaydi', () => {
    const file = path.join(dir, 'atomic.json');
    new SessionStore(file, 3_600_000).save(started(3));
    expect(fs.existsSync(`${file}.tmp`)).toBe(false);
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).version).toBe(2);
  });
});
