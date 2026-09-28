"""
Telegram AI bot — KIU qabul bo'limi yordamchisi. Gemini (bepul) + Render (webhook).
Universitet ma'lumotlarini faq.txt fayliga yozing — bot shundan javob beradi.

Imkoniyatlar: AI suhbat (matn, ovoz, rasm), ariza yig'ish, operator bilan jonli chat,
yo'nalish tanlash testi, admin uchun /stats, /leads, /broadcast.
"""
import base64
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

import db
import quiz

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("kiu-bot")

TELEGRAM_TOKEN = os.environ["TELEGRAM_TOKEN"]
GEMINI_API_KEY = os.environ["GEMINI_API_KEY"]
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-flash-latest")
ADMIN_CONTACT = os.environ.get("ADMIN_CONTACT", "+998 55 500 99 44")
# Ixtiyoriy: webhook so'rovlarini tekshirish uchun maxfiy kalit (A-Z, a-z, 0-9, _ -)
WEBHOOK_SECRET = os.environ.get("WEBHOOK_SECRET", "")
# Admin guruh ID (masalan -1001234567890): arizalar, operator chat va admin buyruqlari shu yerda
ADMIN_CHAT_ID = int(os.environ["ADMIN_CHAT_ID"]) if os.environ.get("ADMIN_CHAT_ID") else None
NOTIFY_NEW_USERS = os.environ.get("NOTIFY_NEW_USERS") == "1"
ADMISSION_URL = "https://qabul.kiu.uz"
SITE_URL = "https://kiu.uz"

TG_API = f"https://api.telegram.org/bot{TELEGRAM_TOKEN}"
TG_FILE = f"https://api.telegram.org/file/bot{TELEGRAM_TOKEN}"
GEMINI_MODELS = list(dict.fromkeys([GEMINI_MODEL, "gemini-flash-lite-latest", "gemini-2.0-flash"]))
GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent"

with open(os.path.join(os.path.dirname(__file__), "faq.txt"), encoding="utf-8") as f:
    FAQ = f.read()
PROGRAMS = quiz.parse_programs(FAQ)

# --- Menyu tugmalari ---
BTN_PROGRAMS = "🎓 Yo'nalishlar va narxlar"
BTN_QUIZ = "🧭 Yo'nalish tanlash testi"
BTN_LEAD = "📝 Ariza qoldirish"
BTN_OPERATOR = "👨‍💼 Operator bilan bog'lanish"
BTN_CONTACT = "📞 Aloqa va manzil"
BTN_ADMISSION = "ℹ️ Qanday qabul bo'lish"
BTN_CANCEL = "❌ Bekor qilish"
BTN_OPERATOR_END = "🔚 Operator bilan suhbatni yakunlash"
BTN_SHARE_PHONE = "📱 Raqamni yuborish"

SYSTEM_PROMPT = f"""Sen Qarshi Xalqaro Universiteti (KIU) qabul bo'limining xushmuomala maslahatchisisan. Telegram'da abituriyentlar va ota-onalar bilan yozishasan.

Qanday yozish kerak:
- Oddiy odamdek, jonli va samimiy yoz: qisqa gaplar, kerak bo'lsa bitta emoji. Rasmiy robot tilidan qoch, "Men botman", "AI modelman", "FAQ bo'yicha" kabi iboralarni ishlatma.
- Foydalanuvchi qaysi tilda yozsa (o'zbek, rus, ingliz), o'sha tilda javob ber.
- Javob qisqa va aniq bo'lsin (odatda 2–6 gap). Ro'yxat kerak bo'lsa "- " bilan boshlanadigan qatorlardan foydalan, muhim so'zlarni **qalin** qil. Jadval va sarlavhalar (#) ishlatma.
- Salomlashish, rahmat, hazil, umumiy gaplarga tabiiy javob ber.
- Universitet haqidagi savollarga quyidagi ma'lumotlar asosida javob ber. Narx, sana, raqamlarni faqat shu ma'lumotdagidek yoz, o'zingdan to'qima.
- Ma'lumotda yo'q, lekin umumiy savollar bo'lsa (kasb tanlash, o'qish, imtihonga tayyorlanish, yo'nalish qanday kasb va h.k.), o'z bilimingdan foydali javob ber.
- KIU haqida aniq ma'lumot yo'q bo'lsa (masalan grant, yotoqxona), taxmin qilma: "Buni aniqlashtirib olish kerak" de va "{BTN_OPERATOR}" tugmasini bosishni yoki {ADMIN_CONTACT} raqamiga qo'ng'iroq qilishni taklif qil.
- Suhbatni iloji bo'lsa qabulga yo'naltir: qiziqqan yo'nalishini so'ra; "{BTN_LEAD}" tugmasi orqali ma'lumot qoldirsa, xodimlar o'zlari qo'ng'iroq qilishini ayt, yoki {ADMISSION_URL} orqali ariza topshirishni taklif qil.
- Foydalanuvchi qaysi yo'nalishni tanlashni bilmasa, "{BTN_QUIZ}" tugmasini tavsiya qil.
- Foydalanuvchi ovozli xabar yuborsa, uni tinglab, mazmuniga javob ber. Rasm yoki hujjat yuborsa (diplom, sertifikat, test natijasi, skrinshot), nima ko'rayotganingni qisqa ayt va qabul nuqtai nazaridan foydali maslahat ber. Qabul qilinadi/qilinmaydi degan qaror chiqarma.
- Agar kimdir jiddiy so'rasa "Siz botmisiz / sun'iy intellektmisiz?", yolg'on gapirma: "Men KIU qabul bo'limining AI yordamchisiman, kerak bo'lsa sizni xodimlarimiz bilan bog'lab qo'yaman" deb ayt.
- Universitet va ta'limga aloqasi yo'q mavzularda (siyosat, kod yozish, uy vazifasini bajarib berish va h.k.) muloyimlik bilan rad et va suhbatni KIU'ga qaytar.

=== FAQ ===
{FAQ}
=== FAQ tugadi ==="""

