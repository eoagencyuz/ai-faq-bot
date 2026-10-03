# KIU AI bot

Qarshi Xalqaro Universiteti (KIU) qabul bo'limi uchun Telegram bot. Javoblarni Gemini AI `faq.txt` asosida yozadi.

## Imkoniyatlar

**Abituriyentlar uchun**
- 🤖 AI suhbat: o'zbek, rus va ingliz tillarida. Bot suhbat kontekstini eslab qoladi.
- 🎤 Ovozli xabarlarni tushunadi. 🖼 Rasm va PDF hujjatlarni (diplom, sertifikat, skrinshot) tahlil qiladi.
- 🧭 Yo'nalish tanlash testi: 4 ta savol asosida mos yo'nalish, muddat va narxni tavsiya qiladi.
- 📝 Ariza qoldirish: ism, telefon (kontakt tugmasi orqali) va yo'nalishni oladi. Ariza darhol admin guruhga boradi.
- 👨‍💼 Operator bilan jonli chat: foydalanuvchi xabarlari admin guruhga boradi, operator javobi foydalanuvchiga qaytadi.
- Menyu tugmalari va buyruqlar: `/start`, `/quiz`, `/lead`, `/operator`, `/apply`, `/contact`, `/help`.

**Ro'yxatdan o'tish:** `/start` bosilganda foydalanuvchi ism-familiya va telefon raqamini kiritadi (kontakt tugmasi orqali, faqat o'z raqami). Shundan keyingina bot ishlaydi. Ma'lumotlar admin guruhga yuboriladi, ariza qoldirishda esa qayta so'ralmaydi.

**Admin guruhni ulash:** botni Telegram guruhga qo'shing. Bot guruh ID'sini o'zi yozib beradi (yoki guruhda `/id` yozing). Shu ID'ni Render'dagi `ADMIN_CHAT_ID` ga yozing.

**Adminlar uchun** (admin guruhda)
- `/stats`: foydalanuvchilar, faollik va arizalar statistikasi.
- `/leads`: oxirgi 10 ta ariza.
- `/export`: arizalar va ro'yxatdan o'tganlar ro'yxati, Excel'da ochiladigan CSV fayl.
- `/broadcast matn` (yoki biror xabarga reply qilib `/broadcast`): barcha foydalanuvchilarga xabar yuboradi.
- Ariza kartasiga yoki foydalanuvchining forward qilingan xabariga **reply** qilinsa, javob foydalanuvchiga yetib boradi.

**📚 Bilim bazasini boyitish** (deploysiz, admin guruhdan)
- `/addinfo matn`: bazaga yangi ma'lumot qo'shadi. Matnli xabarga reply qilib `/addinfo` yozsa ham bo'ladi. Bot darhol shu ma'lumot bilan javob bera boshlaydi.
- `/info`: qo'shilgan ma'lumotlar ro'yxati. `/delinfo raqam` bilan o'chiriladi.
- `/gaps`: bot aniq javob bera olmagan savollar, qaysi biri necha marta so'ralgani bilan. Bazaga nima qo'shish kerakligini shu ro'yxat ko'rsatadi.
- `/addinfo` bilan qo'shilgan ma'lumotlar bazada saqlanadi. Render'ning bepul tarifida ular deployda o'chib ketadi, shuning uchun muhim ma'lumotlarni vaqti-vaqti bilan `faq.txt` ga ham ko'chirib qo'ying.

**Texnik tomoni**
- Webhook Telegram'ga darhol javob qaytaradi, shuning uchun takroriy javoblar bo'lmaydi.
- Webhook maxfiy token bilan himoyalangan.
- Spamdan himoya bor. Bot faqat shaxsiy chatlarda va admin guruhda ishlaydi.
- Gemini modeli ishlamay qolsa, bot boshqa modelga o'tadi.
- Ma'lumotlar SQLite'da saqlanadi (`db.py`).

## Fayllar
- `bot.py`: webhook, suhbat, ariza, operator, admin buyruqlari.
- `quiz.py`: yo'nalish tanlash testi. Yo'nalishlar va narxlar `faq.txt` dan avtomatik olinadi.
- `db.py`: SQLite ma'lumotlar bazasi.
- `faq.txt`: universitet haqidagi ma'lumotlar.

## O'rnatish (Render)
1. Build: `pip install -r requirements.txt`
2. Start: `gunicorn bot:app --workers 1 --threads 8 --timeout 120`. Worker faqat **1 ta** bo'lishi kerak.
3. Environment o'zgaruvchilari:

| O'zgaruvchi | Majburiy | Tavsif |
|---|---|---|
| `TELEGRAM_TOKEN` | ha | @BotFather'dan olingan token |
| `GEMINI_API_KEY` | ha | Google AI Studio kaliti |
| `ADMIN_CHAT_ID` | tavsiya | Admin guruh ID (masalan `-1001234567890`). Arizalar, operator chat va admin buyruqlari shu guruhda ishlaydi |
| `WEBHOOK_SECRET` | tavsiya | Webhook uchun maxfiy so'z (A-Z, a-z, 0-9, `_`, `-`) |
| `DB_PATH` | tavsiya | Baza fayli yo'li, masalan `/var/data/bot.db` (Render Persistent Disk) |
| `GEMINI_MODEL` | yo'q | Standart: `gemini-flash-latest` |
| `ADMIN_CONTACT` | yo'q | Operator telefoni (standart: +998 55 500 99 44) |
| `NOTIFY_NEW_USERS` | yo'q | `1` bo'lsa, har bir yangi foydalanuvchi haqida admin guruhga xabar keladi |

4. Deploydan so'ng bir marta `https://<sizning-domen>/set-webhook` sahifasini oching. Webhook va bot menyusi o'rnatiladi.

### Admin guruhni sozlash
1. Telegram'da guruh yarating va botni unga qo'shing.
2. Guruh ID'sini bilish uchun guruhga @RawDataBot ni vaqtincha qo'shing. U `chat.id` ni ko'rsatadi, keyin uni guruhdan chiqaring.
3. ID'ni `ADMIN_CHAT_ID` ga yozing va qayta deploy qiling. So'ng `/set-webhook` ni yana bir marta oching.

> ⚠️ Render'ning bepul tarifida disk vaqtinchalik: har deployda baza (arizalar, statistika) o'chib ketadi. Arizalar admin guruhga ham yuboriladi, shuning uchun ular yo'qolmaydi. Statistikani saqlab qolish uchun Persistent Disk ulang va `DB_PATH` ni sozlang.

## FAQ'ni yangilash
`faq.txt` faylini tahrirlang va qayta deploy qiling. Yangi yo'nalish qo'shilsa, u `- 60610400 Nomi — 4 yil — 12 850 000 so'm` formatida bo'lishi kerak, shunda test va ariza menyusiga avtomatik tushadi. Uni testda tavsiya qilish uchun `quiz.py` dagi ballarga ham qo'shing.

## Instagram (Direct va kommentlarga AI javob)
Bot Telegram'dagi AI va bilim bazasidan foydalanib Instagram'da ham javob beradi:
- **Direct:** har bir xabarga AI javob beradi. Xabarda telefon raqam bo'lsa, admin chatga xabar yuboradi.
- **Kommentlar:** post ostiga qisqa ochiq javob yozadi va Direct'ga batafsil javob yuboradi ("private reply"). Spam va haqoratga javob bermaydi.

### Sozlash
1. Instagram akkauntni **Professional (Business yoki Creator)** akkauntga o'tkazing.
2. Instagram ilovasida: **Sozlamalar → Xabarlar va qo'ng'iroqlar → Ulangan vositalar → "Xabarlarga ruxsat berish"** ni yoqing.
3. [developers.facebook.com](https://developers.facebook.com) → **My Apps → Create App** (turi: Business) → **Instagram** mahsulotini qo'shing → **API setup with Instagram login**.
4. **Generate access tokens** bo'limida Instagram akkauntni qo'shing va tokenni nusxalang.
5. **Configure webhooks** bo'limida:
   - Callback URL: `https://<render-domen>/instagram/webhook`
   - Verify token: `kiu-bot-verify` (yoki `IG_VERIFY_TOKEN` ga yozgan so'zingiz)
   - Obuna bo'ladigan maydonlar: `messages`, `comments`
6. Render → **Environment**:

| O'zgaruvchi | Tavsif |
|---|---|
| `IG_ACCESS_TOKEN` | 4-qadamdagi token |
| `IG_APP_SECRET` | App settings → Basic → App secret (webhook imzosini tekshirish uchun) |
| `IG_VERIFY_TOKEN` | ixtiyoriy, standart: `kiu-bot-verify` |
| `IG_COMMENT_REPLIES` | `0` bo'lsa, kommentlarga ochiq javob yozilmaydi |
| `IG_PRIVATE_REPLIES` | `0` bo'lsa, kommentchiga Direct'da javob yuborilmaydi |

7. Meta ilovasini **Live** rejimga o'tkazing. Barcha foydalanuvchilarga javob berish uchun Meta `instagram_business_manage_messages` va `instagram_business_manage_comments` ruxsatlariga **App Review** talab qilishi mumkin.
8. `/status` sahifasida `Instagram: ✅ @akkaunt` chiqishi kerak.

Token taxminan 60 kun amal qiladi. Muddati tugashidan oldin Meta App'da yangi token olib, `IG_ACCESS_TOKEN` ni yangilang.
