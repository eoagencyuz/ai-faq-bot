import {
  normalizePhone,
  validateFullName,
  validateLongText,
  validateNote,
  validatePortfolioUrl,
} from '../validators/registration.js';

export const QUESTION_KEYS = [
  'full_name',
  'phone',
  'phone_contact',
  'program',
  'course',
  'occupation',
  'work_field',
  'free_time',
  'weekly_hours',
  'start_time',
  'motivation',
  'media_interests',
  'media_experience',
  'portfolio',
  'ai_usage',
  'ai_tools',
  'ai_goals',
  'devices',
  'three_month_goal',
  'ready_for_tasks',
  'work_style',
] as const;

export type QuestionKey = (typeof QUESTION_KEYS)[number];

export interface Option {
  id: string;
  label: string;
  /** "Boshqa." — tanlansa izoh majburiy. */
  other?: boolean;
  /** Ko'p tanlovda boshqa variantlar bilan birga tanlab bo'lmaydi. */
  exclusive?: boolean;
}

export type Question =
  | { key: QuestionKey; kind: 'full_name'; text: string }
  | { key: QuestionKey; kind: 'phone_manual'; text: string }
  | { key: QuestionKey; kind: 'phone_contact'; text: string }
  | { key: QuestionKey; kind: 'text'; text: string; min: number; max: number }
  | { key: QuestionKey; kind: 'single'; text: string; options: Option[] }
  | { key: QuestionKey; kind: 'multi'; text: string; options: Option[]; minSelected: number }
  | { key: QuestionKey; kind: 'portfolio'; text: string; options: Option[] };

export type Answer =
  | { kind: 'text'; value: string }
  | { kind: 'contact'; phone: string; matchesManual: boolean }
  | { kind: 'choice'; optionId: string; note?: string; auto?: boolean }
  | { kind: 'multi'; optionIds: string[] }
  | { kind: 'portfolio'; hasPortfolio: boolean; url?: string };

export type Answers = Partial<Record<QuestionKey, Answer>>;

const opts = (...items: Array<[string, string] | [string, string, 'other' | 'exclusive']>): Option[] =>
  items.map(([id, label, flag]) => ({ id, label, ...(flag === 'other' ? { other: true } : {}), ...(flag === 'exclusive' ? { exclusive: true } : {}) }));

