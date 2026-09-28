"""
Telegram AI FAQ bot — Gemini (bepul) + Render (webhook).
FAQ matnini faq.txt fayliga yozing — bot faqat shundan javob beradi.
"""
import html
import logging
import os
import re
import threading
import time
from collections import OrderedDict, deque
from concurrent.futures import ThreadPoolExecutor

import requests
from flask import Flask, abort, request

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("kiu-bot")

TELEGRAM_TOKEN = os.environ["TELEGRAM_TOKEN"]
GEMINI_API_KEY = os.environ["GEMINI_API_KEY"]
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-flash-latest")
ADMIN_CONTACT = os.environ.get("ADMIN_CONTACT", "+998 55 500 99 44")
# Ixtiyoriy: webhook so'rovlarini tekshirish uchun maxfiy kalit (A-Z, a-z, 0-9, _ -)
WEBHOOK_SECRET = os.environ.get("WEBHOOK_SECRET", "")
# Ixtiyoriy: yangi foydalanuvchilar haqida xabar oladigan admin chat ID
ADMIN_CHAT_ID = os.environ.get("ADMIN_CHAT_ID", "")
ADMISSION_URL = "https://qabul.kiu.uz"
SITE_URL = "https://kiu.uz"

TG_API = f"https://api.telegram.org/bot{TELEGRAM_TOKEN}"
GEMINI_MODELS = list(dict.fromkeys([GEMINI_MODEL, "gemini-flash-lite-latest", "gemini-2.0-flash"]))
GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent"

with open(os.path.join(os.path.dirname(__file__), "faq.txt"), encoding="utf-8") as f:
    FAQ = f.read()

SYSTEM_PROMPT = f"""Sen Qarshi Xalqaro Universiteti (KIU) qabul bo'limining xushmuomala maslahatchisisan. Telegram'da abituriyentlar va ota-onalar bilan yozishasan.

Qanday yozish kerak:
- Oddiy odamdek, jonli va samimiy yoz: qisqa gaplar, kerak bo'lsa bitta emoji. Rasmiy robot tilidan qoch, "Men botman", "AI modelman", "FAQ bo'yicha" kabi iboralarni ishlatma.
- Foydalanuvchi qaysi tilda yozsa (o'zbek, rus, ingliz), o'sha tilda javob ber.
- Javob qisqa va aniq bo'lsin (odatda 2–6 gap). Ro'yxat kerak bo'lsa "- " bilan boshlanadigan qatorlardan foydalan, muhim so'zlarni **qalin** qil. Jadval va sarlavhalar (#) ishlatma.
- Salomlashish, rahmat, hazil, umumiy gaplarga tabiiy javob ber.
- Universitet haqidagi savollarga quyidagi ma'lumotlar asosida javob ber. Narx, sana, raqamlarni faqat shu ma'lumotdagidek yoz, o'zingdan to'qima.
- Ma'lumotda yo'q, lekin umumiy savollar bo'lsa (kasb tanlash, o'qish, imtihonga tayyorlanish, yo'nalish qanday kasb va h.k.), o'z bilimingdan foydali javob ber.
- KIU haqida aniq ma'lumot yo'q bo'lsa (masalan grant, yotoqxona), taxmin qilma: "Buni aniqlashtirib olish kerak, {ADMIN_CONTACT} raqamiga qo'ng'iroq qilsangiz, to'liq tushuntirib berishadi" de.
- Suhbatni iloji bo'lsa qabulga yo'naltir: qiziqqan yo'nalishini so'ra, {ADMISSION_URL} orqali ariza topshirishni taklif qil.
- Agar kimdir jiddiy so'rasa "Siz botmisiz / sun'iy intellektmisiz?", yolg'on gapirma: "Men KIU qabul bo'limining AI yordamchisiman, kerak bo'lsa sizni xodimlarimiz bilan bog'lab qo'yaman" deb ayt.
- Universitet va ta'limga aloqasi yo'q mavzularda (siyosat, kod yozish, uy vazifasini bajarib berish va h.k.) muloyimlik bilan rad et va suhbatni KIU'ga qaytar.

=== FAQ ===
{FAQ}
=== FAQ tugadi ==="""

