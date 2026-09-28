# KIU AI FAQ bot

Qarshi Xalqaro Universiteti (KIU) qabul bo'limi uchun Telegram bot. Javoblarni Gemini AI `faq.txt` asosida yozadi.

## Imkoniyatlar
- O'zbek, rus va ingliz tillarida tabiiy javoblar (suhbat konteksti saqlanadi)
- Menyu tugmalari: yo'nalishlar va narxlar, qabul tartibi, aloqa, ariza topshirish
- Buyruqlar: `/start`, `/apply`, `/contact`, `/help`
- Javoblar formatlangan (qalin matn, ro'yxatlar), uzun javoblar bo'lib yuboriladi
- Webhook darhol javob qaytaradi, shuning uchun takroriy javoblar bo'lmaydi
- Spamdan himoya (30 soniyada 5 ta xabar), faqat shaxsiy chatlarda ishlaydi
- Gemini modellari ishlamay qolsa, boshqa modelga o'tadi

## O'rnatish (Render)
1. Build: `pip install -r requirements.txt`
2. Start: `gunicorn bot:app --workers 1 --threads 8 --timeout 120`
3. Environment o'zgaruvchilari:

| O'zgaruvchi | Majburiy | Tavsif |
|---|---|---|
| `TELEGRAM_TOKEN` | ha | @BotFather'dan olingan token |
| `GEMINI_API_KEY` | ha | Google AI Studio kaliti |
| `GEMINI_MODEL` | yo'q | Standart: `gemini-flash-latest` |
| `ADMIN_CONTACT` | yo'q | Operator telefoni (standart: +998 55 500 99 44) |
| `WEBHOOK_SECRET` | tavsiya | Webhook'ni himoyalash uchun maxfiy so'z (A-Z, a-z, 0-9, `_`, `-`) |
| `ADMIN_CHAT_ID` | yo'q | Yangi foydalanuvchilar haqida xabar oladigan chat ID |

4. Deploydan so'ng bir marta `https://<sizning-domen>/set-webhook` sahifasini oching — webhook va bot menyusi o'rnatiladi.

## FAQ'ni yangilash
`faq.txt` faylini tahrirlang va qayta deploy qiling.