export const QUESTIONS: readonly Question[] = [
  { key: 'full_name', kind: 'full_name', text: 'Ism-familiyangizni to‘liq kiriting.' },
  {
    key: 'phone',
    kind: 'phone_manual',
    text: 'Siz bilan bog‘lanishimiz uchun telefon raqamingizni kiriting.\nMasalan: +998901234567',
  },
  { key: 'phone_contact', kind: 'phone_contact', text: 'Telefon raqamingizni Telegram orqali yuboring.' },
  {
    key: 'program',
    kind: 'single',
    text: 'Qarshi xalqaro universitetida qaysi ta’lim yo‘nalishida tahsil olasiz?',
    options: opts(
      ['preschool', 'Maktabgacha ta’lim'],
      ['primary', 'Boshlang‘ich ta’lim'],
      ['national_idea', 'Milliy g‘oya, ma’naviyat asoslari va huquq ta’limi'],
      ['philology_en', 'Filologiya va tillarni o‘qitish (ingliz tili)'],
      ['philology_ru', 'Filologiya va tillarni o‘qitish (rus tili)'],
      ['philology_uz', 'Filologiya va tillarni o‘qitish (o‘zbek tili)'],
      ['psychology', 'Psixologiya'],
      ['economics', 'Iqtisodiyot'],
      ['accounting', 'Buxgalteriya hisobi'],
      ['finance', 'Moliya va moliyaviy texnologiyalar'],
      ['software', 'Dasturiy injiniring'],
      ['oil_gas', 'Neft va gaz ishi'],
    ),
  },
  {
    key: 'course',
    kind: 'single',
    text: 'Nechanchi kursda tahsil olasiz?',
    options: opts(['c1', '1-kurs'], ['c2', '2-kurs'], ['c3', '3-kurs'], ['c4', '4-kurs']),
  },
  {
    key: 'occupation',
    kind: 'single',
    text: 'Hozirgi vaqtda asosan nima bilan bandsiz?',
    options: opts(
      ['study_only', 'Faqat universitetda tahsil olaman.'],
      ['study_work', 'Universitetda tahsil olaman va ishlayman.'],
      ['full_time', 'To‘liq stavkada ishlayman.'],
      ['part_time', 'Yarim stavkada ishlayman.'],
      ['freelance', 'Freelance loyihalar bilan shug‘ullanaman.'],
      ['business', 'O‘z biznesimni yuritaman.'],
      ['other', 'Boshqa.', 'other'],
    ),
  },
  {
    key: 'work_field',
    kind: 'single',
    text: 'Agar ishlayotgan bo‘lsangiz, qaysi sohada faoliyat yuritasiz?',
    options: opts(
      ['education', 'Ta’lim va o‘qitish.'],
      ['marketing', 'Marketing va SMM.'],
      ['media', 'Media, dizayn yoki videomontaj.'],
      ['it', 'IT va dasturlash.'],
      ['sales', 'Savdo va xizmat ko‘rsatish.'],
      ['finance', 'Moliya va buxgalteriya.'],
      ['other', 'Boshqa.', 'other'],
      ['not_working', 'Hozir ishlamayman.'],
    ),
  },
  {
    key: 'free_time',
    kind: 'single',
    text: 'Odatda qaysi vaqtda bo‘sh bo‘lasiz?',
    options: opts(
      ['morning', 'Ertalab.'],
      ['afternoon', 'Kunduzi.'],
      ['evening', 'Kechqurun.'],
      ['weekend', 'Dam olish kunlari.'],
      ['varies', 'Jadvalim o‘zgarib turadi.'],
    ),
  },
  {
    key: 'weekly_hours',
    kind: 'single',
    text: 'Shogirdlik uchun haftasiga qancha vaqt ajrata olasiz?',
    options: opts(['h3_5', '3–5 soat.'], ['h6_10', '6–10 soat.'], ['h11_15', '11–15 soat.'], ['h15_plus', '15 soatdan ko‘p.']),
  },
  {
    key: 'start_time',
    kind: 'single',
    text: 'Shogirdlik dasturida qachondan boshlab qatnasha olasiz?',
    options: opts(['now', 'Darhol.'], ['week', 'Bir hafta ichida.'], ['two_weeks', 'Ikki hafta ichida.'], ['later', 'Keyinroq.']),
  },
  {
    key: 'motivation',
    kind: 'text',
    text: 'Nima uchun Media & AI yo‘nalishida shogird bo‘lishni xohlaysiz va ushbu dasturdan nimalarni kutyapsiz?',
    min: 30,
    max: 1000,
  },
  {
    key: 'media_interests',
    kind: 'multi',
    text: 'Qaysi media yo‘nalishlari sizni ko‘proq qiziqtiradi? Bir nechta variantni tanlashingiz mumkin.',
    minSelected: 1,
    options: opts(
      ['smm', 'SMM va ijtimoiy tarmoqlar.'],
      ['video_editing', 'Video montaj.'],
      ['reels', 'Reels va qisqa videolar yaratish.'],
      ['graphic_design', 'Grafik dizayn.'],
      ['photo', 'Fotografiya va vizual kontent.'],
      ['journalism', 'Jurnalistika, intervyu va boshlovchilik.'],
      ['marketing', 'Marketing va reklama.'],
      ['copywriting', 'Copywriting va matn yozish.'],
      ['undecided', 'Hozircha aniq yo‘nalishni tanlamaganman, o‘rganishga tayyorman.'],
    ),
  },
  {
    key: 'media_experience',
    kind: 'single',
    text: 'Media yoki kontent yaratish bo‘yicha tajribangiz qanday?',
    options: opts(
      ['none', 'Hozircha tajribam yo‘q, o‘rganishga tayyorman.'],
      ['self_taught', 'Mustaqil ravishda boshlang‘ich bilimlarni o‘rganganman.'],
      ['social_content', 'Ijtimoiy tarmoqlar uchun kontent tayyorlaganman.'],
      ['editing_design', 'Video montaj yoki dizayn bilan shug‘ullanganman.'],
      ['smm_projects', 'SMM yoki marketing loyihalarida qatnashganman.'],
      ['client_work', 'Amaliy loyihalar yoki buyurtmalar bilan ishlaganman.'],
    ),
  },
  {
    key: 'portfolio',
    kind: 'portfolio',
    text: 'Avval yaratgan ishlaringiz, portfolio yoki loyihalaringiz havolasini yuboring.',
    options: opts(['link', 'Portfolio havolasini yuboraman.'], ['none', 'Hozircha portfolio yoki ish namunalarim yo‘q.']),
  },
  {
    key: 'ai_usage',
    kind: 'single',
    text: 'Sun’iy intellekt vositalaridan qanday maqsadlarda foydalangansiz?',
    options: opts(
      ['never', 'Hali foydalanmaganman.'],
      ['chat_info', 'ChatGPT, Claude yoki Gemini orqali ma’lumot olish va matn yaratishda.'],
      ['content', 'Matn va kontent tayyorlashda.'],
      ['media_gen', 'Rasm yoki video yaratishda.'],
      ['automation', 'Avtomatlashtirish yoki dasturlashda.'],
      ['multiple', 'Bir nechta yo‘nalishda foydalanaman.'],
    ),
  },
  {
    key: 'ai_tools',
    kind: 'multi',
    text: 'Qaysi AI vositalaridan foydalangansiz yoki ular bilan tanishsiz?',
    minSelected: 1,
    options: opts(
      ['chatgpt', 'ChatGPT.'],
      ['claude', 'Claude.'],
      ['gemini', 'Gemini.'],
      ['image_gen', 'Midjourney yoki boshqa rasm generatorlari.'],
      ['video_gen', 'Runway, Kling yoki boshqa video generatorlari.'],
      ['canva_ai', 'Canva AI.'],
      ['agents', 'AI agentlari va avtomatlashtirish vositalari.'],
      ['none', 'Hozircha hech qaysisini bilmayman.', 'exclusive'],
    ),
  },
  {
    key: 'ai_goals',
    kind: 'multi',
    text: 'AI yordamida qaysi ko‘nikmalarni rivojlantirmoqchisiz?',
    minSelected: 1,
    options: opts(
      ['text', 'Matn va kontent yaratish.'],
      ['image', 'Rasm va dizayn.'],
      ['video', 'Video va Reels.'],
      ['smm_automation', 'SMM jarayonlarini avtomatlashtirish.'],
      ['web_dev', 'Sayt yaratish va dasturlash.'],
      ['agents', 'AI agentlari yaratish.'],
      ['all', 'Barchasini bosqichma-bosqich o‘rganish.', 'exclusive'],
    ),
  },
  {
    key: 'devices',
    kind: 'single',
    text: 'Amaliy topshiriqlarni bajarish va o‘rganish uchun qanday qurilmalardan foydalana olasiz?',
    options: opts(
      ['phone', 'Smartfon.'],
      ['computer', 'Noutbuk yoki kompyuter.'],
      ['both', 'Smartfon va noutbuk/kompyuter.'],
      ['no_computer', 'Shaxsiy kompyuterim yo‘q.'],
    ),
  },
  {
    key: 'three_month_goal',
    kind: 'text',
    text: 'Ushbu dastur davomida keyingi 3 oy ichida qanday aniq natijaga erishmoqchisiz?',
    min: 20,
    max: 1000,
  },
  {
    key: 'ready_for_tasks',
    kind: 'single',
    text: 'Belgilangan muddatlarda amaliy topshiriqlarni bajarish va jamoa bilan kelishilgan vazifalar uchun mas’uliyat olishga tayyormisiz?',
    options: opts(['yes', 'Ha, tayyorman.'], ['review_terms', 'Avval dastur shartlari va talablar bilan tanishmoqchiman.']),
  },
  {
    key: 'work_style',
    kind: 'single',
    text: 'Siz uchun qaysi ishlash uslubi qulayroq?',
    options: opts(['team', 'Jamoa bilan ishlashni yaxshi ko‘raman.'], ['solo', 'Mustaqil ishlashni afzal ko‘raman.'], ['both', 'Har ikkala usul ham menga mos.']),
  },
];