# --- Menyu tugmalari ---
BTN_PROGRAMS = "🎓 Yo'nalishlar va narxlar"
BTN_ADMISSION = "📝 Qanday qabul bo'lish"
BTN_CONTACT = "📞 Aloqa va manzil"
BTN_APPLY = "✅ Ariza topshirish"

MAIN_KEYBOARD = {
    "keyboard": [[{"text": BTN_PROGRAMS}, {"text": BTN_ADMISSION}],
                 [{"text": BTN_CONTACT}, {"text": BTN_APPLY}]],
    "resize_keyboard": True,
    "input_field_placeholder": "Savolingizni yozing...",
}

APPLY_BUTTONS = {"inline_keyboard": [[{"text": "📝 Ariza topshirish", "url": ADMISSION_URL}],
                                     [{"text": "🌐 Rasmiy sayt", "url": SITE_URL}]]}

WELCOME_TEXT = (
    "Assalomu alaykum{name}! 👋\n\n"
    "Men <b>Qarshi Xalqaro Universiteti (KIU)</b> qabul bo'limining yordamchisiman.\n"
    "Yo'nalishlar, kontrakt narxlari, qabul tartibi — istalgan savolingizni yozing "
    "yoki pastdagi tugmalardan foydalaning.\n\n"
    "🇷🇺 Можно писать на русском. 🇬🇧 You can write in English."
)

HELP_TEXT = (
    "ℹ️ <b>Bot imkoniyatlari</b>\n\n"
    "- Savolingizni oddiy matn bilan yozing — tezda javob beraman.\n"
    "- /start — suhbatni yangidan boshlash\n"
    "- /contact — aloqa ma'lumotlari\n"
    "- /apply — onlayn ariza topshirish\n\n"
    f"Jonli operator kerak bo'lsa: <b>{html.escape(ADMIN_CONTACT)}</b>"
)

CONTACT_TEXT = (
    "📞 <b>Aloqa</b>\n"
    "Telefon: +998 55 500 99 44\n"
    "Ish vaqti: Dushanba–Shanba, 09:00–20:00\n\n"
    "📍 <b>Manzil</b>\n"
    "1-kampus: Qarshi sh., Bahodir Sherqulov ko'chasi, 7-uy\n"
    "2-kampus: Qarshi sh., Mustaqillik ko'chasi, 71-uy\n\n"
    f"🌐 {SITE_URL}"
)

APPLY_TEXT = (
    "✅ <b>Ariza topshirish juda oson</b>\n\n"
    "1. qabul.kiu.uz saytida telefon raqam bilan ro'yxatdan o'ting (bepul)\n"
    "2. Pasport, ta'lim ma'lumoti va yo'nalishni kiriting\n"
    "3. Imtihon / suhbatdan o'ting\n"
    "4. Natija va shartnoma\n\n"
    "Pastdagi tugma orqali hoziroq boshlang 👇"
)

# Tugma bosilganda Gemini'ga yuboriladigan savol
BUTTON_QUESTIONS = {
    BTN_PROGRAMS: "Qanday ta'lim yo'nalishlari bor va kontrakt narxlari qancha?",
    BTN_ADMISSION: "Universitetga qanday qabul bo'lish mumkin? Qadamlarni tushuntiring.",
}

ERROR_TEXT = (
    "Kechirasiz, hozir javob bera olmayapman 😔 Birozdan so'ng qayta urinib ko'ring "
    f"yoki {ADMIN_CONTACT} raqamiga qo'ng'iroq qiling."
)
NON_TEXT_TEXT = "Hozircha faqat matnli xabarlarni tushunaman 🙂 Savolingizni yozib yuboring."
RATE_LIMIT_TEXT = "Biroz sekinroq 🙂 Bir necha soniyadan so'ng yozing."

# --- Holat (xotirada) ---
MAX_HISTORY = 10          # har bir chat uchun oxirgi xabarlar soni
MAX_CHATS = 2000          # xotirada saqlanadigan chatlar soni
MAX_INPUT_CHARS = 1500    # foydalanuvchi xabarining maksimal uzunligi
RATE_LIMIT = (5, 30)      # 30 soniyada ko'pi bilan 5 ta xabar

history: "OrderedDict[int, list]" = OrderedDict()
seen_updates: "OrderedDict[int, None]" = OrderedDict()
user_hits: dict[int, deque] = {}
chat_locks: dict[int, threading.Lock] = {}
state_lock = threading.Lock()
known_users: set[int] = set()