MAIN_KEYBOARD = {
    "keyboard": [[{"text": BTN_PROGRAMS}, {"text": BTN_QUIZ}],
                 [{"text": BTN_LEAD}, {"text": BTN_OPERATOR}],
                 [{"text": BTN_CONTACT}, {"text": BTN_ADMISSION}]],
    "resize_keyboard": True,
    "input_field_placeholder": "Savolingizni yozing yoki ovozli xabar yuboring...",
}
CANCEL_KEYBOARD = {"keyboard": [[{"text": BTN_CANCEL}]], "resize_keyboard": True}
PHONE_KEYBOARD = {"keyboard": [[{"text": BTN_SHARE_PHONE, "request_contact": True}], [{"text": BTN_CANCEL}]],
                  "resize_keyboard": True, "one_time_keyboard": True}
OPERATOR_KEYBOARD = {"keyboard": [[{"text": BTN_OPERATOR_END}]], "resize_keyboard": True}
LINK_BUTTONS = {"inline_keyboard": [[{"text": "📝 Onlayn ariza topshirish", "url": ADMISSION_URL}],
                                    [{"text": "🌐 Rasmiy sayt", "url": SITE_URL}]]}

WELCOME_TEXT = (
    "Assalomu alaykum{name}! 👋\n\n"
    "Men <b>Qarshi Xalqaro Universiteti (KIU)</b> qabul bo'limining yordamchisiman.\n\n"
    "Nimalar qila olaman:\n"
    "- yo'nalishlar, narxlar va qabul haqida savollarga javob beraman (matn yoki 🎤 ovozli xabar)\n"
    "- 🧭 qisqa test orqali sizga mos yo'nalishni topib beraman\n"
    "- 📝 arizangizni qabul qilaman — xodimlarimiz o'zlari qo'ng'iroq qilishadi\n"
    "- 👨‍💼 kerak bo'lsa, jonli operator bilan bog'layman\n\n"
    "🇷🇺 Можно писать на русском. 🇬🇧 You can write in English."
)
HELP_TEXT = (
    "ℹ️ <b>Bot imkoniyatlari</b>\n\n"
    "- Savolingizni matn yoki ovozli xabar bilan yuboring\n"
    "- Rasm/hujjat yuborsangiz (diplom, sertifikat), u haqida maslahat beraman\n"
    "- /quiz — yo'nalish tanlash testi\n"
    "- /lead — ariza qoldirish (sizga qo'ng'iroq qilishadi)\n"
    "- /operator — jonli operator bilan yozishish\n"
    "- /contact — aloqa ma'lumotlari\n"
    "- /apply — onlayn ariza topshirish\n"
    "- /start — suhbatni yangidan boshlash"
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
    f"Yoki <b>{BTN_LEAD}</b> tugmasini bosing — xodimlarimiz o'zlari qo'ng'iroq qilib, yordam berishadi 👇"
)
ERROR_TEXT = (
    "Kechirasiz, hozir javob bera olmayapman 😔 Birozdan so'ng qayta urinib ko'ring "
    f"yoki {ADMIN_CONTACT} raqamiga qo'ng'iroq qiling."
)
UNSUPPORTED_TEXT = "Bu turdagi xabarni tushunmayman 🙂 Savolingizni matn yoki ovozli xabar bilan yuboring."
FILE_TOO_BIG_TEXT = "Fayl juda katta 🙂 10 MB dan kichik fayl yuboring."
RATE_LIMIT_TEXT = "Biroz sekinroq 🙂 Bir necha soniyadan so'ng yozing."
NO_ADMIN_TEXT = f"Hozircha xodimlarimiz bilan telefon orqali bog'lanishingiz mumkin: <b>{html.escape(ADMIN_CONTACT)}</b>"

