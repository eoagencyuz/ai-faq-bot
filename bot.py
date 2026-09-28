"""
Telegram AI FAQ bot — Gemini (bepul) + Render (webhook).
FAQ matnini faq.txt fayliga yozing — bot faqat shundan javob beradi.
"""
import os
import requests
from flask import Flask, request

TELEGRAM_TOKEN = os.environ["TELEGRAM_TOKEN"]
GEMINI_API_KEY = os.environ["GEMINI_API_KEY"]
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-flash-latest")
ADMIN_CONTACT = os.environ.get("ADMIN_CONTACT", "administrator")

TG_API = f"https://api.telegram.org/bot{TELEGRAM_TOKEN}"
GEMINI_URL = (
    f"https://generativelanguage.googleapis.com/v1beta/models/"
    f"{GEMINI_MODEL}:generateContent"
)

with open(os.path.join(os.path.dirname(__file__), "faq.txt"), encoding="utf-8") as f:
    FAQ = f.read()

SYSTEM_PROMPT = f"""Sen yordamchi botsan. Foydalanuvchi savollariga FAQAT quyidagi FAQ ma'lumotlari asosida javob ber.
Qoidalar:
- Foydalanuvchi qaysi tilda yozsa (o'zbek, rus, ingliz), o'sha tilda javob ber.
- Javob qisqa, aniq va samimiy bo'lsin.
- Agar javob FAQ'da bo'lmasa, o'ylab topma. "Bu savol bo'yicha aniq ma'lumotim yo'q, iltimos {ADMIN_CONTACT} bilan bog'laning" deb yoz.
- Narx, sana, raqamlarni faqat FAQ'dagidek yoz.

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
        "generationConfig": {"temperature": 0.3, "maxOutputTokens": 800},
    }
    try:
        r = requests.post(GEMINI_URL, json=body, headers={"x-goog-api-key": GEMINI_API_KEY}, timeout=40)
        r.raise_for_status()
        answer = r.json()["candidates"][0]["content"]["parts"][0]["text"]
    except Exception as e:
        resp = getattr(e, "response", None)
        print("Gemini xato:", resp.status_code if resp is not None else type(e).__name__,
              resp.text[:500] if resp is not None else "")
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