export const TOTAL_QUESTIONS = QUESTIONS.length;

export const questionIndex = (key: QuestionKey): number => QUESTIONS.findIndex((q) => q.key === key);

export const questionByKey = (key: QuestionKey): Question => QUESTIONS[questionIndex(key)] as Question;

export function optionsOf(q: Question): Option[] {
  return q.kind === 'single' || q.kind === 'multi' || q.kind === 'portfolio' ? q.options : [];
}

export const findOption = (q: Question, id: string): Option | undefined => optionsOf(q).find((o) => o.id === id);

/**
 * Avvalgi javoblarga ko'ra avtomatik to'ldiriladigan savollar.
 * "Faqat universitetda tahsil olaman" tanlansa, ish sohasi "Hozir ishlamayman" bo'ladi va savol berilmaydi.
 */
export function autoAnswer(key: QuestionKey, answers: Answers): Answer | null {
  if (key === 'work_field') {
    const occ = answers.occupation;
    if (occ?.kind === 'choice' && occ.optionId === 'study_only') {
      return { kind: 'choice', optionId: 'not_working', auto: true };
    }
  }
  return null;
}

/**
 * Ko'p tanlovda variantni belgilash/olib tashlash. Eksklyuziv variant tanlansa, qolganlari olib tashlanadi;
 * boshqa variant tanlansa, eksklyuziv variant olib tashlanadi. Natija variantlar tartibida.
 */