# Tugma bosilganda Gemini'ga yuboriladigan savol
BUTTON_QUESTIONS = {
    BTN_PROGRAMS: "Qanday ta'lim yo'nalishlari bor va kontrakt narxlari qancha?",
    BTN_ADMISSION: "Universitetga qanday qabul bo'lish mumkin? Qadamlarni tushuntiring.",
}
MENU_BUTTONS = {BTN_PROGRAMS, BTN_QUIZ, BTN_LEAD, BTN_OPERATOR, BTN_CONTACT, BTN_ADMISSION}

# --- Sozlamalar ---
MAX_HISTORY = 12          # har bir chat uchun oxirgi xabarlar soni
MAX_CHATS = 2000          # xotirada saqlanadigan chatlar soni
MAX_INPUT_CHARS = 1500    # foydalanuvchi xabarining maksimal uzunligi
MAX_FILE_BYTES = 10 * 1024 * 1024
RATE_LIMIT = (6, 30)      # 30 soniyada ko'pi bilan 6 ta AI so'rov
STATE_TTL = 30 * 60       # ariza/operator/test holati shuncha vaqtdan so'ng tugaydi

# --- Holat (xotirada) ---
history: "OrderedDict[int, list]" = OrderedDict()
states: dict[int, dict] = {}
seen_updates: "OrderedDict[int, None]" = OrderedDict()
user_hits: dict[int, deque] = {}
chat_locks: dict[int, threading.Lock] = {}
state_lock = threading.Lock()

executor = ThreadPoolExecutor(max_workers=int(os.environ.get("WORKERS", 8)))
http = requests.Session()
app = Flask(__name__)


# ======================= Telegram =======================
_tls = threading.local()


def tg(method: str, **payload) -> dict | None:
    """Telegram API chaqiruvi. Muvaffaqiyatli bo'lsa `result`, aks holda None (xato `last_error`da)."""
    try:
        r = http.post(f"{TG_API}/{method}", json=payload, timeout=30)
        data = r.json()
    except (requests.RequestException, ValueError) as e:
        log.warning("Telegram %s xato: %s", method, type(e).__name__)
        _tls.last_error = 0
        return None
    if not data.get("ok"):
        log.warning("Telegram %s xato %s: %s", method, data.get("error_code"), data.get("description"))
        _tls.last_error = data.get("error_code")
        return None
    _tls.last_error = None
    return data.get("result")


def last_error() -> int | None:
    return getattr(_tls, "last_error", None)


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


def send(chat_id: int, text: str, markup: dict | None = None, formatted: bool = True,
         reply_to: int | None = None) -> dict | None:
    """formatted=True — matn tayyor HTML; False — markdown sifatida o'giriladi.
    Oxirgi yuborilgan xabarni qaytaradi."""
    body = text if formatted else md_to_html(text)
    chunks = split_text(body)
    result = None
    for i, chunk in enumerate(chunks):
        payload = {"chat_id": chat_id, "text": chunk, "parse_mode": "HTML",
                   "link_preview_options": {"is_disabled": True}}
        if markup and i == len(chunks) - 1:
            payload["reply_markup"] = markup
        if reply_to and i == 0:
            payload["reply_parameters"] = {"message_id": reply_to, "allow_sending_without_reply": True}
        result = tg("sendMessage", **payload)
        if result is None and last_error() == 400:
            # HTML xato bo'lsa — oddiy matn sifatida yuboramiz
            payload.pop("parse_mode")
            payload["text"] = html.unescape(re.sub(r"<[^>]+>", "", chunk))
            result = tg("sendMessage", **payload)
    return result


def download_file(file_id: str) -> bytes | None:
    info = tg("getFile", file_id=file_id)
    if not info or not info.get("file_path"):
        return None
    try:
        r = http.get(f"{TG_FILE}/{info['file_path']}", timeout=60)
        return r.content if r.status_code == 200 else None
    except requests.RequestException:
        return None


# ======================= Gemini =======================
def ask_gemini(chat_id: int, parts: list[dict], history_text: str | None = None) -> str:
    """parts — joriy xabar (matn va/yoki fayl). Tarixga faqat history_text (yoki matn qismlari) yoziladi."""
    with state_lock:
        msgs = list(history.get(chat_id, []))
    contents = msgs + [{"role": "user", "parts": parts}]
    body = {
        "system_instruction": {"parts": [{"text": SYSTEM_PROMPT}]},
        "contents": contents[-MAX_HISTORY:],
        "generationConfig": {"temperature": 0.6, "maxOutputTokens": 1024},
    }
    answer = None
    for attempt in range(2):
        for model in GEMINI_MODELS:
            try:
                r = http.post(GEMINI_URL.format(model), json=body,
                              headers={"x-goog-api-key": GEMINI_API_KEY}, timeout=60)
                if r.status_code != 200:
                    log.warning("Gemini xato %s %s: %s", model, r.status_code, r.text[:300])
                    continue
                cand = r.json()["candidates"][0]["content"]["parts"]
                answer = "".join(p.get("text", "") for p in cand).strip() or None
                if answer:
                    break
            except (requests.RequestException, KeyError, IndexError, ValueError) as e:
                log.warning("Gemini xato %s: %s", model, type(e).__name__)
        if answer:
            break
        time.sleep(2)
    if not answer:
        return ERROR_TEXT
    if history_text is None:
        history_text = " ".join(p["text"] for p in parts if "text" in p)
    msgs += [{"role": "user", "parts": [{"text": history_text}]},
             {"role": "model", "parts": [{"text": answer}]}]
    with state_lock:
        history[chat_id] = msgs[-MAX_HISTORY:]
        history.move_to_end(chat_id)
        while len(history) > MAX_CHATS:
            history.popitem(last=False)
    return answer