executor = ThreadPoolExecutor(max_workers=int(os.environ.get("WORKERS", 8)))
http = requests.Session()
app = Flask(__name__)


# --- Telegram ---
def tg(method: str, **payload):
    try:
        r = http.post(f"{TG_API}/{method}", json=payload, timeout=20)
        if r.status_code != 200:
            log.warning("Telegram %s xato %s: %s", method, r.status_code, r.text[:300])
        return r
    except requests.RequestException as e:
        log.warning("Telegram %s xato: %s", method, type(e).__name__)
        return None


def md_to_html(text: str) -> str:
    """Gemini'ning oddiy markdown'ini Telegram HTML'ga aylantiradi."""
    text = html.escape(text, quote=False)
    text = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", text, flags=re.S)
    text = re.sub(r"(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])", r"<i>\1</i>", text)
    text = re.sub(r"`([^`\n]+)`", r"<code>\1</code>", text)
    text = re.sub(r"^\s*#{1,6}\s*(.+)$", r"<b>\1</b>", text, flags=re.M)
    text = re.sub(r"^(\s*)[*•]\s+", r"\1- ", text, flags=re.M)
    return text


def split_text(text: str, limit: int = 4000) -> list[str]:
    parts = []
    while len(text) > limit:
        cut = text.rfind("\n", 0, limit)
        if cut < limit // 2:
            cut = text.rfind(" ", 0, limit)
        if cut <= 0:
            cut = limit
        parts.append(text[:cut])
        text = text[cut:].lstrip()
    if text:
        parts.append(text)
    return parts


def send(chat_id: int, text: str, markup: dict | None = None, formatted: bool = False):
    """formatted=True — matn allaqachon HTML; aks holda markdown sifatida o'giriladi."""
    body = text if formatted else md_to_html(text)
    chunks = split_text(body)
    for i, chunk in enumerate(chunks):
        payload = {"chat_id": chat_id, "text": chunk, "parse_mode": "HTML",
                   "disable_web_page_preview": True}
        if markup and i == len(chunks) - 1:
            payload["reply_markup"] = markup
        r = tg("sendMessage", **payload)
        if r is not None and r.status_code == 400:
            # HTML xato bo'lsa — oddiy matn sifatida yuboramiz
            payload.pop("parse_mode")
            payload["text"] = html.unescape(re.sub(r"<[^>]+>", "", chunk))
            tg("sendMessage", **payload)


# --- Gemini ---
def ask_gemini(chat_id: int, text: str) -> str:
    with state_lock:
        msgs = list(history.get(chat_id, []))
    msgs.append({"role": "user", "parts": [{"text": text}]})
    msgs = msgs[-MAX_HISTORY:]
    body = {
        "system_instruction": {"parts": [{"text": SYSTEM_PROMPT}]},
        "contents": msgs,
        "generationConfig": {"temperature": 0.6, "maxOutputTokens": 1024},
    }
    answer = None
    for attempt in range(2):
        for model in GEMINI_MODELS:
            try:
                r = http.post(GEMINI_URL.format(model), json=body,
                              headers={"x-goog-api-key": GEMINI_API_KEY}, timeout=40)
                if r.status_code != 200:
                    log.warning("Gemini xato %s %s: %s", model, r.status_code, r.text[:300])
                    continue
                parts = r.json()["candidates"][0]["content"]["parts"]
                answer = "".join(p.get("text", "") for p in parts).strip() or None
                if answer:
                    break
            except (requests.RequestException, KeyError, IndexError, ValueError) as e:
                log.warning("Gemini xato %s: %s", model, type(e).__name__)
        if answer:
            break
        time.sleep(2)
    if not answer:
        return ERROR_TEXT
    msgs.append({"role": "model", "parts": [{"text": answer}]})
    with state_lock:
        history[chat_id] = msgs[-MAX_HISTORY:]
        history.move_to_end(chat_id)
        while len(history) > MAX_CHATS:
            history.popitem(last=False)
    return answer


# --- Yordamchi funksiyalar ---
def is_duplicate(update_id) -> bool:
    if update_id is None:
        return False
    with state_lock:
        if update_id in seen_updates:
            return True
        seen_updates[update_id] = None
        while len(seen_updates) > 5000:
            seen_updates.popitem(last=False)
    return False


