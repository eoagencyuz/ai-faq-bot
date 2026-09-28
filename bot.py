"""
Telegram AI FAQ bot — Gemini (bepul) + Render (webhook).
FAQ matnini faq.txt fayliga yozing — bot faqat shundan javob beradi.
"""
import os
import time
import requests
from flask import Flask, request

TELEGRAM_TOKEN = os.environ["TELEGRAM_TOKEN"]
GEMINI_API_KEY = os.environ["GEMINI_API_KEY"]
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-flash-latest")
ADMIN_CONTACT = os.environ.get("ADMIN_CONTACT", "administrator")

TG_API = f"https://api.telegram.org/bot{TELEGRAM_TOKEN}"
GEMINI_MODELS = [GEMINI_MODEL, "gemini-flash-lite-latest", "gemini-2.0-flash"]
GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent"

with open(os.path.join(os.path.dirname(__file__), "faq.txt"), encoding="utf-8") as f:
    FAQ = f.read()

SYSTEM_PROMPT = f"""Sen Qarshi Xalqaro Universiteti (KIU) qabul bo'limining xushmuomala maslahatchisisan. Telegram'da abituriyentlar va ota-onalar bilan yozishasan.

Qanday yozish kerak:
- Oddiy odamdek, jonli va samimiy yoz: qisqa gaplar, kerak bo'lsa bitta emoji. Rasmiy robot tilidan qoch, "Men botman", "AI modelman", "FAQ bo'yicha" kabi iboralarni ishlatma.
- Foydalanuvchi qaysi tilda yozsa (o'zbek, rus, ingliz), o'sha tilda javob ber.
- Salomlashish, rahmat, hazil, umumiy gaplarga tabiiy javob ber.
- Universitet haqidagi savollarga quyidagi ma'lumotlar asosida javob ber. Narx, sana, raqamlarni faqat shu ma'lumotdagidek yoz, o'zingdan to'qima.
- Ma'lumotda yo'q, lekin umumiy savollar bo'lsa (kasb tanlash, o'qish, imtihonga tayyorlanish, yo'nalish qanday kasb va h.k.), o'z bilimingdan foydali javob ber.
- KIU haqida aniq ma'lumot yo'q bo'lsa (masalan grant, yotoqxona), taxmin qilma: "Buni aniqlashtirib olish kerak, {ADMIN_CONTACT} raqamiga qo'ng'iroq qilsangiz, to'liq tushuntirib berishadi" de.
- Suhbatni iloji bo'lsa qabulga yo'naltir: qiziqqan yo'nalishini so'ra, qabul.kiu.uz orqali ariza topshirishni taklif qil.
- Agar kimdir jiddiy so'rasa "Siz botmisiz / sun'iy intellektmisiz?", yolg'on gapirma: "Men KIU qabul bo'limining AI yordamchisiman, kerak bo'lsa sizni xodimlarimiz bilan bog'lab qo'yaman" deb ayt.

=== FAQ ===
{FAQ}
=== FAQ tugadi ==="""

# Har bir chat uchun oxirgi bir necha xabar (kontekst uchun)
history: dict[int, list] = {}
MAX_HISTORY = 6

app = Flask(__name__)


def ask_gemini(chat_id: int, text: str) -> str:
    msgs = history.setdefault(chat_id, [])
    msgs.append({"role": "user", "parts": [{"text": text}]})
    del msgs[:-MAX_HISTORY]
    body = {
        "system_instruction": {"parts": [{"text": SYSTEM_PROMPT}]},
        "contents": msgs,
        "generationConfig": {"temperature": 0.7, "maxOutputTokens": 800},
    }
    answer = None
    for attempt in range(2):
        for model in GEMINI_MODELS:
            try:
                r = requests.post(GEMINI_URL.format(model), json=body,
                                  headers={"x-goog-api-key": GEMINI_API_KEY}, timeout=40)
                if r.status_code != 200:
                    print("Gemini xato:", model, r.status_code, r.text[:300])
                    continue
                answer = r.json()["candidates"][0]["content"]["parts"][0]["text"]
                break
            except Exception as e:
                print("Gemini xato:", model, type(e).__name__)
        if answer:
            break
        time.sleep(2)
    if not answer:
        msgs.pop()
        return "Kechirasiz, hozir javob bera olmayapman. Birozdan so'ng qayta urinib ko'ring."
    msgs.append({"role": "model", "parts": [{"text": answer}]})
    return answer


def send(chat_id: int, text: str):
    requests.post(f"{TG_API}/sendMessage", json={"chat_id": chat_id, "text": text[:4000]}, timeout=20)


@app.get("/")
def health():
    return "Bot ishlayapti ✅"


@app.post(f"/webhook/{TELEGRAM_TOKEN}")
def webhook():
    update = request.get_json(silent=True) or {}
    msg = update.get("message") or {}
    chat_id = msg.get("chat", {}).get("id")
    text = msg.get("text")
    if not chat_id or not text:
        return "ok"
    if text.startswith("/start"):
        history.pop(chat_id, None)
        send(chat_id, "Assalomu alaykum! 👋 Savolingizni yozing, javob beraman.")
        return "ok"
    requests.post(f"{TG_API}/sendChatAction", json={"chat_id": chat_id, "action": "typing"}, timeout=10)
    send(chat_id, ask_gemini(chat_id, text))
    return "ok"


@app.get("/set-webhook")
def set_webhook():
    base = os.environ.get("RENDER_EXTERNAL_URL") or request.host_url.rstrip("/")
    r = requests.get(f"{TG_API}/setWebhook", params={"url": f"{base}/webhook/{TELEGRAM_TOKEN}"}, timeout=20)
    return r.text


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 8000)))