def reply_with_ai(chat_id: int, user_id: int, parts: list[dict], history_text: str | None = None,
                  action: str = "typing"):
    if rate_limited(user_id):
        send(chat_id, RATE_LIMIT_TEXT)
        return
    tg("sendChatAction", chat_id=chat_id, action=action)
    send(chat_id, ask_gemini(chat_id, parts, history_text), formatted=False)


# ======================= Yordamchi funksiyalar =======================
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


def get_state(chat_id: int) -> dict | None:
    st = states.get(chat_id)
    if st and time.time() - st["ts"] > STATE_TTL:
        states.pop(chat_id, None)
        return None
    return st


def set_state(chat_id: int, mode: str, **data):
    states[chat_id] = {"mode": mode, "ts": time.time(), **data}


def clear_state(chat_id: int):
    states.pop(chat_id, None)


def user_label(user: dict) -> str:
    name = " ".join(filter(None, [user.get("first_name"), user.get("last_name")])) or "Foydalanuvchi"
    label = f'<a href="tg://user?id={user.get("id")}">{html.escape(name)}</a>'
    if user.get("username"):
        label += f" (@{html.escape(user['username'])})"
    return label


def normalize_phone(text: str) -> str | None:
    digits = re.sub(r"\D", "", text)
    if len(digits) == 9:
        return "+998" + digits
    if 10 <= len(digits) <= 15:
        return "+" + digits
    return None


def last_user_question(chat_id: int) -> str:
    with state_lock:
        msgs = history.get(chat_id, [])
    for m in reversed(msgs):
        if m["role"] == "user":
            return m["parts"][0].get("text", "")
    return ""


# ======================= Ariza (lead) =======================
def start_lead(chat_id: int, program: str | None = None):
    set_state(chat_id, "lead_name", program=program)
    note = f"\nTanlangan yo'nalish: <b>{html.escape(program)}</b>\n" if program else ""
    send(chat_id, "📝 <b>Ariza qoldirish</b>\n"
                  f"{note}\nMa'lumotlaringizni qoldiring — qabul bo'limi xodimlari sizga qo'ng'iroq qilib, "
                  "barcha savollarga javob berishadi.\n\n<b>Ism va familiyangizni yozing:</b>", CANCEL_KEYBOARD)


def program_keyboard() -> dict:
    rows = [[{"text": p["name"], "callback_data": f"prog:{code}"}] for code, p in PROGRAMS.items()]
    rows.append([{"text": "🤷 Hali aniq emas", "callback_data": "prog:none"}])
    return {"inline_keyboard": rows}


def handle_lead_step(chat_id: int, msg: dict, st: dict):
    text = (msg.get("text") or "").strip()
    if st["mode"] == "lead_name":
        if not (2 <= len(text) <= 80) or text.startswith("/"):
            send(chat_id, "Iltimos, ism va familiyangizni matn bilan yozing ✍️")
            return
        set_state(chat_id, "lead_phone", program=st.get("program"), name=text)
        send(chat_id, f"Rahmat, {html.escape(text.split()[0])}! 📱 Endi telefon raqamingizni yuboring — "
                      f"<b>{BTN_SHARE_PHONE}</b> tugmasini bosing yoki raqamni yozing (masalan 90 123 45 67):",
             PHONE_KEYBOARD)
    elif st["mode"] == "lead_phone":
        contact = msg.get("contact")
        phone = normalize_phone(contact["phone_number"] if contact else text)
        if not phone:
            send(chat_id, "Raqam noto'g'ri ko'rinadi 🤔 Masalan: <b>90 123 45 67</b> yoki tugmani bosing.",
                 PHONE_KEYBOARD)
            return
        if st.get("program"):
            finish_lead(chat_id, msg.get("from") or {}, st["name"], phone, st["program"])
            return
        set_state(chat_id, "lead_program", name=st["name"], phone=phone)
        send(chat_id, "✅ Raqam qabul qilindi.", CANCEL_KEYBOARD)
        send(chat_id, "🎓 Qaysi yo'nalish sizni qiziqtiradi?", program_keyboard())
    elif st["mode"] == "lead_program":
        if not text:
            send(chat_id, "Iltimos, yuqoridagi ro'yxatdan yo'nalishni tanlang 👆")
            return
        finish_lead(chat_id, msg.get("from") or {}, st["name"], st["phone"], text[:100])