export function toggleSelection(q: Question, selection: string[], optionId: string): string[] {
  const options = optionsOf(q);
  const option = options.find((o) => o.id === optionId);
  if (!option) return selection;
  let next: string[];
  if (selection.includes(optionId)) {
    next = selection.filter((id) => id !== optionId);
  } else if (option.exclusive) {
    next = [optionId];
  } else {
    const exclusive = new Set(options.filter((o) => o.exclusive).map((o) => o.id));
    next = [...selection.filter((id) => !exclusive.has(id)), optionId];
  }
  return options.map((o) => o.id).filter((id) => next.includes(id));
}

export type Check = { ok: true } | { ok: false; error: string };

const fail = (error: string): Check => ({ ok: false, error });

/** Tanlov (bitta yoki ko'p) "➡️ Keyingi" bosilishidan oldin tekshiriladi. */
export function validateSelection(q: Question, selection: string[]): Check {
  const options = optionsOf(q);
  const ids = new Set(options.map((o) => o.id));
  if (selection.length === 0) return fail('Iltimos, kamida bitta variantni tanlang.');
  if (!selection.every((id) => ids.has(id)) || new Set(selection).size !== selection.length) {
    return fail('Tanlov noto‘g‘ri. Qaytadan tanlang.');
  }
  if (q.kind === 'multi') {
    if (selection.length < q.minSelected) return fail(`Kamida ${q.minSelected} ta variantni tanlang.`);
    const hasExclusive = selection.some((id) => options.find((o) => o.id === id)?.exclusive);
    if (hasExclusive && selection.length > 1) return fail('Bu variantni boshqalari bilan birga tanlab bo‘lmaydi.');
    return { ok: true };
  }
  if (selection.length !== 1) return fail('Faqat bitta variantni tanlang.');
  return { ok: true };
}

