import { describe, expect, it } from 'vitest';
import { FIELD_KEYS, type FieldKey } from '../src/types/index.js';
import * as flow from '../src/services/registration.js';

const FIELDS: FieldKey[] = ['first_name', 'last_name', 'phone', 'birth_date', 'gender', 'region', 'district', 'additional_info'];
const ctx = { todayIso: '2026-10-12', regions: null };

describe('ro\'yxatdan o\'tish holati', () => {
  it('maydonlarni tartib bilan so\'raydi, oxirida confirm ga o\'tadi', () => {
    let draft = flow.createDraft(FIELDS);
    const asked: string[] = [];
    for (const value of ['Ali', 'Vali', '+998901234567', '15.05.2005', 'male', 'Qashqadaryo', 'Qarshi', '']) {
      asked.push(draft.step);
      draft = flow.answer(draft, FIELDS, value);
    }
    expect(asked).toEqual(FIELDS);
    expect(draft.step).toBe('confirm');
    expect(flow.findInvalidField(draft, FIELDS, ctx)).toBeNull();
  });

  it('orqaga qaytish oldingi qiymatni o\'chiradi', () => {
    let draft = flow.createDraft(FIELDS);
    draft = flow.answer(draft, FIELDS, 'Ali');
    draft = flow.answer(draft, FIELDS, 'Vali');
    const back = flow.goBack(draft);
    expect(back?.step).toBe('last_name');
    expect(back?.data.last_name).toBeUndefined();
    expect(back?.data.first_name).toBe('Ali');
  });

  it('birinchi savoldan orqaga qaytib bo\'lmaydi', () => {
    expect(flow.goBack(flow.createDraft(FIELDS))).toBeNull();
  });

  it('tahrirlashdan keyin yana tasdiqlashga qaytadi', () => {
    let draft = flow.createDraft(FIELDS);
    for (const value of ['Ali', 'Vali', '+998901234567', '15.05.2005', 'male', 'Qashqadaryo', 'Qarshi', '']) {
      draft = flow.answer(draft, FIELDS, value);
    }
    const editing = flow.startEdit(draft, 'first_name');
    const after = flow.answer(editing, FIELDS, 'Karim');
    expect(after.step).toBe('confirm');
    expect(after.data.first_name).toBe('Karim');
    expect(after.history).toEqual(draft.history);
  });

  it('eskirgan yoki noto\'g\'ri ma\'lumotni tasdiqlashda topadi', () => {
    const draft = {
      data: { first_name: 'Ali', last_name: 'Vali', phone: '+998901234567', birth_date: '31.02.2005' },
      step: 'confirm' as const,
      history: [],
      editing: false,
    };
    expect(flow.findInvalidField(draft, FIELDS, ctx)).toBe('birth_date');
  });

  it('ixtiyoriy maydonlar bo\'sh bo\'lishi mumkin, majburiylari yo\'q', () => {
    const draft = flow.createDraft(FIELD_KEYS.slice());
    expect(flow.findInvalidField({ ...draft, data: { first_name: 'Ali' } }, ['first_name', 'phone'], ctx)).toBe('phone');
  });
});