def finish_lead(chat_id: int, user: dict, name: str, phone: str, program: str):
    clear_state(chat_id)
    lead_id = db.add_lead(chat_id, name, phone, program)
    db.log_event(chat_id, "lead")
    send(chat_id, f"🎉 <b>Rahmat, {html.escape(name.split()[0])}!</b>\n\n"
                  "Arizangiz qabul qilindi. Qabul bo'limi xodimlari tez orada "
                  f"<b>{html.escape(phone)}</b> raqamiga qo'ng'iroq qilishadi.\n\n"
                  "Kutib o'tirmasdan, hoziroq onlayn ariza ham topshirishingiz mumkin 👇", LINK_BUTTONS)
    send(chat_id, "Yana savollaringiz bo'lsa, bemalol yozing 🙂", MAIN_KEYBOARD)
    if ADMIN_CHAT_ID:
        question = last_user_question(chat_id)
        card = (f"🆕 <b>Yangi ariza #{lead_id}</b>\n\n"
                f"👤 Ism: <b>{html.escape(name)}</b>\n"
                f"📱 Telefon: <b>{html.escape(phone)}</b>\n"
                f"🎓 Yo'nalish: {html.escape(program)}\n"
                f"💬 Telegram: {user_label(user)}\n")
        if question:
            card += f"❓ Oxirgi savoli: <i>{html.escape(question[:300])}</i>\n"
        card += "\n<i>Foydalanuvchiga yozish uchun shu xabarga reply qiling.</i>"
        sent = send(ADMIN_CHAT_ID, card)
        if sent:
            db.save_relay(sent["message_id"], chat_id)


# ======================= Operator =======================
def start_operator(chat_id: int, user: dict):
    if not ADMIN_CHAT_ID:
        send(chat_id, NO_ADMIN_TEXT, MAIN_KEYBOARD)
        return
    set_state(chat_id, "operator")
    db.log_event(chat_id, "operator")
    send(chat_id, "👨‍💼 <b>Operator bilan bog'lanish</b>\n\n"
                  "Savolingizni yozing (matn, ovoz, rasm yoki fayl) — xodimlarimiz shu yerda javob berishadi.\n"
                  "Ish vaqti: Dushanba–Shanba, 09:00–20:00.\n\n"
                  f"Suhbatni tugatish uchun <b>{BTN_OPERATOR_END}</b> tugmasini bosing.", OPERATOR_KEYBOARD)
    question = last_user_question(chat_id)
    header = f"👨‍💼 <b>Operator so'raldi</b>\n\n💬 {user_label(user)}\n"
    if question:
        header += f"❓ Botdagi oxirgi savoli: <i>{html.escape(question[:300])}</i>\n"
    header += "\n<i>Javob berish uchun foydalanuvchi xabarlariga reply qiling.</i>"
    sent = send(ADMIN_CHAT_ID, header)
    if sent:
        db.save_relay(sent["message_id"], chat_id)


def relay_to_admin(chat_id: int, msg: dict):
    st = get_state(chat_id)
    if st:
        st["ts"] = time.time()
    fwd = tg("forwardMessage", chat_id=ADMIN_CHAT_ID, from_chat_id=chat_id, message_id=msg["message_id"])
    if fwd:
        db.save_relay(fwd["message_id"], chat_id)
        tg("setMessageReaction", chat_id=chat_id, message_id=msg["message_id"],
           reaction=[{"type": "emoji", "emoji": "👀"}])
    else:
        send(chat_id, "Xabarni yetkazib bo'lmadi 😔 Iltimos, qayta urinib ko'ring yoki "
                      f"{html.escape(ADMIN_CONTACT)} raqamiga qo'ng'iroq qiling.")


# ======================= Test (quiz) =======================
def start_quiz(chat_id: int, message_id: int | None = None):
    set_state(chat_id, "quiz", answers=[])
    db.log_event(chat_id, "quiz")
    text = f"🧭 <b>Yo'nalish tanlash testi</b>\n\n{quiz.QUESTIONS[0][0]}"
    if message_id:
        tg("editMessageText", chat_id=chat_id, message_id=message_id, text=text, parse_mode="HTML",
           reply_markup=quiz.question_markup(0))
    else:
        send(chat_id, text, quiz.question_markup(0))