/** Yakuniy tekshiruv: saqlangan javob savol turiga va qoidalariga mosmi (server tomonida qayta tekshirish). */
export function validateAnswer(q: Question, answer: Answer | undefined, answers: Answers): Check {
  if (!answer) return fail('Javob yo‘q.');
  switch (q.kind) {
    case 'full_name':
      return answer.kind === 'text' && validateFullName(answer.value).ok ? { ok: true } : fail('Ism-familiya noto‘g‘ri.');
    case 'phone_manual':
      return answer.kind === 'text' && normalizePhone(answer.value).ok ? { ok: true } : fail('Telefon raqami noto‘g‘ri.');
    case 'phone_contact': {
      if (answer.kind !== 'contact' || !normalizePhone(answer.phone).ok) return fail('Telegram raqami noto‘g‘ri.');
      const manual = answers.phone;
      const same = manual?.kind === 'text' && manual.value === answer.phone;
      return same === answer.matchesManual ? { ok: true } : fail('Telefon raqamlari mosligi noto‘g‘ri.');
    }
    case 'text':
      return answer.kind === 'text' && validateLongText(answer.value, q.min, q.max).ok ? { ok: true } : fail('Javob noto‘g‘ri.');
    case 'single': {
      if (answer.kind !== 'choice') return fail('Javob noto‘g‘ri.');
      const option = findOption(q, answer.optionId);
      if (!option) return fail('Variant noto‘g‘ri.');
      if (option.other && !(answer.note && validateNote(answer.note).ok)) return fail('“Boshqa” uchun izoh kerak.');
      if (!option.other && answer.note !== undefined) return fail('Izoh faqat “Boshqa” uchun.');
      if (answer.auto) {
        const expected = autoAnswer(q.key, answers);
        if (!expected || expected.kind !== 'choice' || expected.optionId !== answer.optionId) return fail('Avtomatik javob noto‘g‘ri.');
      }
      return { ok: true };
    }
    case 'multi':
      return answer.kind === 'multi' ? validateSelection(q, answer.optionIds) : fail('Javob noto‘g‘ri.');
    case 'portfolio':
      if (answer.kind !== 'portfolio') return fail('Javob noto‘g‘ri.');
      if (!answer.hasPortfolio) return answer.url === undefined ? { ok: true } : fail('Javob noto‘g‘ri.');
      return answer.url && validatePortfolioUrl(answer.url).ok ? { ok: true } : fail('Portfolio havolasi noto‘g‘ri.');
  }
}

/** Birinchi yetishmayotgan yoki noto'g'ri javob (yo'q bo'lsa null). */
export function findInvalidAnswer(answers: Answers): { key: QuestionKey; error: string } | null {
  for (const q of QUESTIONS) {
    const check = validateAnswer(q, answers[q.key], answers);
    if (!check.ok) return { key: q.key, error: check.error };
  }
  return null;
}

/** Javobni o'qiladigan matnga aylantiradi (Sheets va xulosa uchun). Ko'p tanlov "; " bilan ajratiladi. */
export function answerLabel(key: QuestionKey, answers: Answers): string {
  const q = questionByKey(key);
  const a = answers[key];
  if (!a) return '';
  switch (a.kind) {
    case 'text':
      return a.value;
    case 'contact':
      return a.phone;
    case 'choice':
      return findOption(q, a.optionId)?.label ?? '';
    case 'multi':
      return a.optionIds.map((id) => findOption(q, id)?.label ?? id).join('; ');
    case 'portfolio':
      return a.hasPortfolio ? 'Ha' : 'Yo‘q';
  }
}

export const noteOf = (answers: Answers, key: QuestionKey): string => {
  const a = answers[key];
  return a?.kind === 'choice' ? (a.note ?? '') : '';
};

export interface RegistrationRecord {
  id: string;
  createdAt: Date;
  userId: number;
  username: string;
  answers: Answers;
  subscriptionVerified: boolean;
}
