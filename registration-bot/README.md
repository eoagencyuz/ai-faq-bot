# KIU ro'yxatdan o'tish boti

Telegram bot orqali ro'yxatdan o'tish. Foydalanuvchi ikkita kanalga obuna bo'ladi, ma'lumotlarini bot orqali kiritadi va ular **Google Sheets**'ga yoziladi. Web-sayt yo'q — hamma amal Telegram ichida bajariladi.

## Xususiyatlar

- `/start` — kanallarga majburiy obuna. Obuna Telegram API orqali **har safar server tomonida** tekshiriladi, tugma bosilishi bilan emas.
- Ma'lumotlar bittadan so'raladi: ism, familiya, telefon (kontakt tugmasi yoki qo'lda), tug'ilgan sana, jins, viloyat, tuman, qo'shimcha ma'lumot. Har bir maydonni `.env` orqali yoqish yoki o'chirish mumkin.
- Orqaga, bekor qilish, tahrirlash, yakuniy tasdiqlash.
- Tugallanmagan jarayon server qayta ishga tushganda tiklanadi.
- Takroriy ro'yxatdan o'tish yo'q: bir Telegram akkaunt uchun bitta yozuv.
- Admin buyruqlari: `/admin`, `/stats`.

---

## 1. Talablar

- Node.js **22** yoki yangiroq
- Telegram akkaunt, BotFather orqali bot
- Google akkaunt va Google Cloud loyihasi
- VPS yoki Docker (ixtiyoriy)

## 2. Telegram bot yaratish

1. Telegram'da **@BotFather** ni oching va `/newbot` buyrug'ini yuboring.
2. Bot nomi va username'ni kiriting.
3. BotFather bergan **tokenni** nusxalang. Uni hech kimga, kodga yoki GitHub'ga yozmang.

> Bu bot **alohida** bot bo'lishi kerak. Mavjud bot (masalan, @yakubovsschoolbot) bilan bitta tokenni ikkala joyda ishlatmang: ular bir-biriga xalaqit beradi.

## 3. Kanallarni tayyorlash va botni admin qilish

Obunani tekshirish uchun bot **ikkala kanalda ham administrator** bo'lishi shart.

1. Ikkala kanal uchun ochiq (public) kanal username'ini belgilang, masalan `@kanal_bir`. Havola `https://t.me/kanal_bir` bo'ladi.
2. Kanal sozlamalari → **Administrators** → **Add Administrator** → botni tanlang.
3. Kerakli huquq: kamida **"Ko'rish"** (oddiy a'zolikni ko'rish). Xabar yuborish huquqi shart emas.

**Yopiq (private) kanal bo'lsa:** username bo'lmaydi. U holda kanal ID'sini oling (`-100...` ko'rinishida). Buning uchun kanalga vaqtincha **@RawDataBot** ni qo'shib, u ko'rsatgan `chat.id` ni oling va botni chiqarib tashlang. Havola sifatida kanalning invite havolasini (`https://t.me/+...`) yozing. Eslatma: havola `https://t.me/` bilan boshlanishi kerak, aks holda konfiguratsiya tekshiruvi rad etadi.

**Kanal ID'sini tekshirish:** bot kanalda admin bo'lsa, `getChatMember` ishlaydi. Admin bo'lmasa, xato "Bad Request: chat not found" yoki "not enough rights" chiqadi va bot foydalanuvchini obuna bo'lmagan deb emas, **vaqtinchalik xato** deb hisoblaydi.

## 4. Google Sheets va service account

