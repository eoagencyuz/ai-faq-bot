import type { FieldKey, Gender, RegistrationRecord, Regions } from '../types/index.js';
import {
  GENDER_LABELS,
  normalizePhone,
  parseBirthDate,
  parseGender,
  validateDistrict,
  validateName,
  validateOptionalText,
  validateRegion,
  type Result,
} from '../validators/registration.js';

export const FIELD_LABELS: Record<FieldKey, string> = {
  first_name: 'Ism',
  last_name: 'Familiya',
  phone: 'Telefon raqami',
  birth_date: "Tug'ilgan sana",
  gender: 'Jinsi',
  region: 'Viloyat / shahar',
  district: 'Tuman',
  additional_info: "Qo'shimcha ma'lumot",
};

/** Ro'yxatdan o'tish jarayonidagi joriy holat. step — hozir so'ralayotgan maydon yoki 'confirm'. */
export interface Draft {
  data: Partial<Record<FieldKey, string>>;
  step: FieldKey | 'confirm';
  history: FieldKey[];
  editing: boolean;
}

export interface ValidationContext {
  todayIso: string;
  regions: Regions;
  region?: string;
}

export function validateValue(field: FieldKey, raw: string, ctx: ValidationContext): Result<string> {
  switch (field) {
    case 'first_name':
      return validateName(raw, 'Ism');
    case 'last_name':
      return validateName(raw, 'Familiya');
    case 'phone':
      return normalizePhone(raw);
    case 'birth_date':
      return parseBirthDate(raw, ctx.todayIso);
    case 'gender':
      return parseGender(raw);
    case 'region':
      return validateRegion(raw, ctx.regions);
    case 'district':
      return validateDistrict(raw, ctx.regions, ctx.region);
    case 'additional_info':
      return validateOptionalText(raw, 300);
  }
}

export function createDraft(fields: readonly FieldKey[]): Draft {
  return { data: {}, step: fields[0] ?? 'confirm', history: [], editing: false };
}

/** Joriy maydonga javob berilgandan keyin keyingi holat. */
export function answer(draft: Draft, fields: readonly FieldKey[], value: string): Draft {
  const step = draft.step as FieldKey;
  const data = { ...draft.data, [step]: value };
  if (draft.editing) return { data, step: 'confirm', history: draft.history, editing: false };
  const next = fields[fields.indexOf(step) + 1];
  return { data, step: next ?? 'confirm', history: [...draft.history, step], editing: false };
}

/** Orqaga: oldingi maydonga qaytadi va uning qiymatini o'chiradi. */
export function goBack(draft: Draft): Draft | null {
  if (draft.editing) return { ...draft, step: 'confirm', editing: false };
  const prev = draft.history[draft.history.length - 1];
  if (!prev) return null;
  const data = { ...draft.data };
  delete data[prev];
  return { data, step: prev, history: draft.history.slice(0, -1), editing: false };
}

export function startEdit(draft: Draft, field: FieldKey): Draft {
  return { ...draft, step: field, editing: true };
}

/** Tasdiqlashdan oldin barcha maydonlar qayta tekshiriladi. Birinchi noto'g'ri maydonni qaytaradi. */
export function findInvalidField(
  draft: Draft,
  fields: readonly FieldKey[],
  ctx: Omit<ValidationContext, 'region'>,
): FieldKey | null {
  for (const field of fields) {
    const raw = draft.data[field];
    if (raw === undefined) return field;
    if (!validateValue(field, raw, { ...ctx, region: draft.data.region }).ok) return field;
  }
  return null;
}

export function buildRecord(
  draft: Draft,
  meta: { id: string; createdAt: Date; userId: number; username: string; subscriptionVerified: boolean },
): RegistrationRecord {
  const d = draft.data;
  return {
    ...meta,
    firstName: d.first_name ?? '',
    lastName: d.last_name ?? '',
    phone: d.phone ?? '',
    birthDate: d.birth_date ?? '',
    gender: (d.gender ?? '') as Gender | '',
    region: d.region ?? '',
    district: d.district ?? '',
    additionalInfo: d.additional_info ?? '',
  };
}

export function displayValue(field: FieldKey, value: string | undefined): string {
  if (!value) return '—';
  if (field === 'gender' && value in GENDER_LABELS) return GENDER_LABELS[value as Gender];
  return value;
}