def handle_quiz_answer(chat_id: int, message_id: int, q: int, a: int):
    st = get_state(chat_id)
    if not st or st["mode"] != "quiz" or len(st["answers"]) != q or a >= len(quiz.QUESTIONS[q][1]):
        return
    st["answers"].append(a)
    st["ts"] = time.time()
    if q + 1 < len(quiz.QUESTIONS):
        tg("editMessageText", chat_id=chat_id, message_id=message_id, parse_mode="HTML",
           text=f"🧭 <b>Yo'nalish tanlash testi</b>\n\n{quiz.QUESTIONS[q + 1][0]}",
           reply_markup=quiz.question_markup(q + 1))
        return
    clear_state(chat_id)
    recs = quiz.recommend(st["answers"], PROGRAMS)
    if not recs:
        text = "🧭 Aniq tavsiya bera olmadim 🙂 Qiziqishlaringiz haqida yozing — birga tanlaymiz!"
        buttons = [[{"text": "🔄 Qaytadan", "callback_data": "quiz:start"}]]
    else:
        lines = [f"{i}. <b>{html.escape(p['name'])}</b>\n    ⏳ {p['years']} yil · 💰 {p['price']}/yil"
                 for i, p in enumerate(recs, 1)]
        text = "🎯 <b>Sizga mos yo'nalishlar:</b>\n\n" + "\n\n".join(lines) + \
               "\n\nBatafsil bilish yoki ariza qoldirish uchun tugmani bosing 👇"
        buttons = []
        for p in recs:
            buttons.append([{"text": f"ℹ️ {p['name'][:40]}", "callback_data": f"ask:{p['code']}"}])
        buttons.append([{"text": f"📝 {recs[0]['name'][:40]} — ariza", "callback_data": f"lead:{recs[0]['code']}"}])
        buttons.append([{"text": "🔄 Testni qayta topshirish", "callback_data": "quiz:start"}])
    tg("editMessageText", chat_id=chat_id, message_id=message_id, text=text, parse_mode="HTML",
       reply_markup={"inline_keyboard": buttons})


# ======================= Media =======================
def media_parts(msg: dict) -> tuple[list[dict], str, str] | str | None:
    """Ovoz/rasm/hujjatni Gemini uchun tayyorlaydi.
    (parts, tarix uchun matn, chat action) yoki xato matni, yoki None (qo'llab-quvvatlanmaydi)."""
    caption = (msg.get("caption") or "").strip()[:MAX_INPUT_CHARS]
    if msg.get("voice") or msg.get("audio"):
        media, label, action = msg.get("voice") or msg["audio"], "🎤 Ovozli xabar", "typing"
        mime = media.get("mime_type") or "audio/ogg"
        prompt = caption or "Foydalanuvchi ovozli xabar yubordi. Tinglab, mazmuniga javob ber."
    elif msg.get("photo"):
        media, mime, label, action = msg["photo"][-1], "image/jpeg", "🖼 Rasm", "typing"
        prompt = caption or "Foydalanuvchi rasm yubordi. Rasmda nima borligini tushunib, javob ber."
    elif msg.get("document") and re.match(r"^(image/|application/pdf|audio/)", msg["document"].get("mime_type", "")):
        media, label, action = msg["document"], "📄 Hujjat", "typing"
        mime = media["mime_type"]
        prompt = caption or "Foydalanuvchi hujjat yubordi. Mazmunini tushunib, javob ber."
    else:
        return None
    if media.get("file_size", 0) > MAX_FILE_BYTES:
        return FILE_TOO_BIG_TEXT
    data = download_file(media["file_id"])
    if not data:
        return ERROR_TEXT
    parts = [{"inline_data": {"mime_type": mime, "data": base64.b64encode(data).decode()}},
             {"text": prompt}]
    history_text = f"[{label}]" + (f" {caption}" if caption else "")
    return parts, history_text, action