def rate_limited(user_id: int) -> bool:
    limit, window = RATE_LIMIT
    now = time.monotonic()
    with state_lock:
        hits = user_hits.setdefault(user_id, deque())
        while hits and now - hits[0] > window:
            hits.popleft()
        if len(hits) >= limit:
            return True
        hits.append(now)
    return False


def chat_lock(chat_id: int) -> threading.Lock:
    with state_lock:
        return chat_locks.setdefault(chat_id, threading.Lock())


def notify_admin_new_user(user: dict):
    if not ADMIN_CHAT_ID or user.get("id") in known_users:
        return
    known_users.add(user.get("id"))
    name = html.escape(" ".join(filter(None, [user.get("first_name"), user.get("last_name")])))
    username = f" (@{html.escape(user['username'])})" if user.get("username") else ""
    send(int(ADMIN_CHAT_ID), f"🆕 Yangi foydalanuvchi: {name}{username}", formatted=True)


# --- Xabarlarni qayta ishlash ---
def handle_message(msg: dict):
    chat = msg.get("chat", {})
    chat_id = chat.get("id")
    user = msg.get("from") or {}
    text = (msg.get("text") or "").strip()

    if chat.get("type") != "private":
        return  # guruhlarda javob bermaymiz

    if not text:
        send(chat_id, NON_TEXT_TEXT, formatted=True)
        return

    command = text.split()[0].split("@")[0].lower() if text.startswith("/") else ""

    if command == "/start":
        with state_lock:
            history.pop(chat_id, None)
        first = user.get("first_name")
        name = f", {html.escape(first)}" if first else ""
        send(chat_id, WELCOME_TEXT.format(name=name), MAIN_KEYBOARD, formatted=True)
        notify_admin_new_user(user)
        return
    if command == "/help":
        send(chat_id, HELP_TEXT, MAIN_KEYBOARD, formatted=True)
        return
    if command == "/contact" or text == BTN_CONTACT:
        send(chat_id, CONTACT_TEXT, APPLY_BUTTONS, formatted=True)
        return
    if command == "/apply" or text == BTN_APPLY:
        send(chat_id, APPLY_TEXT, APPLY_BUTTONS, formatted=True)
        return

    if rate_limited(user.get("id", chat_id)):
        send(chat_id, RATE_LIMIT_TEXT, formatted=True)
        return

    question = BUTTON_QUESTIONS.get(text, text)[:MAX_INPUT_CHARS]
    with chat_lock(chat_id):  # bitta chatda javoblar tartib bilan
        tg("sendChatAction", chat_id=chat_id, action="typing")
        answer = ask_gemini(chat_id, question)
    send(chat_id, answer)


def process_update(update: dict):
    try:
        msg = update.get("message")
        if msg:
            handle_message(msg)
    except Exception:
        log.exception("Update'ni qayta ishlashda xato")


# --- HTTP ---
@app.get("/")
def health():
    return "Bot ishlayapti ✅"


@app.post(f"/webhook/{TELEGRAM_TOKEN}")
def webhook():
    if WEBHOOK_SECRET and request.headers.get("X-Telegram-Bot-Api-Secret-Token") != WEBHOOK_SECRET:
        abort(403)
    update = request.get_json(silent=True) or {}
    if is_duplicate(update.get("update_id")):
        return "ok"
    # Telegram'ga darhol javob qaytaramiz, aks holda u xabarni qayta yuboradi
    executor.submit(process_update, update)
    return "ok"


@app.get("/set-webhook")
def set_webhook():
    base = os.environ.get("RENDER_EXTERNAL_URL") or request.host_url.rstrip("/")
    params = {"url": f"{base}/webhook/{TELEGRAM_TOKEN}",
              "allowed_updates": '["message"]', "drop_pending_updates": "true"}
    if WEBHOOK_SECRET:
        params["secret_token"] = WEBHOOK_SECRET
    r = http.get(f"{TG_API}/setWebhook", params=params, timeout=20)
    commands = [
        {"command": "start", "description": "Boshlash / suhbatni yangilash"},
        {"command": "apply", "description": "Onlayn ariza topshirish"},
        {"command": "contact", "description": "Aloqa va manzil"},
        {"command": "help", "description": "Yordam"},
    ]
    tg("setMyCommands", commands=commands)
    return r.text


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 8000)))
