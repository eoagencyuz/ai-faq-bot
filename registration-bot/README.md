# KIU Media & AI shogirdlarini saralash boti

Qarshi xalqaro universiteti (KIU) talabalaridan **Media & AI shogirdlik dasturi** uchun anketa yig'uvchi Telegram bot. Foydalanuvchi ikkita kanalga obuna bo'ladi, 21 ta savolga bot ichida javob beradi va to'liq anketa **Google Sheets**'ga yoziladi. Web-sayt, admin panel yoki ma'lumotlar bazasi yo'q — hamma amal Telegram ichida bajariladi.

## Texnologiyalar

- Node.js 22, TypeScript
- [Telegraf](https://telegraf.js.org) 4 (polling)
- Google Sheets API v4 (`googleapis`, service account)
- Zod (konfiguratsiya tekshiruvi), Pino (loglar)
- Vitest (testlar — haqiqiy Telegram yoki Google'ga ulanmaydi)

## Xususiyatlar

- `/start` — ikki kanalga majburiy obuna. Obuna Telegram API (`getChatMember`) orqali **server tomonida** tekshiriladi: anketani boshlashda va yakunlashda.
- 21 ta savol, qat'iy tartibda. Har bir savolga **faqat bir marta** javob beriladi.
- Orqaga qaytish, tahrirlash va bekor qilish **yo'q**. Faqat “➡️ Keyingi” tugmasi.
- Telefon raqami ikki marta so'raladi: qo'lda va Telegram kontakti orqali. Faqat o'zining kontakti qabul qilinadi.
- “Boshqa.” varianti uchun izoh majburiy. Portfolio havolasi tekshiriladi.
- Tugallanmagan anketa server qayta ishga tushganda **shu savoldan** davom etadi.
- Bir Telegram akkaunt uchun bitta anketa. Qayta topshirish mumkin emas.
- Google Sheets'ga faqat to'liq anketa yoziladi. Vaqtinchalik xatoda javoblar yo'qolmaydi.
- Admin buyruqlari: `/admin`, `/stats`.

---

## 1. Talablar

- Node.js **22** yoki yangiroq
- Telegram akkaunt, BotFather orqali bot
- Google akkaunt va Google Cloud loyihasi
- VPS, Render yoki Docker

## 2. Telegram bot yaratish

1. Telegram'da **@BotFather** ni oching va `/newbot` buyrug'ini yuboring.
2. Bot nomi va username'ini kiriting.
3. BotFather bergan **tokenni** nusxalang. Uni hech kimga, kodga yoki GitHub'ga yozmang.

> Bu bot **alohida** bot bo'lishi kerak. Boshqa bot (masalan, FAQ bot) bilan bitta tokenni ikki joyda ishlatmang.

## 3. Kanallarni tayyorlash va botni admin qilish

Obunani tekshirish uchun bot **ikkala kanalda ham administrator** bo'lishi shart.

1. Kanal sozlamalari → **Administrators** → **Add Administrator** → botni tanlang. Xabar yuborish huquqi shart emas.
2. Har bir kanal uchun `.env` ga yozing:
   - `CHANNEL_N_ID` — ochiq kanal uchun `@username`, yopiq kanal uchun `-100...` ko'rinishidagi ID.
   - `CHANNEL_N_URL` — foydalanuvchi bosadigan havola (`https://t.me/...` yoki invite havola `https://t.me/+...`).
   - `CHANNEL_N_NAME` — tugmada chiqadigan nom.

**Kanal ID'sini olish:** kanalga vaqtincha **@RawDataBot** ni qo'shing, u ko'rsatgan `chat.id` ni oling va botni chiqarib tashlang.

Joriy kanallar:

| | Kanal | `CHANNEL_N_ID` | `CHANNEL_N_URL` |
|---|---|---|---|
| 1 | Qarshi xalqaro universiteti | `@kiu_uz` | `https://t.me/kiu_uz` |
| 2 | Eldor Abdiraimov | `@eldor_abdiraimov` | `https://t.me/eldor_abdiraimov` |

Bot kanalda admin bo'lmasa, Telegram "chat not found" yoki "not enough rights" xatosini beradi. Bot bunday holatda foydalanuvchini "obuna bo'lmagan" deb emas, **vaqtinchalik xato** deb ko'rsatadi va "🔁 Qayta urinish" tugmasini beradi.

## 4. Google Sheets va service account

1. [console.cloud.google.com](https://console.cloud.google.com) da loyiha yarating (yoki mavjudini oching).
2. **APIs & Services → Library** → **Google Sheets API** ni yoqing.
3. **APIs & Services → Credentials → Create credentials → Service account**. Nom bering va yarating.
4. Service account → **Keys → Add key → Create new key → JSON**. Fayl yuklanadi. **Uni Git'ga qo'shmang.**
5. Kalitni `.env` ga kiriting (ikki usuldan biri):
   - **Osonroq:** `GOOGLE_SERVICE_ACCOUNT_JSON` — JSON faylning butun mazmuni (`{` dan `}` gacha).
   - Yoki alohida: `client_email` → `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `private_key` → `GOOGLE_PRIVATE_KEY`.
6. Jadval ID'si: brauzer manzilidagi `/d/` va `/edit` orasidagi uzun qism → `GOOGLE_SPREADSHEET_ID`.
7. Jadvalni **Share** qiling: `client_email` ni **Editor** huquqi bilan qo'shing.

### Varaq va ustunlar

Anketalar mavjud **"SMM"** jadval fayli ichidagi alohida **`Media_AI`** varag'iga yoziladi (`GOOGLE_SHEET_NAME`, standart `Media_AI`). Eski varaqlarga tegilmaydi.

- Varaq yo'q bo'lsa, bot uni o'zi yaratadi va sarlavhalarni yozadi.
- Sarlavhalar mos kelmasa, bot **ishga tushmaydi** va hech narsani o'chirmaydi yoki ustiga yozmaydi. Bunday holatda yangi varaq nomini bering.

Ustunlar (30 ta, A–AD):

`ID`, `Created At`, `Telegram User ID`, `Telegram Username`, `Full Name`, `Phone`, `Telegram Phone Match`, `Program`, `Course`, `Occupation`, `Occupation Other`, `Work Field`, `Work Field Other`, `Free Time`, `Weekly Hours`, `Start Time`, `Motivation`, `Media Interests`, `Media Experience`, `Has Portfolio`, `Portfolio URL`, `AI Usage`, `AI Tools`, `AI Goals`, `Devices`, `Three Month Goal`, `Ready For Tasks`, `Work Style`, `Subscription Verified`, `Registration Status`

- `Created At` — Asia/Tashkent vaqti, `YYYY-MM-DD HH:mm:ss`.
- `Phone` — qo'lda kiritilgan raqam (`+998...`). Telefon uchun yagona ustun.
- `Telegram Phone Match` — Telegram kontakti bilan mos kelsa `Ha`, aks holda `Yo‘q (+998...)`.
- Ko'p tanlovli javoblar `; ` bilan ajratiladi, masalan `ChatGPT.; Claude.`
- “Boshqa.” izohlari va portfolio havolasi alohida ustunlarda.

## 5. Konfiguratsiya

```bash
cp .env.example .env
```

| O'zgaruvchi | Majburiy | Tavsif |
|---|---|---|
| `BOT_TOKEN` | ha | BotFather tokeni |
| `CHANNEL_1_ID`, `CHANNEL_2_ID` | ha | `@username` yoki `-100...` ID |
| `CHANNEL_1_URL`, `CHANNEL_2_URL` | ha | `https://t.me/...` havolalari |
| `CHANNEL_1_NAME`, `CHANNEL_2_NAME` | yo'q | Tugmalarda chiqadigan nom. Yozilmasa yoki `1-kanal` bo'lsa, bot kanalning haqiqiy nomini Telegram'dan oladi (bot kanalda admin bo'lishi shart) |
| `GOOGLE_SPREADSHEET_ID` | ha | Jadval ID'si ("SMM" fayli) |
| `GOOGLE_SHEET_NAME` | yo'q | Varaq nomi, standart `Media_AI` |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | ha* | Service account JSON'i (butun mazmuni) |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | ha* | yoki alohida: service account emaili |
| `GOOGLE_PRIVATE_KEY` | ha* | yoki alohida: private key |
| `ADMIN_CONTACT_URL` | yo'q | “👤 Administrator” tugmasi havolasi, masalan `https://t.me/abdiraimov_e` |
| `ADMIN_IDS` | ha | Admin Telegram ID lari, vergul bilan: `111,222` |
| `TIMEZONE` | yo'q | Standart `Asia/Tashkent` |
| `SESSION_TTL_HOURS` | yo'q | Tugallanmagan anketa necha soat faolsiz saqlanadi, standart 24 |
| `SESSION_FILE` | yo'q | Sessiya fayli, standart `./data/sessions.json` |
| `PORT` | yo'q | Render kabi hostinglar uchun health-check porti |

\* `GOOGLE_SERVICE_ACCOUNT_JSON` **yoki** `GOOGLE_SERVICE_ACCOUNT_EMAIL` + `GOOGLE_PRIVATE_KEY`.

Noto'g'ri yoki yetishmayotgan qiymat bo'lsa, bot ishga tushmaydi va qaysi o'zgaruvchi noto'g'ri ekanini aytadi. Qiymatlarning o'zi logga yozilmaydi.

## 6. O'rnatish, test va ishga tushirish

```bash
npm ci              # bog'liqliklarni o'rnatish
npm run typecheck   # tiplarni tekshirish
npm test            # testlar (mock'lar bilan, tarmoqsiz)
npm run build       # dist/ ga kompilyatsiya
npm start           # ishga tushirish (polling)
```

Lokal ishlab chiqish uchun: `npm run dev`.

## 7. Anketa savollari

| № | Savol | Javob turi |
|---|---|---|
| 1 | Ism-familiyangizni to‘liq kiriting. | Matn: ism va familiya, faqat harflar |
| 2 | Siz bilan bog‘lanishimiz uchun telefon raqamingizni kiriting. | Matn: `+998901234567` formati |
| 3 | Telefon raqamingizni Telegram orqali yuboring. | “📱 Raqamni ulashish” tugmasi, faqat o'z kontakti |
| 4 | Qarshi xalqaro universitetida qaysi ta’lim yo‘nalishida tahsil olasiz? | Bitta tanlov (12 yo'nalish) |
| 5 | Nechanchi kursda tahsil olasiz? | Bitta tanlov |
| 6 | Hozirgi vaqtda asosan nima bilan bandsiz? | Bitta tanlov, “Boshqa.” — izoh bilan |
| 7 | Agar ishlayotgan bo‘lsangiz, qaysi sohada faoliyat yuritasiz? | Bitta tanlov, “Boshqa.” — izoh bilan |
| 8 | Odatda qaysi vaqtda bo‘sh bo‘lasiz? | Bitta tanlov |
| 9 | Shogirdlik uchun haftasiga qancha vaqt ajrata olasiz? | Bitta tanlov |
| 10 | Shogirdlik dasturida qachondan boshlab qatnasha olasiz? | Bitta tanlov |
| 11 | Nima uchun Media & AI yo‘nalishida shogird bo‘lishni xohlaysiz…? | Matn, 30–1000 belgi |
| 12 | Qaysi media yo‘nalishlari sizni ko‘proq qiziqtiradi? | Ko'p tanlov, kamida 1 ta |
| 13 | Media yoki kontent yaratish bo‘yicha tajribangiz qanday? | Bitta tanlov |
| 14 | Avval yaratgan ishlaringiz, portfolio yoki loyihalaringiz havolasini yuboring. | “Havola yuboraman” (keyin havola) yoki “Portfolio yo‘q” |
| 15 | Sun’iy intellekt vositalaridan qanday maqsadlarda foydalangansiz? | Bitta tanlov |
| 16 | Qaysi AI vositalaridan foydalangansiz yoki ular bilan tanishsiz? | Ko'p tanlov; “Hozircha hech qaysisini bilmayman” boshqalari bilan birga tanlanmaydi |
| 17 | AI yordamida qaysi ko‘nikmalarni rivojlantirmoqchisiz? | Ko'p tanlov; “Barchasini bosqichma-bosqich o‘rganish” boshqalari bilan birga tanlanmaydi |
| 18 | Amaliy topshiriqlarni bajarish va o‘rganish uchun qanday qurilmalardan foydalana olasiz? | Bitta tanlov |
| 19 | Ushbu dastur davomida keyingi 3 oy ichida qanday aniq natijaga erishmoqchisiz? | Matn, 20–1000 belgi |
| 20 | Belgilangan muddatlarda amaliy topshiriqlarni bajarish… tayyormisiz? | Bitta tanlov (ikkala javob ham qabul qilinadi) |
| 21 | Siz uchun qaysi ishlash uslubi qulayroq? | Bitta tanlov |

Savollar va variantlar matni `src/services/questionnaire.ts` faylida.

## 8. Anketa qoidalari

- Har bir savolga **bir marta** javob beriladi. Qabul qilingan javobni o'zgartirib bo'lmaydi.
- **Orqaga**, **tahrirlash** va **bekor qilish** tugmalari yo'q. `/start` anketani qaytadan boshlamaydi — joriy savolni qayta ko'rsatadi.
- Variantli savollarda: variant tanlanadi (ko'p tanlovda belgilanadi), keyin “➡️ Keyingi” bosiladi. “Keyingi” faqat tanlov to'g'ri bo'lganda chiqadi.
- Matnli savollarda javob tekshiruvdan o'tishi bilan qabul qilinadi.
- “Boshqa.” tanlansa, izoh yozilmaguncha keyingi savolga o'tilmaydi. Izoh va asosiy javob birga saqlanadi.
- 6-savolda “Faqat universitetda tahsil olaman.” tanlansa, 7-savol so'ralmaydi va avtomatik “Hozir ishlamayman.” deb yoziladi.
- Telefon: kontakt boshqa odamniki bo'lsa, rad etiladi va qayta yuborish mumkin. Kontakt raqami qo'lda kiritilgan raqamdan farq qilsa, bot ikkala raqamni ko'rsatadi va “✅ Tasdiqlayman” tugmasisiz davom etmaydi.
- Eski xabarlardagi tugmalar ishlamaydi (“Bu savolga javob berib bo‘lingan.”).
- Bir vaqtda kelgan xabarlar navbat bilan bajariladi: birinchi to'g'ri javob qabul qilinadi.
- Javob avval diskdagi sessiyaga yoziladi, keyin keyingi savol beriladi. Yozib bo'lmasa, javob qabul qilinmagan hisoblanadi va qayta yuborish so'raladi.

### Yakunlash

21-savolga javob berilgach, bot:

1. Barcha javoblarni server tomonida qayta tekshiradi;
2. Majburiy maydonlar to'liqligini tekshiradi;
3. Foydalanuvchi avval anketa topshirmaganini tekshiradi (Telegram ID bo'yicha);
4. Ikkala kanalga obunani qayta tekshiradi;
5. Google Sheets'ga yozadi;
6. Faqat shundan keyin anketani yakunlangan deb belgilaydi;
7. Muvaffaqiyat xabarini yuboradi.

Sheets vaqtincha ishlamasa, javoblar saqlanib qoladi va “🔁 Qayta urinish” tugmasi chiqadi. Qayta urinish dublikat yaratmaydi.

## 9. Admin buyruqlari

- `/admin` — admin menyusi: statistika, jami, bugungi, oxirgi anketalar, Google Sheets holati, bot holati.
- `/stats` — statistika: jami, bugun, 7 kun, 30 kun (Asia/Tashkent bo'yicha).

Oxirgi anketalar ro'yxatida telefon yashirilgan holda ko'rsatiladi (`+99890*****67`). Admin bo'lmagan foydalanuvchi bu buyruqlarni yozsa, “Noma’lum buyruq” javobini oladi. Admin ekanligi faqat server tomonida, `ADMIN_IDS` bo'yicha tekshiriladi.

## 10. Deploy

### Render

Render web servisi HTTP portni tinglashi kerak. `PORT` ni Render o'zi beradi; bot shu portda `ok` javobini qaytaradi va uxlab qolmaslik uchun o'z manziliga vaqti-vaqti bilan murojaat qiladi.

1. **New → Web Service** → shu repozitoriya.
2. **Root Directory:** `registration-bot`
3. **Build Command:** `npm ci && npm run build`
4. **Start Command:** `npm start`
5. **Environment:** `.env.example` dagi qiymatlar, `GOOGLE_SHEET_NAME=Media_AI`, `NODE_VERSION=22`.
6. Logs'da `Bot ishga tushdi (polling)` chiqishi kerak.

> Bepul tarifda disk vaqtinchalik: qayta deploy yoki sozlamalarni o'zgartirish `data/sessions.json` ni o'chiradi. Shuning uchun tugallanmagan anketalar Google Sheets'dagi **`Media_AI_sessions`** varag'ida ham saqlanadi (har 5 soniyada va to'xtashdan oldin) va bot ishga tushganda shu yerdan tiklanadi. Bu varaqni o'chirmang va tahrirlamang.

### VPS (PM2)

```bash
npm i -g pm2
cd /opt/kiu-media-ai-bot && npm ci && npm run build
pm2 start dist/index.js --name kiu-media-ai-bot --time
pm2 save && pm2 startup
```

### VPS (systemd)

```ini
[Unit]
Description=KIU Media & AI bot
After=network-online.target

[Service]
WorkingDirectory=/opt/kiu-media-ai-bot
EnvironmentFile=/opt/kiu-media-ai-bot/.env
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=5
User=botuser

[Install]
WantedBy=multi-user.target
```

### Docker

```bash
docker build -t kiu-media-ai-bot .
docker run -d --name kiu-media-ai --restart unless-stopped \
  --env-file .env -v kiu-media-ai-data:/app/data kiu-media-ai-bot
```

`/app/data` volume'ida sessiyalar va instance qulfi saqlanadi.

## 11. Ishonchlilik va xavfsizlik

- **Bitta instance.** `data/bot.lock` fayli ikkinchi nusxani to'xtatadi. Bir token bilan ikki server ishlamasin.
- **Dublikatdan himoya.** Yozishdan oldin Telegram ID bo'yicha tekshiriladi. Yozish noaniq xato bersa, qator yozilganmi-yo'qmi qayta tekshiriladi. Yozish (append) qayta urinilmaydi — faqat o'qish (429/5xx).
- **Formula himoyasi.** Ma'lumot `RAW` rejimida yoziladi; `=`, `+`, `-`, `@` bilan boshlanuvchi matnlar oldiga `'` qo'yiladi.
- **Sirlar.** Token va kalitlar kodda yo'q, faqat `.env`/hosting sozlamalarida. `.env` va JSON kalit fayllari Git'ga qo'shilmaydi. Loglarda sirlar `[REDACTED]` bilan almashtiriladi.
- **Shaxsiy ma'lumot.** Telefon raqamlari logga yozilmaydi; foydalanuvchi ID'si xeshlanadi. Ma'lumotlar faqat anketani ko'rib chiqish va bog'lanish uchun ishlatiladi.
- **Sessiya fayli.** `data/sessions.json` — atomik yoziladi (tmp + rename), huquqi `600`. Zaxira nusxasi `<GOOGLE_SHEET_NAME>_sessions` varag'ida (shaxsiy ma'lumot bor — jadvalni faqat kerakli odamlarga ulashing).
- **HTML.** Foydalanuvchi matnlari xabarlarda escape qilinadi. Tugma ma'lumotlari va foydalanuvchi ID'si server tomonida tekshiriladi.
- **Ko'p foydalanuvchi.** Har bir xabar fonda bajariladi — sekin Google so'rovi boshqa foydalanuvchilarni kutdirmaydi; bitta foydalanuvchining xabarlari esa navbat bilan. Anketalar ro'yxati 30 soniya keshlanadi va bir vaqtdagi so'rovlar bitta o'qishga birlashadi (Google Sheets kvotasi daqiqasiga ~60 so'rov). Sessiyalar zaxirasi 10 soniyada bir marta, bitta paket bilan yoziladi. Testda 100 kishi bir vaqtda to'ldirganda har biri bir marta yozildi.
- **Spam.** Foydalanuvchi 10 soniyada 30 tadan ortiq yangilanish yubora olmaydi. 4000 belgidan uzun xabar rad etiladi.

## 12. Muammolarni hal qilish

- `Obuna tekshiruvi xatosi` — botni kanalga admin qiling yoki kanal ID'sini tekshiring.
- `GOOGLE_PRIVATE_KEY o'qib bo'lmadi` / `DECODER routines::unsupported` — kalit noto'g'ri nusxalangan. `GOOGLE_SERVICE_ACCOUNT_JSON` usulidan foydalaning.
- `403 The caller does not have permission` — jadval service account emailiga **Editor** huquqi bilan ulashilmagan yoki `GOOGLE_SPREADSHEET_ID` boshqa faylniki.
- `varag'ining N-ustun sarlavhasi mos emas` — varaqda boshqa sarlavhalar bor. Yangi `GOOGLE_SHEET_NAME` bering.
- `Anketani saqlashda xato` — foydalanuvchiga “🔁 Qayta urinish” tugmasi ko'rsatiladi, javoblar yo'qolmaydi.

## 13. Cheklovlar

- Dublikat tekshiruvi varaqni o'qiydi: bir necha ming yozuvgacha yaxshi ishlaydi.
- Bot bitta serverda ishlashi kerak. Zaxira nusxasi bir necha soniya kechikadi: server to'satdan o'chsa, oxirgi javob qayta so'ralishi mumkin.
- Telefon raqami faqat O'zbekiston formatida (`+998`) qabul qilinadi.
- Avvalgi ro'yxatdan o'tish versiyasidagi tugallanmagan sessiyalar yangi anketaga o'tkazilmaydi.

## 14. Tokenlarni almashtirish

Token yoki kalit sizib ketgan bo'lsa:

1. @BotFather → `/mybots` → bot → **API Token** → **Revoke current token**, yangi tokenni `.env` ga yozing.
2. Google Cloud → service account → **Keys**: eski kalitni o'chiring, yangi JSON kalit yarating va `.env` ga yozing.
3. Botni qayta ishga tushiring.