1. [console.cloud.google.com](https://console.cloud.google.com) da yangi loyiha yarating.
2. **APIs & Services → Library** → **Google Sheets API** ni yoqing.
3. **APIs & Services → Credentials → Create credentials → Service account**. Nom bering va yarating.
4. Yaratilgan service account'ni oching → **Keys → Add key → Create new key → JSON**. Fayl yuklanadi.
5. JSON ichidan ikki qiymatni oling:
   - `client_email` → `GOOGLE_SERVICE_ACCOUNT_EMAIL`
   - `private_key` → `GOOGLE_PRIVATE_KEY` (qatorlar `\n` ko'rinishida qolsa ham bo'ladi)
6. Google Sheets'da yangi jadval yarating. Brauzer manzilidagi `/d/` va `/edit` orasidagi uzun ID → `GOOGLE_SPREADSHEET_ID`.
7. Jadvalni **Share** qiling. `client_email` ni **Editor** (muharrir) huquqi bilan qo'shing.

Bot birinchi ishga tushganda varaq (`GOOGLE_SHEET_NAME`, standart `Registrations`) yo'q bo'lsa yaratadi va 14 ta sarlavhani yozadi. Sarlavhalar boshqacha bo'lsa, bot ishga tushmaydi — ma'lumot noto'g'ri ustunga tushib qolmasligi uchun.

Ustunlar tartibi: `ID`, `Created At`, `Telegram User ID`, `Telegram Username`, `First Name`, `Last Name`, `Phone`, `Birth Date`, `Gender`, `Region`, `District`, `Additional Info`, `Subscription Verified`, `Registration Status`.

## 5. Konfiguratsiya

```bash
cp .env.example .env
```

`.env` faylini to'ldiring. Muhim qiymatlar:

| O'zgaruvchi | Majburiy | Tavsif |
|---|---|---|
| `BOT_TOKEN` | ha | BotFather tokeni |
| `CHANNEL_1_ID`, `CHANNEL_2_ID` | ha | `@username` yoki `-100...` ID |
| `CHANNEL_1_URL`, `CHANNEL_2_URL` | ha | `https://t.me/...` havolalari |
| `CHANNEL_1_NAME`, `CHANNEL_2_NAME` | yo'q | Tugmalarda chiqadigan nom |
| `GOOGLE_SPREADSHEET_ID` | ha | Jadval ID'si |
| `GOOGLE_SHEET_NAME` | yo'q | Varaq nomi, standart `Registrations` |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | ha | Service account emaili |
| `GOOGLE_PRIVATE_KEY` | ha | Service account private key |
| `ADMIN_IDS` | ha | Admin Telegram ID lari, vergul bilan: `111,222` |
| `TIMEZONE` | yo'q | Standart `Asia/Tashkent` |
| `SESSION_TTL_HOURS` | yo'q | Tugallanmagan jarayon necha soat saqlanadi, standart 24 |
| `SESSION_FILE` | yo'q | Sessiya fayli, standart `./data/sessions.json` |
| `REGISTRATION_FIELDS` | yo'q | Yoqilgan maydonlar. `first_name` va `phone` doim yoqilgan |
| `REGIONS_JSON` | yo'q | Viloyat va tumanlar ro'yxati. Bo'sh bo'lsa, matn yoziladi |

Noto'g'ri yoki yetishmayotgan qiymat bo'lsa, bot ishga tushmaydi va qaysi o'zgaruvchi noto'g'ri ekanini aytadi. Qiymatlarning o'zi logga yozilmaydi.

### Viloyat va tumanlar (ixtiyoriy)

```env
REGIONS_JSON={"Qashqadaryo":["Qarshi","Shahrisabz","Kitob"],"Toshkent":["Yunusobod","Chilonzor"]}
```

## 6. O'rnatish va ishga tushirish

```bash
npm ci              # bog'liqliklarni o'rnatish
npm run typecheck   # tiplarni tekshirish
npm test            # testlar (haqiqiy Telegram yoki Google talab qilmaydi)
npm run build       # dist/ ga kompilyatsiya
npm start           # ishga tushirish (polling)
```

Lokal sinash uchun: `npm run dev`.

## 7. Admin buyruqlari

- `/admin` — admin menyusi: statistika, jami, bugungi, oxirgi ro'yxatdan o'tganlar, Google Sheets holati, bot holati.
- `/stats` — to'liq statistika: jami, bugun, 7 kun, 30 kun.

Admin bo'lmagan foydalanuvchi bu buyruqlarni yozsa, "Noma'lum buyruq" javobini oladi. Admin ekanligi faqat server tomonida, `ADMIN_IDS` bo'yicha tekshiriladi.

## 8. VPS'ga deploy qilish

### Variant A: PM2

```bash
npm i -g pm2
cd /opt/kiu-registration-bot && npm ci && npm run build
pm2 start dist/index.js --name kiu-registration-bot --time
pm2 save && pm2 startup
```

`pm2 logs kiu-registration-bot` bilan loglarni ko'rasiz. Qayta ishga tushirish: `pm2 restart kiu-registration-bot`.

### Variant B: systemd

`/etc/systemd/system/kiu-registration-bot.service`:

```ini
[Unit]
Description=KIU registration bot
After=network-online.target
Wants=network-online.target

[Service]
WorkingDirectory=/opt/kiu-registration-bot
EnvironmentFile=/opt/kiu-registration-bot/.env
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=5
User=botuser

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now kiu-registration-bot
journalctl -u kiu-registration-bot -f
```

`Restart=always` yoki PM2 vaqtinchalik xatodan keyin botni qaytaradi. Konfiguratsiya xatosi bo'lsa, bot har bir urinishda to'xtaydi va loglarda sababini yozadi. `.env` ni tuzatgach, servis o'zi ishga tushadi (yoki `restart` qiling).

### Variant C: Docker

```bash
docker build -t kiu-registration-bot .
docker run -d --name kiu-reg --restart unless-stopped \
  --env-file .env -v kiu-reg-data:/app/data kiu-registration-bot
```

`/app/data` volume'da saqlanadi: sessiyalar va instance qulfi shu yerda. Volume'ni o'chirmang.

## 9. Ishonchlilik va xavfsizlik

- **Bitta instance.** Polling rejimida `data/bot.lock` fayli ikkinchi nusxani to'xtatadi. Ikki server bitta tokenda ishlamasin.
- **Dublikatdan himoya.** Saqlashdan oldin jadvalda shu Telegram ID bor-yo'qligi tekshiriladi. Yozish noaniq xato bersa, qator aslida yozilganmi-yo'qmi tekshiriladi va qayta qo'shilmaydi.
- **Qayta urinish.** Faqat o'qish va sozlash chaqiruvlari qayta uriniladi (429 va 5xx). Yozish qayta urinilmaydi, shunda dublikat chiqmaydi.
- **Formula himoyasi.** Matnlar `=`, `+`, `-`, `@` bilan boshlansa, Sheets ularni formula sifatida bajarmasligi uchun oldiga `'` qo'yiladi. Telefon `RAW` rejimida matn sifatida yoziladi.
- **Sirlar.** Token va private key loglarda `[REDACTED]` bilan almashtiriladi. Xato matnida ham.
- **Sessiya fayli.** `data/sessions.json` shaxsiy ma'lumot saqlaydi. Fayl huquqi `600`. Muddati o'tgan jarayonlar `SESSION_TTL_HOURS` dan keyin o'chiriladi.
- **Spam.** Foydalanuvchi 10 soniyada 20 tadan ortiq yangilanish yubora olmaydi. 1000 belgidan uzun xabar rad etiladi.
- **Maxfiylik.** Foydalanuvchi `/start` da ma'lumot nima maqsadda yig'ilishini ko'radi. Admin statistikada telefonning faqat oxirgi 4 raqamini ko'radi.

## 10. Ma'lumotlarni tekshirish

Jadvalda har bir yangi ro'yxatdan o'tgan odam uchun qator paydo bo'ladi. `Subscription Verified` ustuni `Ha`, `Registration Status` — `Yakunlandi` bo'ladi.

Muammo bo'lsa, loglarni tekshiring:

- `Obuna tekshiruvi xatosi` — botni kanalga admin qiling yoki kanal ID'sini tekshiring.
- `Google Sheets'ga ulanib bo'lmadi` — service account emaili jadvalga ulanganmi, Sheets API yoqilganmi.
- `Ro'yxatga yozishda xato` — foydalanuvchiga "🔁 Qayta urinish" tugmasi ko'rsatiladi. Ma'lumot yo'qolmaydi.

## 11. Ma'lum cheklovlar

- Dublikat tekshiruvi jadvalni o'qiydi. Bir necha ming yozuvgacha yaxshi ishlaydi. Undan ko'p bo'lsa, Google Sheets o'rniga haqiqiy ma'lumotlar bazasiga o'tish kerak.
- Sessiyalar bitta fayl orqali saqlanadi, Google Sheets'da "Sessions" varag'i ishlatilmaydi. Shu sababli bot faqat bitta serverda ishlashi kerak.
- Veb-forma yo'q, admin panel ham faqat Telegram ichida.
- Viloyat va tuman ro'yxatlari `REGIONS_JSON` orqali boshqariladi: o'zgartirish uchun botni qayta ishga tushirish kerak.
- Telefon raqami faqat O'zbekiston formatida (`+998`) qabul qilinadi.

## 12. Tokenlarni almashtirish

Token sizib ketgan bo'lsa:

1. @BotFather → `/mybots` → bot → **API Token** → **Revoke current token**.
2. Yangi tokenni `.env` ga yozing.
3. Jarayonni qayta ishga tushiring (`pm2 restart` yoki `systemctl restart`).

Google service account kalitini ham xuddi shunday: eskisini o'chirib, yangi JSON kalit yarating va `.env` ga yozing.
