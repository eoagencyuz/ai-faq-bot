import { describe, expect, it } from 'vitest';
import {
  QUESTIONS,
  QUESTION_KEYS,
  findInvalidAnswer,
  questionByKey,
  toggleSelection,
  validateAnswer,
  validateSelection,
} from '../src/services/questionnaire.js';
import { sampleAnswers } from './helpers.js';

describe('QUESTIONS', () => {
  it("21 ta savol, belgilangan tartibda", () => {
    expect(QUESTIONS).toHaveLength(21);
    expect(QUESTIONS.map((q) => q.key)).toEqual([...QUESTION_KEYS]);
    expect(questionByKey('full_name').text).toBe('Ism-familiyangizni to‘liq kiriting.');
    expect(questionByKey('work_style').text).toBe('Siz uchun qaysi ishlash uslubi qulayroq?');
  });

  it('variantlar matni topshiriqdagidek', () => {
    const program = questionByKey('program');
    expect(program.kind === 'single' && program.options.map((o) => o.label)).toContain('Filologiya va tillarni o‘qitish (ingliz tili)');
    const tools = questionByKey('ai_tools');
    expect(tools.kind === 'multi' && tools.options.at(-1)).toMatchObject({ label: 'Hozircha hech qaysisini bilmayman.', exclusive: true });
  });
});

describe('toggleSelection', () => {
  const tools = questionByKey('ai_tools');
  const goals = questionByKey('ai_goals');

  it("ko'p tanlovni belgilaydi va olib tashlaydi (variantlar tartibida)", () => {
    let s = toggleSelection(tools, [], 'gemini');
    s = toggleSelection(tools, s, 'chatgpt');
    expect(s).toEqual(['chatgpt', 'gemini']);
    expect(toggleSelection(tools, s, 'gemini')).toEqual(['chatgpt']);
  });

  it("AI vositalari: 'hech qaysisini bilmayman' boshqalar bilan birga tanlanmaydi", () => {
    expect(toggleSelection(tools, ['chatgpt', 'claude'], 'none')).toEqual(['none']);
    expect(toggleSelection(tools, ['none'], 'claude')).toEqual(['claude']);
    expect(validateSelection(tools, ['none', 'claude']).ok).toBe(false);
  });

  it("17-savol: 'Barchasini bosqichma-bosqich o'rganish' eksklyuziv", () => {
    expect(toggleSelection(goals, ['text', 'video'], 'all')).toEqual(['all']);
    expect(toggleSelection(goals, ['all'], 'video')).toEqual(['video']);
    expect(validateSelection(goals, ['all', 'video']).ok).toBe(false);
  });

  it("noma'lum variantni e'tiborsiz qoldiradi", () => {
    expect(toggleSelection(tools, ['chatgpt'], 'xxx')).toEqual(['chatgpt']);
  });
});

describe('validateSelection', () => {
  it("bo'sh tanlovni rad etadi", () => {
    expect(validateSelection(questionByKey('course'), []).ok).toBe(false);
    expect(validateSelection(questionByKey('media_interests'), []).ok).toBe(false);
  });

  it('bitta tanlovda faqat bitta variant', () => {
    expect(validateSelection(questionByKey('course'), ['c1']).ok).toBe(true);
    expect(validateSelection(questionByKey('course'), ['c1', 'c2']).ok).toBe(false);
  });
});

describe('validateAnswer / findInvalidAnswer', () => {
  it("to'liq anketa tekshiruvdan o'tadi", () => {
    expect(findInvalidAnswer(sampleAnswers())).toBeNull();
  });

  it('yetishmayotgan javobni topadi', () => {
    const answers = sampleAnswers();
    delete answers.devices;
    expect(findInvalidAnswer(answers)?.key).toBe('devices');
  });

  it("'Boshqa' izohsiz qabul qilinmaydi", () => {
    const answers = sampleAnswers();
    const q = questionByKey('occupation');
    expect(validateAnswer(q, { kind: 'choice', optionId: 'other' }, answers).ok).toBe(false);
    expect(validateAnswer(q, { kind: 'choice', optionId: 'other', note: ' ' }, answers).ok).toBe(false);
    expect(validateAnswer(q, { kind: 'choice', optionId: 'other', note: 'Volontyor' }, answers).ok).toBe(true);
  });

  it('portfolio: havola yoki "portfolio yo\'q"', () => {
    const q = questionByKey('portfolio');
    const answers = sampleAnswers();
    expect(validateAnswer(q, { kind: 'portfolio', hasPortfolio: false }, answers).ok).toBe(true);
    expect(validateAnswer(q, { kind: 'portfolio', hasPortfolio: true, url: 'https://behance.net/a' }, answers).ok).toBe(true);
    expect(validateAnswer(q, { kind: 'portfolio', hasPortfolio: true }, answers).ok).toBe(false);
  });

  it("avtomatik javob faqat 'Faqat universitetda tahsil olaman' uchun to'g'ri", () => {
    const answers = sampleAnswers();
    answers.occupation = { kind: 'choice', optionId: 'study_work' };
    expect(findInvalidAnswer(answers)?.key).toBe('work_field');
  });

  it('telefonlar mosligi belgisi tekshiriladi', () => {
    const answers = sampleAnswers();
    answers.phone_contact = { kind: 'contact', phone: '+998901234567', matchesManual: false };
    expect(findInvalidAnswer(answers)?.key).toBe('phone_contact');
  });

  it('matnli javob uzunligi tekshiriladi', () => {
    const answers = sampleAnswers();
    answers.motivation = { kind: 'text', value: 'qisqa' };
    expect(findInvalidAnswer(answers)?.key).toBe('motivation');
  });
});