# ======================= Foydalanuvchi xabarlari =======================
def handle_private(msg: dict):
    chat_id = msg["chat"]["id"]
    user = msg.get("from") or {}
    text = (msg.get("text") or "").strip()
    command = text.split()[0].split("@")[0].lower() if text.startswith("/") else ""

    if db.upsert_user(user) and NOTIFY_NEW_USERS and ADMIN_CHAT_ID:
        send(ADMIN_CHAT_ID, f"👋 Yangi foydalanuvchi: {user_label(user)}")

    # Har qanday holatdan chiqish
    if command in ("/start", "/cancel") or text in (BTN_CANCEL, BTN_OPERATOR_END):
        st = get_state(chat_id)
        clear_state(chat_id)
        if command == "/start":
            with state_lock:
                history.pop(chat_id, None)
            first = user.get("first_name")
            send(chat_id, WELCOME_TEXT.format(name=f", {html.escape(first)}" if first else ""), MAIN_KEYBOARD)
        elif text == BTN_OPERATOR_END:
            send(chat_id, "Operator bilan suhbat yakunlandi. Yana savollar bo'lsa, yozing 🙂", MAIN_KEYBOARD)
            if st and st["mode"] == "operator" and ADMIN_CHAT_ID:
                send(ADMIN_CHAT_ID, f"🔚 {user_label(user)} operator bilan suhbatni yakunladi.")
        else:
            send(chat_id, "Bekor qilindi. Savolingiz bo'lsa, yozing 🙂", MAIN_KEYBOARD)
        return

    st = get_state(chat_id)
    if st and st["mode"] == "operator":
        relay_to_admin(chat_id, msg)
        return
    if st and st["mode"].startswith("lead_") and not command and text not in MENU_BUTTONS:
        handle_lead_step(chat_id, msg, st)
        return

    if command == "/help":
        send(chat_id, HELP_TEXT, MAIN_KEYBOARD)
    elif command == "/contact" or text == BTN_CONTACT:
        send(chat_id, CONTACT_TEXT, LINK_BUTTONS)
    elif command == "/apply":
        send(chat_id, APPLY_TEXT, LINK_BUTTONS)
    elif command in ("/lead", "/ariza") or text == BTN_LEAD:
        start_lead(chat_id)
    elif command == "/operator" or text == BTN_OPERATOR:
        start_operator(chat_id, user)
    elif command in ("/quiz", "/test") or text == BTN_QUIZ:
        start_quiz(chat_id)
    elif text:
        clear_state(chat_id)
        db.log_event(chat_id, "text")
        question = BUTTON_QUESTIONS.get(text, text)[:MAX_INPUT_CHARS]
        reply_with_ai(chat_id, user.get("id", chat_id), [{"text": question}])
    else:
        prepared = media_parts(msg)
        if prepared is None:
            send(chat_id, UNSUPPORTED_TEXT)
        elif isinstance(prepared, str):
            send(chat_id, prepared)
        else:
            parts, history_text, action = prepared
            db.log_event(chat_id, "voice" if msg.get("voice") or msg.get("audio") else "media")
            reply_with_ai(chat_id, user.get("id", chat_id), parts, history_text, action)


def handle_callback(cb: dict):
    data = cb.get("data") or ""
    msg = cb.get("message") or {}
    chat_id = msg.get("chat", {}).get("id")
    user = cb.get("from") or {}
    tg("answerCallbackQuery", callback_query_id=cb["id"])
    if not chat_id or msg.get("chat", {}).get("type") != "private":
        return
    kind, _, arg = data.partition(":")

    if kind == "quiz":
        if arg == "start":
            start_quiz(chat_id, msg.get("message_id"))
        else:
            q, _, a = arg.partition(":")
            if q.isdigit() and a.isdigit():
                handle_quiz_answer(chat_id, msg["message_id"], int(q), int(a))
    elif kind == "lead":
        program = PROGRAMS.get(arg)
        start_lead(chat_id, program["name"] if program else None)
    elif kind == "prog":
        st = get_state(chat_id)
        if not st or st["mode"] != "lead_program":
            return
        program = PROGRAMS.get(arg)
        tg("editMessageReplyMarkup", chat_id=chat_id, message_id=msg["message_id"])
        finish_lead(chat_id, user, st["name"], st["phone"], program["name"] if program else "Hali aniq emas")
    elif kind == "ask":
        program = PROGRAMS.get(arg)
        if program:
            db.log_event(chat_id, "text")
            reply_with_ai(chat_id, user.get("id", chat_id), [{"text": (
                f"\"{program['name']}\" yo'nalishi haqida batafsil gapirib bering: nima o'rganiladi, "
                "kim bo'lib ishlash mumkin, o'qish muddati va narxi.")}])


# ======================= Admin =======================
def handle_admin(msg: dict):
    text = (msg.get("text") or "").strip()
    command = text.split()[0].split("@")[0].lower() if text.startswith("/") else ""
    reply = msg.get("reply_to_message")

    if command == "/stats":
        s = db.stats()
        kinds = ", ".join(f"{k}: {v}" for k, v in sorted(s["by_kind"].items())) or "—"
        send(ADMIN_CHAT_ID,
             "📊 <b>Statistika</b>\n\n"
             f"👥 Foydalanuvchilar: <b>{s['users']}</b> (botni bloklagan: {s['blocked']})\n"
             f"🆕 Yangi: 24 soatda <b>{s['new_day']}</b>, 7 kunda <b>{s['new_week']}</b>\n"
             f"🔥 24 soatda faol: <b>{s['active_day']}</b>, so'rovlar: <b>{s['msgs_day']}</b>\n"
             f"📝 Arizalar: jami <b>{s['leads']}</b>, 24 soatda <b>{s['leads_day']}</b>, "
             f"7 kunda <b>{s['leads_week']}</b>\n"
             f"📈 7 kunlik so'rovlar turi: {kinds}", reply_to=msg["message_id"])
    elif command == "/leads":
        rows = db.recent_leads(10)
        if not rows:
            send(ADMIN_CHAT_ID, "Hozircha arizalar yo'q.", reply_to=msg["message_id"])
            return
        lines = [f"#{r['id']} · {time.strftime('%d.%m %H:%M', time.gmtime(r['created_at'] + 5 * 3600))} · "
                 f"<b>{html.escape(r['name'])}</b> · {html.escape(r['phone'])} · {html.escape(r['program'])}"
                 for r in rows]
        send(ADMIN_CHAT_ID, "📝 <b>Oxirgi arizalar</b>\n\n" + "\n".join(lines), reply_to=msg["message_id"])
    elif command == "/broadcast":
        body = text[len(text.split()[0]):].strip()
        if not reply and not body:
            send(ADMIN_CHAT_ID, "Foydalanish: <code>/broadcast matn</code> yoki biror xabarga reply qilib "
                                "<code>/broadcast</code> yozing.", reply_to=msg["message_id"])
            return
        executor.submit(broadcast, reply["message_id"] if reply else None, body)
        send(ADMIN_CHAT_ID, "📣 Yuborish boshlandi...", reply_to=msg["message_id"])
    elif command == "/help":
        send(ADMIN_CHAT_ID, "🛠 <b>Admin buyruqlari</b>\n\n"
                            "/stats — statistika\n/leads — oxirgi 10 ta ariza\n"
                            "/broadcast matn — barcha foydalanuvchilarga xabar\n\n"
                            "Foydalanuvchiga javob berish: uning xabariga yoki ariza kartasiga reply qiling.")
    elif reply and not command:
        user_id = db.relay_user(reply["message_id"])
        if not user_id:
            return
        ok = tg("copyMessage", chat_id=user_id, from_chat_id=ADMIN_CHAT_ID, message_id=msg["message_id"])
        if ok:
            tg("setMessageReaction", chat_id=ADMIN_CHAT_ID, message_id=msg["message_id"],
               reaction=[{"type": "emoji", "emoji": "👍"}])
        else:
            if last_error() == 403:
                db.set_blocked(user_id)
            send(ADMIN_CHAT_ID, "⚠️ Yetkazib bo'lmadi — foydalanuvchi botni bloklagan bo'lishi mumkin.",
                 reply_to=msg["message_id"])


def broadcast(source_msg_id: int | None, body: str):
    ok = failed = 0
    for uid in db.active_user_ids():
        if uid == ADMIN_CHAT_ID:
            continue
        if source_msg_id:
            res = tg("copyMessage", chat_id=uid, from_chat_id=ADMIN_CHAT_ID, message_id=source_msg_id)
        else:
            res = send(uid, body, formatted=False)
        if res:
            ok += 1
        else:
            failed += 1
            if last_error() == 403:
                db.set_blocked(uid)
        time.sleep(0.05)  # Telegram limiti: ~30 xabar/soniya
    send(ADMIN_CHAT_ID, f"📣 Yuborish tugadi: ✅ {ok}, ❌ {failed}")


# ======================= Routing =======================
def process_update(update: dict):
    try:
        if "callback_query" in update:
            cb = update["callback_query"]
            chat_id = (cb.get("message") or {}).get("chat", {}).get("id") or cb["from"]["id"]
            with chat_lock(chat_id):
                handle_callback(cb)
            return
        msg = update.get("message")
        if not msg:
            return
        chat = msg.get("chat", {})
        if ADMIN_CHAT_ID and chat.get("id") == ADMIN_CHAT_ID:
            handle_admin(msg)
        elif chat.get("type") == "private":
            with chat_lock(chat["id"]):  # bitta chatda xabarlar tartib bilan
                handle_private(msg)
        # boshqa guruhlarda javob bermaymiz
    except Exception:
        log.exception("Update'ni qayta ishlashda xato")


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
    payload = {"url": f"{base}/webhook/{TELEGRAM_TOKEN}",
               "allowed_updates": ["message", "callback_query"], "drop_pending_updates": True}
    if WEBHOOK_SECRET:
        payload["secret_token"] = WEBHOOK_SECRET
    r = http.post(f"{TG_API}/setWebhook", json=payload, timeout=20)
    tg("setMyCommands", commands=[
        {"command": "start", "description": "Boshlash / suhbatni yangilash"},
        {"command": "quiz", "description": "Yo'nalish tanlash testi"},
        {"command": "lead", "description": "Ariza qoldirish (sizga qo'ng'iroq qilishadi)"},
        {"command": "operator", "description": "Jonli operator bilan bog'lanish"},
        {"command": "apply", "description": "Onlayn ariza topshirish"},
        {"command": "contact", "description": "Aloqa va manzil"},
        {"command": "help", "description": "Yordam"},
    ])
    if ADMIN_CHAT_ID:
        tg("setMyCommands", scope={"type": "chat", "chat_id": ADMIN_CHAT_ID}, commands=[
            {"command": "stats", "description": "Statistika"},
            {"command": "leads", "description": "Oxirgi arizalar"},
            {"command": "broadcast", "description": "Hammaga xabar yuborish"},
            {"command": "help", "description": "Admin yordam"},
        ])
    return r.text


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 8000)))
