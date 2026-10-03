"""
Telegram AI bot — KIU qabul bo'limi yordamchisi. Gemini (bepul) + Render (webhook).
Universitet ma'lumotlarini faq.txt fayliga yozing — bot shundan javob beradi.

Imkoniyatlar: AI suhbat (matn, ovoz, rasm), ariza yig'ish, operator bilan jonli chat,
yo'nalish tanlash testi, admin uchun /stats, /leads, /broadcast.
"""
from __future__ import annotations

import base64
import html
import logging
import os
import re
import sys
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

# Diagnostika: oxirgi xatolar va hodisalar (/status sahifasida ko'rinadi)
recent_errors: deque = deque(maxlen=8)
recent_updates: deque = deque(maxlen=10)  # matnsiz: faqat turi va qayerga yo'naltirilgani
diag = {"updates": 0, "last_update": None, "sent": 0, "last_sent": None, "processed": 0}


class _ErrorBuffer(logging.Handler):
    def emit(self, record):
        try:
            text = self.format(record)
            for secret in (os.environ.get("TELEGRAM_TOKEN"), os.environ.get("GEMINI_API_KEY")):
                if secret and len(secret) >= 8:
                    text = text.replace(secret, "***")
            recent_errors.append(f"{time.strftime('%H:%M:%S', time.gmtime(record.created + 5 * 3600))} "
                                 f"{text[-1500:]}")
        except Exception:
            pass


_eb = _ErrorBuffer(level=logging.WARNING)
_eb.setFormatter(logging.Formatter("%(levelname)s %(message)s"))
logging.getLogger().addHandler(_eb)

TELEGRAM_TOKEN = os.environ["TELEGRAM_TOKEN"]
GEMINI_API_KEY = os.environ["GEMINI_API_KEY"]
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-flash-latest")
ADMIN_CONTACT = os.environ.get("ADMIN_CONTACT", "+998 55 500 99 44")
# Ixtiyoriy: webhook so'rovlarini tekshirish uchun maxfiy kalit (A-Z, a-z, 0-9, _ -)
WEBHOOK_SECRET = os.environ.get("WEBHOOK_SECRET", "")
# Admin guruh ID (masalan -1001234567890): arizalar, operator chat va admin buyruqlari shu yerda
# Admin chat: arizalar, ro'yxatdan o'tganlar va operator chat shu yerga boradi.
# Render'da ADMIN_CHAT_ID berilsa — faqat o'sha. Aks holda: bot guruhda bo'lsa guruh, bo'lmasa xodimning shaxsiy chati.
ADMIN_GROUP_ID = -1004487048211
ADMIN_PERSONAL_ID = 1144976151
_admin = os.environ.get("ADMIN_CHAT_ID", "").strip()
if _admin and not re.fullmatch(r"-?\d+", _admin):
    log.error("ADMIN_CHAT_ID noto'g'ri: %r (raqam bo'lishi kerak, masalan -1001234567890)", _admin)
ADMIN_FIXED = bool(re.fullmatch(r"-?\d+", _admin))
ADMIN_CHAT_ID = int(_admin) if ADMIN_FIXED else ADMIN_PERSONAL_ID
ADMIN_CHATS = {ADMIN_CHAT_ID} if ADMIN_FIXED else {ADMIN_GROUP_ID, ADMIN_PERSONAL_ID}
NOTIFY_NEW_USERS = os.environ.get("NOTIFY_NEW_USERS") == "1"
ADMISSION_URL = "https://qabul.kiu.uz"
SITE_URL = "https://kiu.uz"

TG_API = f"https://api.telegram.org/bot{TELEGRAM_TOKEN}"
TG_FILE = f"https://api.telegram.org/file/bot{TELEGRAM_TOKEN}"
# Zaxira modellar: asosiysi band bo'lsa (503) yoki javob bermasa, keyingisiga o'tiladi
GEMINI_MODELS = list(dict.fromkeys(
    [GEMINI_MODEL, "gemini-flash-lite-latest"]
    + [m.strip() for m in os.environ.get("GEMINI_FALLBACK", "").split(",") if m.strip()]))
# Ishlamay qolgan model shu vaqtgacha o'tkazib yuboriladi (model -> monotonic vaqt)
model_cooldown: dict[str, float] = {}
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

NOINFO = "[NOINFO]"

SYSTEM_PROMPT = f"""Sen Qarshi xalqaro universiteti (KIU) qabul bo'limida ishlaydigan tajribali, samimiy maslahatchisan. Telegram'da abituriyentlar va ota-onalar bilan yozishasan. Sen shablon javob beradigan robot emas, har bir odamni tinglab, aynan uning savoliga javob beradigan jonli suhbatdoshsan.

ASOSIY TAMOYILLAR
1. Aynan berilgan savolga javob ber. Birinchi gapingda savolning o'ziga to'g'ridan-to'g'ri javob bo'lsin, keyin kerak bo'lsa tushuntir.
2. Har bir javob o'ziga xos bo'lsin. Oldingi javoblaringdagi iboralar, kirish gaplari va yakunlarni takrorlama. Har safar "Salom" bilan boshlama — faqat suhbat boshida salomlash.
3. Suhbat tarixini hisobga ol: foydalanuvchi o'zi haqida aytgan narsalarni (qiziqishi, viloyati, bali, kim ekani — abituriyentmi, ota-onami) eslab qol va javobni shunga moslashtir.
4. Javob uzunligini savolga moslashtir: oddiy savolga 1–3 gap, "batafsil", "tushuntiring", "solishtiring" kabi savollarga kengroq (10–15 qatorgacha) javob ber.
5. Shunchaki ma'lumot sanab berma — tushuntir: nima uchun, kimga mos, qanday afzalligi bor, misol keltir, kerak bo'lsa ikki yo'nalishni solishtir yoki hisob-kitob qilib ber (masalan, 4 yillik jami kontrakt).
6. Javob oxirida har doim bir xil taklif qilma. Qabulga yo'naltirish, "{BTN_LEAD}", "{BTN_QUIZ}" yoki telefon raqamni faqat o'rinli bo'lganda va oxirgi bir necha xabarda aytmagan bo'lsang taklif qil. Ba'zan suhbatni davom ettiruvchi qiziq savol berish yetarli.

SUHBAT USULI (qabul bo'limi call-markazi tajribasi asosida)
- Avval tingla, keyin taklif qil. Foydalanuvchining maqsadini bilmasang, birdaniga hamma afzallikni sanama — bitta aniq savol ber: qaysi yo'nalish qiziqtiradi, siz uchun eng muhimi nima (yaxshi ish topishmi, o'qishni ish bilan birga olib borishmi, narx/imtiyozlarmi, yotoqxonami), abituriyentmisiz yoki ota-onami.
- Uning ehtiyojiga eng mos 2–3 ta dalilni tanla. Masalan, "ish topish" muhim desa — bandlik statistikasi va o'qish davrida ishlash imkoniyati; "pul" muhim desa — bo'lib to'lash, kreditlar, chegirmalar, a'lochilarga grant; "uzoqdan kelaman" desa — yotoqxona va bepul avtobus; "ishlayman" desa — kechki ta'lim va haftada 4 kunlik o'qish.
- Narx so'ralsa — aniq narxni ayt va shu zahoti uni yengillashtiradigan imkoniyatlarni qo'sh (4 ga bo'lib to'lash, imtiyozlar). Imtiyozni aniqlash uchun vaziyatini so'ra.
- E'tiroz — rad emas, qiziqish belgisi. Avval tushunganingni bildir, keyin dalil bilan javob ber:
  - "O'ylab ko'raman" — bosim qilma; nimasi to'xtatayotganini (narxmi, yo'nalishmi, boshqa savolmi) muloyim so'ra.
  - "Boshqa universitetlarni ham ko'ryapman" — taqqoslash to'g'ri ekanini tan ol va KIU'ning aniq afzalliklarini ayt (boshqalarni yomonlama).
  - "Ota-onam bilan maslahatlashaman" — to'g'ri ekanini ayt, ota-onasi bilan birga universitetga kelishni yoki savollarini shu yerda berishni taklif qil.
  - "Nodavlat ishonchsiz", "yopilib ketmaydimi?" — Konstitutsiya 50-modda, "Ta'lim to'g'risida"gi qonun 31-modda, davlat namunasidagi diplom, licence.gov.uz orqali tekshirish, PQ-200 kafolati.
  - "Qimmat" — 4 ga bo'lib to'lash, kreditlar, Yoshlar daftari, chegirmalar, a'lochilarga grant, markazda joylashuv tufayli yo'lkiradan tejash.
- Suhbat qaror bosqichiga kelganda aniq keyingi qadam taklif qil va tanlov ber: universitetga kelib ko'rish, qabul.kiu.uz'da onlayn topshirish (5 daqiqa) yoki "{BTN_LEAD}" orqali raqam qoldirish. Bunday taklifni har xabarda emas, o'rinli paytda qil.
- Foydalanuvchi rad etsa ham, iliq yakunla: fikri o'zgarsa, har doim yordam berishga tayyor ekaningni ayt.
- Maqsad — majburlash emas, to'g'ri qaror qabul qilishga yordam berish.
- Foydalanuvchining ismi ma'lum bo'lsa, ba'zan (har javobda emas) ismi bilan iliq murojaat qil.

FAKTLAR
- KIU'ga oid aniq faktlarni (narx, muddat, raqam, sana, ism, statistika) faqat quyidagi ma'lumotlardan ol, o'zingdan to'qima. "Qo'shimcha ma'lumotlar" bo'limi eng yangi hisoblanadi.
- Umumiy mavzularda (kasblar, yo'nalishda nima o'rganiladi, qaysi ishlarda ishlash mumkin, imtihonga tayyorlanish, talabalik hayoti, kasb tanlash, ota-onalarning xavotirlari) o'z bilimingdan bemalol, mazmunli va foydali javob ber.
- KIU haqida aniq fakt ma'lumotlarda bo'lmasa: buni halol ayt (har safar boshqacha so'zlar bilan), bilganingcha umumiy foydali yo'l-yo'riq ber va qayerdan aniqlash mumkinligini ayt ({ADMIN_CONTACT}, "{BTN_OPERATOR}" tugmasi yoki {ADMISSION_URL}). Shu holatda javobing oxiriga alohida qatorga {NOINFO} yoz (foydalanuvchi buni ko'rmaydi).

USLUB
- Foydalanuvchi qaysi tilda yozsa (o'zbek, rus, ingliz), o'sha tilda javob ber.
- Jonli, samimiy, hurmat bilan yoz. Emoji — kerak bo'lsa 1–2 ta, har gapda emas.
- "Men botman", "AI modelman", "FAQ bo'yicha", "ma'lumotlarimga ko'ra" kabi iboralarni ishlatma. Agar kimdir jiddiy so'rasa "Siz botmisiz?", yolg'on gapirma: KIU qabul bo'limining AI yordamchisi ekaningni va kerak bo'lsa xodimlar bilan bog'lashingni ayt.
- Formatlash: ro'yxat uchun "- " bilan boshlanadigan qatorlar, muhim so'zlarni **qalin** qil. Jadval va # sarlavhalar ishlatma.
- Ovozli xabarni tinglab, mazmuniga javob ber. Rasm yoki hujjat (diplom, sertifikat, test natijasi, skrinshot) yuborilsa, nima ko'rayotganingni qisqa ayt va foydali maslahat ber; qabul qilinadi/qilinmaydi degan qaror chiqarma.
- Universitet va ta'limga aloqasi yo'q mavzularda (siyosat, kod yozish, uy vazifasini bajarib berish) muloyimlik bilan rad et va suhbatni ta'limga qaytar.
- Boshqa universitetlarni yomonlama.

=== FAQ ===
{FAQ}
=== FAQ tugadi ==="""


user_names: dict[int, str] = {}


def system_prompt(chat_id: int | None = None) -> str:
    """FAQ + admin guruhda /addinfo orqali qo'shilgan ma'lumotlar + suhbatdosh ismi."""
    prompt = SYSTEM_PROMPT
    extra = db.list_knowledge()
    if extra:
        items = "\n".join(f"- {r['text']}" for r in extra)
        prompt += f"\n\n=== Qo'shimcha ma'lumotlar (eng yangi) ===\n{items}\n=== Tugadi ==="
    name = user_names.get(chat_id) if chat_id else None
    if name:
        prompt += f"\n\nSuhbatdoshning Telegram'dagi ismi: {name} (bu haqiqiy ismi bo'lmasligi ham mumkin)."
    return prompt

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
    "📍 <b>Manzil</b> — shahar markazi (\"Uzgaz oil\", \"Sifat supermarket\", \"Geolog\" tomonda)\n"
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
    BTN_PROGRAMS: "Qanday ta'lim yo'nalishlari bor va kontrakt narxlari qancha? Agar suhbatda men haqimda "
                  "biror narsa aytgan bo'lsam, menga mosroqlarini ham ayting.",
    BTN_ADMISSION: "Universitetga qanday qabul bo'lish mumkin? Qadamlarni tushuntiring.",
}
MENU_BUTTONS = {BTN_PROGRAMS, BTN_QUIZ, BTN_LEAD, BTN_OPERATOR, BTN_CONTACT, BTN_ADMISSION}

# --- Sozlamalar ---
MAX_HISTORY = 12          # har bir chat uchun oxirgi xabarlar soni
MAX_CHATS = 2000          # xotirada saqlanadigan chatlar soni
MAX_INPUT_CHARS = 1500    # foydalanuvchi xabarining maksimal uzunligi
MAX_FILE_BYTES = 10 * 1024 * 1024
RATE_LIMIT = (6, 30)      # 30 soniyada ko'pi bilan 6 ta AI so'rov
GEMINI_DEADLINE = 45      # bitta javob uchun Gemini'ni ko'pi bilan shuncha soniya kutamiz
STATE_TTL = 30 * 60       # ariza/operator/test holati shuncha vaqtdan so'ng tugaydi

# --- Holat (xotirada) ---
history: "OrderedDict[int, list]" = OrderedDict()
states: dict[int, dict] = {}
seen_updates: "OrderedDict[int, None]" = OrderedDict()
user_hits: dict[int, deque] = {}
chat_locks: dict[int, threading.Lock] = {}
state_lock = threading.Lock()

executor = ThreadPoolExecutor(max_workers=int(os.environ.get("WORKERS", 32)))
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
        if result is not None:
            diag["sent"] += 1
            diag["last_sent"] = time.time()
        if result is None and last_error() == 400:
            # HTML xato bo'lsa — oddiy matn sifatida yuboramiz
            payload.pop("parse_mode")
            payload["text"] = html.unescape(re.sub(r"<[^>]+>", "", chunk))
            result = tg("sendMessage", **payload)
        if result is None and chat_id == ADMIN_GROUP_ID and admin_fallback():
            return send(ADMIN_CHAT_ID, text, markup, formatted, None)
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
def cool_down(model: str, status: int):
    """Band (503/429), javob bermagan yoki o'chirilgan (404) modelni vaqtincha chetlab o'tamiz."""
    seconds = {404: 6 * 3600, 400: 0, 429: 300}.get(status, 120)
    if seconds:
        model_cooldown[model] = time.monotonic() + seconds


def ordered_models() -> list[str]:
    """Hozir ishlayotgan modellar oldinda; hammasi band bo'lsa ham baribir urinib ko'ramiz."""
    now = time.monotonic()
    ready = [m for m in GEMINI_MODELS if model_cooldown.get(m, 0) <= now]
    return ready + [m for m in GEMINI_MODELS if m not in ready]


def ask_gemini(chat_id: int, parts: list[dict], history_text: str | None = None) -> tuple[str, bool]:
    """parts — joriy xabar (matn va/yoki fayl). Tarixga faqat history_text (yoki matn qismlari) yoziladi.
    (javob, bazada ma'lumot topilmadimi) qaytaradi."""
    with state_lock:
        msgs = list(history.get(chat_id, []))
    contents = msgs + [{"role": "user", "parts": parts}]
    body = {
        "system_instruction": {"parts": [{"text": system_prompt(chat_id)}]},
        "contents": contents[-MAX_HISTORY:],
        "generationConfig": {"temperature": 0.9, "topP": 0.95, "maxOutputTokens": 1500},
    }
    answer = None
    started = time.monotonic()
    for attempt in range(2):
        if attempt and time.monotonic() - started > 20:
            break  # foydalanuvchini uzoq kutdirmaymiz
        for model in ordered_models():
            if time.monotonic() - started > GEMINI_DEADLINE:
                break
            try:
                r = http.post(GEMINI_URL.format(model), json=body,
                              headers={"x-goog-api-key": GEMINI_API_KEY}, timeout=20)
                if r.status_code != 200:
                    log.warning("Gemini xato %s %s: %s", model, r.status_code, r.text[:300])
                    cool_down(model, r.status_code)
                    continue
                cand = r.json()["candidates"][0]["content"]["parts"]
                answer = "".join(p.get("text", "") for p in cand).strip() or None
                if answer:
                    break
            except (requests.RequestException, KeyError, IndexError, ValueError) as e:
                log.warning("Gemini xato %s: %s", model, type(e).__name__)
                if isinstance(e, requests.RequestException):
                    cool_down(model, 503)
        if answer:
            break
        time.sleep(2)
    if not answer:
        return ERROR_TEXT, False
    noinfo = NOINFO in answer
    answer = answer.replace(NOINFO, "").strip() or ERROR_TEXT
    if history_text is None:
        history_text = " ".join(p["text"] for p in parts if "text" in p)
    msgs += [{"role": "user", "parts": [{"text": history_text}]},
             {"role": "model", "parts": [{"text": answer}]}]
    with state_lock:
        history[chat_id] = msgs[-MAX_HISTORY:]
        history.move_to_end(chat_id)
        while len(history) > MAX_CHATS:
            history.popitem(last=False)
    return answer, noinfo


def reply_with_ai(chat_id: int, user_id: int, parts: list[dict], history_text: str | None = None,
                  action: str = "typing"):
    if rate_limited(user_id):
        send(chat_id, RATE_LIMIT_TEXT)
        return
    tg("sendChatAction", chat_id=chat_id, action=action)
    with chat_lock(chat_id):  # bitta chatda AI javoblari tartib bilan, tugmalar esa kutmaydi
        answer, noinfo = ask_gemini(chat_id, parts, history_text)
    send(chat_id, answer, formatted=False)
    if noinfo:
        question = history_text or " ".join(p["text"] for p in parts if "text" in p)
        db.add_gap(chat_id, question[:500])


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
    if len(digits) == 12 and digits.startswith("998"):
        return "+" + digits
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


# ======================= Ro'yxatdan o'tish =======================
_NAME_WORD = r"[A-Za-zА-Яа-яЁёЎўҚқҒғҲҳ'ʻʼ‘’`-]{2,}"
NAME_RE = re.compile(rf"^{_NAME_WORD}(\s+{_NAME_WORD}){{1,3}}$")
REMOVE_KEYBOARD = {"remove_keyboard": True}
REG_PHONE_KEYBOARD = {"keyboard": [[{"text": BTN_SHARE_PHONE, "request_contact": True}]],
                      "resize_keyboard": True, "one_time_keyboard": True}


def start_registration(chat_id: int, first_time: bool = True):
    set_state(chat_id, "reg_name")
    intro = ("Assalomu alaykum! 👋 <b>Qarshi xalqaro universiteti</b> qabul bo'limi botiga xush kelibsiz.\n\n"
             if first_time else "Botdan foydalanish uchun avval qisqa ro'yxatdan o'ting 🙂\n\n")
    send(chat_id, intro + "<b>1/2.</b> Ism va familiyangizni yozing (masalan: <i>Aliyev Vali</i>):",
         REMOVE_KEYBOARD)


def handle_registration(chat_id: int, msg: dict, st: dict):
    user = msg.get("from") or {}
    text = (msg.get("text") or "").strip()
    if st["mode"] == "reg_name":
        name = re.sub(r"\s+", " ", text)
        if not NAME_RE.match(name) or len(name) > 60:
            send(chat_id, "Iltimos, <b>ism va familiyangizni</b> to'liq yozing, masalan: <i>Aliyev Vali</i> ✍️")
            return
        name = " ".join(w[:1].upper() + w[1:] for w in name.split())
        set_state(chat_id, "reg_phone", name=name)
        send(chat_id, f"Rahmat, {html.escape(name)}! 😊\n\n<b>2/2.</b> Telefon raqamingizni yuboring — "
                      f"pastdagi <b>{BTN_SHARE_PHONE}</b> tugmasini bosing yoki raqamni yozing "
                      "(masalan: <i>90 123 45 67</i>):", REG_PHONE_KEYBOARD)
        return
    contact = msg.get("contact")
    if contact and contact.get("user_id") and contact["user_id"] != user.get("id"):
        send(chat_id, "Iltimos, <b>o'zingizning</b> raqamingizni yuboring 🙂", REG_PHONE_KEYBOARD)
        return
    phone = normalize_phone(contact["phone_number"] if contact else text)
    if not phone:
        send(chat_id, "Raqam noto'g'ri ko'rinadi 🤔 Masalan: <b>90 123 45 67</b> yoki tugmani bosing.",
             REG_PHONE_KEYBOARD)
        return
    name = st["name"]
    clear_state(chat_id)
    db.set_registration(chat_id, name, phone)
    db.log_event(chat_id, "register")
    send(chat_id, WELCOME_TEXT.format(name=f", {html.escape(name)}"), MAIN_KEYBOARD)
    if ADMIN_CHAT_ID:
        sent = send(ADMIN_CHAT_ID, f"👤 <b>Yangi foydalanuvchi ro'yxatdan o'tdi</b>\n\n"
                                   f"Ism: <b>{html.escape(name)}</b>\n"
                                   f"📱 Telefon: <b>{html.escape(phone)}</b>\n"
                                   f"💬 Telegram: {user_label(user)}\n\n"
                                   "<i>Yozish uchun shu xabarga reply qiling.</i>")
        if sent:
            db.save_relay(sent["message_id"], chat_id)


# ======================= Ariza (lead) =======================
def start_lead(chat_id: int, program: str | None = None, user: dict | None = None):
    reg = db.get_registration(chat_id)
    if reg:
        name, phone = reg
        if program:
            finish_lead(chat_id, user or {"id": chat_id}, name, phone, program)
            return
        set_state(chat_id, "lead_program", name=name, phone=phone)
        send(chat_id, f"📝 <b>Ariza qoldirish</b>\n\n👤 {html.escape(name)}\n📱 {html.escape(phone)}\n\n"
                      "Qabul bo'limi xodimlari shu raqamga qo'ng'iroq qilishadi.", CANCEL_KEYBOARD)
        send(chat_id, "🎓 Qaysi yo'nalish sizni qiziqtiradi?", program_keyboard())
        return
    set_state(chat_id, "lead_name", program=program)
    note = f"\nTanlangan yo'nalish: <b>{html.escape(program)}</b>\n" if program else ""
    send(chat_id, "📝 <b>Ariza qoldirish</b>\n"
                  f"{note}\nMa'lumotlaringizni qoldiring — qabul bo'limi xodimlari sizga qo'ng'iroq qilib, "
                  "barcha savollarga javob berishadi.\n\n<b>Ism va familiyangizni yozing:</b>", CANCEL_KEYBOARD)


def program_keyboard() -> dict:
    rows = [[{"text": p["name"], "callback_data": f"prog:{code}"}] for code, p in PROGRAMS.items()]
    rows.append([{"text": "🎓 Magistratura", "callback_data": "prog:master"}])
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
    send(chat_id, f"🎉 <b>Rahmat, {html.escape(name)}!</b>\n\n"
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
    if not fwd and admin_fallback():
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
    if user.get("first_name"):
        user_names[chat_id] = user["first_name"][:40]
    text = (msg.get("text") or "").strip()
    command = text.split()[0].split("@")[0].lower() if text.startswith("/") else ""

    if db.upsert_user(user) and NOTIFY_NEW_USERS and ADMIN_CHAT_ID:
        send(ADMIN_CHAT_ID, f"👋 Yangi foydalanuvchi: {user_label(user)}")

    # Ro'yxatdan o'tmaganlar avval ism-familiya va raqam kiritadi
    if not db.get_registration(chat_id):
        st = get_state(chat_id)
        if command == "/start" or not st or not st["mode"].startswith("reg_"):
            with state_lock:
                history.pop(chat_id, None)
            start_registration(chat_id, first_time=(command == "/start"))
        else:
            handle_registration(chat_id, msg, st)
        return

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
        extra = "\n\n🛠 Siz adminsiz: admin buyruqlari — /admin" if chat_id in ADMIN_CHATS else ""
        send(chat_id, HELP_TEXT + extra, MAIN_KEYBOARD)
    elif command == "/contact" or text == BTN_CONTACT:
        send(chat_id, CONTACT_TEXT, LINK_BUTTONS)
    elif command == "/apply":
        send(chat_id, APPLY_TEXT, LINK_BUTTONS)
    elif command in ("/lead", "/ariza") or text == BTN_LEAD:
        start_lead(chat_id, user=user)
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
        start_lead(chat_id, program["name"] if program else None, user=user)
    elif kind == "prog":
        st = get_state(chat_id)
        if not st or st["mode"] != "lead_program":
            return
        program = PROGRAMS.get(arg)
        name = program["name"] if program else ("Magistratura" if arg == "master" else "Hali aniq emas")
        tg("editMessageReplyMarkup", chat_id=chat_id, message_id=msg["message_id"])
        finish_lead(chat_id, user, st["name"], st["phone"], name)
    elif kind == "ask":
        program = PROGRAMS.get(arg)
        if program:
            db.log_event(chat_id, "text")
            reply_with_ai(chat_id, user.get("id", chat_id), [{"text": (
                f"\"{program['name']}\" yo'nalishi haqida batafsil gapirib bering: nima o'rganiladi, "
                "kim bo'lib ishlash mumkin, o'qish muddati va narxi.")}])


# ======================= Admin =======================
ADMIN_COMMANDS = {"/stats", "/leads", "/broadcast", "/export", "/addinfo", "/info", "/delinfo", "/gaps", "/admin"}


def is_admin_action(msg: dict) -> bool:
    """Shaxsiy admin chatida faqat admin buyruqlari va ariza/xabarlarga reply admin hisoblanadi."""
    text = (msg.get("text") or "").strip()
    command = text.split()[0].split("@")[0].lower() if text.startswith("/") else ""
    if command in ADMIN_COMMANDS:
        return True
    reply = msg.get("reply_to_message")
    return bool(reply and not command and msg["chat"]["id"] == ADMIN_CHAT_ID
                and db.relay_user(reply["message_id"]))


def handle_admin(msg: dict):
    here = msg["chat"]["id"]  # buyruq qaysi admin chatdan kelgan bo'lsa, javob o'sha yerga
    text = (msg.get("text") or "").strip()
    command = text.split()[0].split("@")[0].lower() if text.startswith("/") else ""
    reply = msg.get("reply_to_message")

    if command == "/stats":
        s = db.stats()
        kinds = ", ".join(f"{k}: {v}" for k, v in sorted(s["by_kind"].items())) or "—"
        send(here,
             "📊 <b>Statistika</b>\n\n"
             f"👥 Foydalanuvchilar: <b>{s['users']}</b> (botni bloklagan: {s['blocked']})\n"
             f"🪪 Ro'yxatdan o'tgan: <b>{s['registered']}</b> (24 soatda {s['reg_day']})\n"
             f"🆕 Yangi: 24 soatda <b>{s['new_day']}</b>, 7 kunda <b>{s['new_week']}</b>\n"
             f"🔥 24 soatda faol: <b>{s['active_day']}</b>, so'rovlar: <b>{s['msgs_day']}</b>\n"
             f"📝 Arizalar: jami <b>{s['leads']}</b>, 24 soatda <b>{s['leads_day']}</b>, "
             f"7 kunda <b>{s['leads_week']}</b>\n"
             f"📈 7 kunlik so'rovlar turi: {kinds}", reply_to=msg["message_id"])
    elif command == "/leads":
        rows = db.recent_leads(10)
        if not rows:
            send(here, "Hozircha arizalar yo'q.", reply_to=msg["message_id"])
            return
        lines = [f"#{r['id']} · {time.strftime('%d.%m %H:%M', time.gmtime(r['created_at'] + 5 * 3600))} · "
                 f"<b>{html.escape(r['name'])}</b> · {html.escape(r['phone'])} · {html.escape(r['program'])}"
                 for r in rows]
        send(here, "📝 <b>Oxirgi arizalar</b>\n\n" + "\n".join(lines), reply_to=msg["message_id"])
    elif command == "/broadcast":
        body = text[len(text.split()[0]):].strip()
        if not reply and not body:
            send(here, "Foydalanish: <code>/broadcast matn</code> yoki biror xabarga reply qilib "
                                "<code>/broadcast</code> yozing.", reply_to=msg["message_id"])
            return
        executor.submit(broadcast, reply["message_id"] if reply else None, body, here)
        send(here, "📣 Yuborish boshlandi...", reply_to=msg["message_id"])
    elif command == "/export":
        export_csv(here)
    elif command == "/addinfo":
        body = text[len(text.split()[0]):].strip()
        if not body and reply:
            body = (reply.get("text") or reply.get("caption") or "").strip()
        if len(body) < 5:
            send(here, "Foydalanish: <code>/addinfo Yotoqxona bor, oyiga 500 000 so'm.</code>\n"
                                "Yoki matnli xabarga reply qilib <code>/addinfo</code> yozing.",
                 reply_to=msg["message_id"])
            return
        kid = db.add_knowledge(body[:3000], (msg.get("from") or {}).get("first_name", ""))
        send(here, f"✅ Bazaga qo'shildi (#{kid}). Bot endi shu ma'lumot asosida javob beradi.",
             reply_to=msg["message_id"])
    elif command == "/info":
        rows = db.list_knowledge()
        if not rows:
            send(here, "Qo'shimcha ma'lumotlar yo'q. <code>/addinfo matn</code> bilan qo'shing.",
                 reply_to=msg["message_id"])
            return
        lines = [f"<b>#{r['id']}</b> {html.escape(r['text'])}" for r in rows]
        send(here, "📚 <b>Qo'shimcha ma'lumotlar</b> (o'chirish: <code>/delinfo raqam</code>)\n\n"
             + "\n\n".join(lines), reply_to=msg["message_id"])
    elif command == "/delinfo":
        arg = text[len(text.split()[0]):].strip().lstrip("#")
        ok = arg.isdigit() and db.delete_knowledge(int(arg))
        send(here, f"🗑 #{arg} o'chirildi." if ok else "Topilmadi. Raqamni /info dan oling.",
             reply_to=msg["message_id"])
    elif command == "/gaps":
        rows = db.recent_gaps(20)
        if not rows:
            send(here, "Hozircha javobsiz qolgan savollar yo'q 👍", reply_to=msg["message_id"])
            return
        lines = [f"• {html.escape(r['question'][:200])}" + (f" <i>(×{r['n']})</i>" if r["n"] > 1 else "")
                 for r in rows]
        send(here, "❓ <b>Bot aniq javob bera olmagan savollar</b> (oxirgi 30 kun)\n\n"
             + "\n".join(lines) + "\n\nJavoblarni <code>/addinfo</code> bilan bazaga qo'shing.",
             reply_to=msg["message_id"])
    elif command in ("/help", "/admin"):
        send(here, "🛠 <b>Admin buyruqlari</b>\n\n"
                            "/stats — statistika\n/leads — oxirgi 10 ta ariza\n"
                            "/export — arizalar va ro'yxatdan o'tganlar (Excel/CSV)\n"
                            "/broadcast matn — barcha foydalanuvchilarga xabar\n\n"
                            "📚 <b>Bilim bazasi</b>\n"
                            "/addinfo matn — bazaga yangi ma'lumot qo'shish\n"
                            "/info — qo'shilgan ma'lumotlar ro'yxati\n"
                            "/delinfo raqam — ma'lumotni o'chirish\n"
                            "/gaps — bot javob topa olmagan savollar\n\n"
                            "Foydalanuvchiga javob berish: uning xabariga yoki ariza kartasiga reply qiling.")
    elif reply and not command:
        if here != ADMIN_CHAT_ID:
            return  # reply bog'lanishlari faqat faol admin chatda saqlanadi
        user_id = db.relay_user(reply["message_id"])
        if not user_id:
            return
        ok = tg("copyMessage", chat_id=user_id, from_chat_id=ADMIN_CHAT_ID, message_id=msg["message_id"])
        if ok:
            tg("setMessageReaction", chat_id=here, message_id=msg["message_id"],
               reaction=[{"type": "emoji", "emoji": "👍"}])
        else:
            if last_error() == 403:
                db.set_blocked(user_id)
            send(here, "⚠️ Yetkazib bo'lmadi — foydalanuvchi botni bloklagan bo'lishi mumkin.",
                 reply_to=msg["message_id"])


def broadcast(source_msg_id: int | None, body: str, admin_chat: int | None = None):
    admin_chat = admin_chat or ADMIN_CHAT_ID
    ok = failed = 0
    for uid in db.active_user_ids():
        if uid in ADMIN_CHATS:
            continue
        if source_msg_id:
            res = tg("copyMessage", chat_id=uid, from_chat_id=admin_chat, message_id=source_msg_id)
        else:
            res = send(uid, body, formatted=False)
        if res:
            ok += 1
        else:
            failed += 1
            if last_error() == 403:
                db.set_blocked(uid)
        time.sleep(0.05)  # Telegram limiti: ~30 xabar/soniya
    send(admin_chat, f"📣 Yuborish tugadi: ✅ {ok}, ❌ {failed}")


def set_admin_chat(chat_id: int, reason: str):
    global ADMIN_CHAT_ID
    if ADMIN_FIXED or ADMIN_CHAT_ID == chat_id:
        return
    ADMIN_CHAT_ID = chat_id
    db.clear_relay()  # turli chatlardagi xabar raqamlari aralashib ketmasin
    log.warning("Admin chat almashdi: %s (%s)", chat_id, reason)


def admin_fallback() -> bool:
    """Guruhga yuborib bo'lmasa (bot guruhda emas), shaxsiy chatga o'tamiz. O'tgan bo'lsa True."""
    if not ADMIN_FIXED and ADMIN_CHAT_ID == ADMIN_GROUP_ID and last_error() in (400, 403):
        set_admin_chat(ADMIN_PERSONAL_ID, "guruhga yuborib bo'lmadi")
        return True
    return False


def resolve_admin_chat():
    """Ishga tushganda: bot admin guruhda bo'lsa — guruhni ishlatamiz."""
    if not ADMIN_FIXED and tg("getChat", chat_id=ADMIN_GROUP_ID):
        set_admin_chat(ADMIN_GROUP_ID, "bot guruhda")


def group_setup_hint(msg: dict):
    """Bot guruhga qo'shilganda yoki /id yozilganda guruh ID'sini ko'rsatadi (admin guruhni ulash uchun)."""
    chat = msg.get("chat", {})
    if chat.get("type") not in ("group", "supergroup"):
        return
    bot_id = int(TELEGRAM_TOKEN.split(":")[0])
    added = any(m.get("id") == bot_id for m in msg.get("new_chat_members") or [])
    text = (msg.get("text") or "").strip().split("@")[0].lower()
    if not added and text not in ("/id", "/chatid"):
        return
    send(chat["id"], "👋 Bu guruhni <b>admin guruh</b> qilish uchun (arizalar, ro'yxatdan o'tganlar va operator "
                     "chat shu yerga keladi):\n\n"
                     f"1. Guruh ID'si: <code>{chat['id']}</code> (bosib nusxalang)\n"
                     "2. Render → servis → <b>Environment</b> → <b>ADMIN_CHAT_ID</b> = shu raqam → <b>Save</b>\n"
                     "3. Render qayta ishga tushgach, bu yerda <code>/help</code> yozib tekshiring.")


def export_csv(chat_id: int):
    """Arizalar va ro'yxatdan o'tganlarni CSV (Excel) fayl qilib yuboradi."""
    import csv
    import io
    for title, rows, cols in (
            ("arizalar", db.all_leads(), ["id", "name", "phone", "program", "user_id", "created_at"]),
            ("royxatdan_otganlar", db.registered_users(),
             ["id", "full_name", "phone", "username", "first_name", "registered_at"])):
        buf = io.StringIO()
        w = csv.writer(buf, delimiter=";")
        w.writerow(cols)
        for r in rows:
            w.writerow([time.strftime("%d.%m.%Y %H:%M", time.gmtime(r[c] + 5 * 3600))
                        if c.endswith("_at") and r[c] else r[c] for c in cols])
        data = ("\ufeff" + buf.getvalue()).encode("utf-8")  # BOM — Excel kirillni to'g'ri ochishi uchun
        try:
            http.post(f"{TG_API}/sendDocument", timeout=60,
                      data={"chat_id": chat_id, "caption": f"{title}: {len(rows)} ta"},
                      files={"document": (f"{title}_{time.strftime('%Y%m%d')}.csv", data, "text/csv")})
        except requests.RequestException as e:
            log.warning("Eksport xatosi: %s", type(e).__name__)


# ======================= Routing =======================
def note_update(update: dict, route: str):
    kinds = ",".join(k for k in update if k != "update_id") or "bo'sh"
    msg = update.get("message") or (update.get("callback_query") or {}).get("message") or {}
    chat_type = msg.get("chat", {}).get("type", "-")
    recent_updates.append(f"{time.strftime('%H:%M:%S', time.gmtime(time.time() + 5 * 3600))} "
                          f"{kinds} | chat: {chat_type} | {route}")


def process_update(update: dict):
    diag["processed"] += 1
    try:
        if "callback_query" in update:
            cb = update["callback_query"]
            note_update(update, f"tugma: {(cb.get('data') or '')[:20]}")
            handle_callback(cb)
            return
        msg = update.get("message")
        if not msg:
            note_update(update, "e'tiborsiz: message yo'q")
            return
        chat = msg.get("chat", {})
        if chat.get("id") in ADMIN_CHATS:
            if chat["id"] == ADMIN_GROUP_ID and ADMIN_CHAT_ID != ADMIN_GROUP_ID and not ADMIN_FIXED:
                set_admin_chat(ADMIN_GROUP_ID, "guruhdan xabar keldi")
                send(ADMIN_GROUP_ID, "✅ Bu guruh <b>admin guruh</b> sifatida ulandi. Arizalar, ro'yxatdan "
                                     "o'tganlar va operator chat endi shu yerga keladi. Buyruqlar: /help")
            if chat.get("type") == "private" and not is_admin_action(msg):
                # Admin xodimning shaxsiy chati: buyruq/reply bo'lmasa — oddiy foydalanuvchi sifatida
                note_update(update, "shaxsiy chat (admin)")
                handle_private(msg)
            else:
                note_update(update, "admin chat")
                handle_admin(msg)
        elif chat.get("type") == "private":
            note_update(update, "shaxsiy chat")
            handle_private(msg)
        else:
            # boshqa guruhlarda javob bermaymiz — faqat admin guruhni sozlashga yordam beramiz
            note_update(update, "e'tiborsiz: guruh (ADMIN_CHAT_ID emas)")
            group_setup_hint(msg)
    except Exception:
        log.exception("Update'ni qayta ishlashda xato: %s", str(update)[:500])
        chat_id = ((update.get("message") or (update.get("callback_query") or {}).get("message") or {})
                   .get("chat", {}).get("id"))
        if chat_id and chat_id not in ADMIN_CHATS:
            try:
                clear_state(chat_id)
                send(chat_id, ERROR_TEXT, MAIN_KEYBOARD)
            except Exception:
                log.exception("Xato haqida xabar yuborib bo'lmadi")


@app.get("/")
def health():
    return "Bot ishlayapti ✅"


@app.post(f"/webhook/{TELEGRAM_TOKEN}")
def webhook():
    if WEBHOOK_SECRET and request.headers.get("X-Telegram-Bot-Api-Secret-Token") != WEBHOOK_SECRET:
        abort(403)
    # Telegram'ga har doim darhol 200 qaytaramiz, aks holda u xabarni qayta-qayta yuboradi
    try:
        update = request.get_json(silent=True, force=True) or {}
        diag["updates"] += 1
        diag["last_update"] = time.time()
        if not is_duplicate(update.get("update_id")):
            executor.submit(process_update, update)
    except Exception:
        log.exception("Webhook xatosi")
    return "ok"


def register_webhook(base: str) -> dict | None:
    payload = {"url": f"{base}/webhook/{TELEGRAM_TOKEN}",
               "allowed_updates": ["message", "callback_query"], "drop_pending_updates": False}
    if WEBHOOK_SECRET:
        payload["secret_token"] = WEBHOOK_SECRET
    result = tg("setWebhook", **payload)
    log.info("Webhook o'rnatildi: %s", "ok" if result else f"xato {last_error()}")
    tg("setMyCommands", commands=[
        {"command": "start", "description": "Boshlash / suhbatni yangilash"},
        {"command": "quiz", "description": "Yo'nalish tanlash testi"},
        {"command": "lead", "description": "Ariza qoldirish (sizga qo'ng'iroq qilishadi)"},
        {"command": "operator", "description": "Jonli operator bilan bog'lanish"},
        {"command": "apply", "description": "Onlayn ariza topshirish"},
        {"command": "contact", "description": "Aloqa va manzil"},
        {"command": "help", "description": "Yordam"},
    ])
    for admin_chat in ADMIN_CHATS:
        tg("setMyCommands", scope={"type": "chat", "chat_id": admin_chat}, commands=[
            {"command": "stats", "description": "Statistika"},
            {"command": "leads", "description": "Oxirgi arizalar"},
            {"command": "export", "description": "Arizalar va ro'yxat (Excel)"},
            {"command": "broadcast", "description": "Hammaga xabar yuborish"},
            {"command": "addinfo", "description": "Bazaga ma'lumot qo'shish"},
            {"command": "info", "description": "Qo'shilgan ma'lumotlar"},
            {"command": "gaps", "description": "Javobsiz qolgan savollar"},
            {"command": "admin", "description": "Admin buyruqlari"},
            {"command": "start", "description": "Botni oddiy foydalanuvchi sifatida boshlash"},
        ])
    return result


@app.get("/set-webhook")
def set_webhook():
    base = os.environ.get("RENDER_EXTERNAL_URL") or request.host_url.rstrip("/")
    return "Webhook o'rnatildi ✅" if register_webhook(base) else f"Xato: {last_error()} — /status ni oching"


def ago(ts: float | None) -> str:
    return f"{int(time.time() - ts)} s oldin" if ts else "hali yo'q"


def gemini_check() -> str:
    """Har bir modelga kichik so'rov yuborib, kalit va limitni tekshiradi."""
    results = []
    for model in GEMINI_MODELS:
        try:
            r = http.post(GEMINI_URL.format(model), headers={"x-goog-api-key": GEMINI_API_KEY}, timeout=30,
                          json={"contents": [{"role": "user", "parts": [{"text": "ping"}]}],
                                "generationConfig": {"maxOutputTokens": 5}})
            if r.status_code == 200:
                results.append(f"{model} ✅")
            else:
                try:
                    msg = r.json().get("error", {}).get("message", "")[:120]
                except ValueError:
                    msg = r.text[:120]
                hint = {400: "kalit noto'g'ri", 403: "kalitga ruxsat yo'q", 404: "model topilmadi",
                        429: "bepul limit tugagan"}.get(r.status_code, "")
                results.append(f"{model} ❌ {r.status_code} {hint} — {msg}")
        except requests.RequestException as e:
            results.append(f"{model} ❌ {type(e).__name__}")
    return "\n  " + "\n  ".join(results)


@app.get("/status")
def status():
    """Diagnostika: bot va webhook holati (token ko'rsatilmaydi)."""
    me = tg("getMe")
    info = tg("getWebhookInfo") or {}
    url = info.get("url", "")
    token_ok = "✅ @" + me["username"] if me else "❌ noto'g'ri yoki ulanib bo'lmadi"
    hook_ok = ("✅ o'rnatilgan" if url.endswith("/webhook/" + TELEGRAM_TOKEN)
               else "❌ o'rnatilmagan — /set-webhook ni oching")
    lines = [
        f"Telegram token: {token_ok}",
        f"Webhook: {hook_ok}",
        f"Kutayotgan xabarlar: {info.get('pending_update_count', '?')}",
        "Telegram'dagi oxirgi xato: " + (info.get("last_error_message") or "yo'q"),
        f"Admin chat: {ADMIN_CHAT_ID} ({'guruh' if ADMIN_CHAT_ID < 0 else 'shaxsiy chat'})",
        f"Yo'nalishlar (faq.txt): {len(PROGRAMS)}",
        f"Baza: {db.DB_PATH}",
        f"Gemini: {gemini_check()}",
        f"Kelgan xabarlar: {diag['updates']} (oxirgisi {ago(diag['last_update'])}), "
        f"qayta ishlangan: {diag['processed']}, navbatda: {executor._work_queue.qsize()}",
        f"Yuborilgan javoblar: {diag['sent']} (oxirgisi {ago(diag['last_sent'])})",
        "Oxirgi kelgan xabarlar:\n  " + ("\n  ".join(recent_updates) if recent_updates else "yo'q"),
        "Oxirgi xatolar:\n  " + ("\n  ".join(recent_errors) if recent_errors else "yo'q"),
        f"Versiya: {os.environ.get('RENDER_GIT_COMMIT', 'nomalum')[:7]}, Python {sys.version.split()[0]}",
    ]
    return "<pre>" + html.escape("\n".join(lines)) + "</pre>"


threading.Thread(target=resolve_admin_chat, daemon=True).start()


def keep_awake():
    """Render'ning bepul serveri 15 daqiqa so'rovsiz qolsa uxlaydi — har 10 daqiqada o'zimizga murojaat qilamiz."""
    url = os.environ.get("RENDER_EXTERNAL_URL", "").rstrip("/")
    if not url:
        return
    while True:
        time.sleep(KEEP_AWAKE_SECONDS)
        try:
            requests.get(f"{url}/", timeout=30)
        except requests.RequestException as e:
            log.warning("Keep-awake xatosi: %s", type(e).__name__)


KEEP_AWAKE_SECONDS = int(os.environ.get("KEEP_AWAKE_SECONDS", 600))
if KEEP_AWAKE_SECONDS > 0:
    threading.Thread(target=keep_awake, daemon=True).start()

# Render'da deploydan so'ng webhook avtomatik o'rnatiladi
if os.environ.get("RENDER_EXTERNAL_URL"):
    threading.Thread(target=register_webhook, args=(os.environ["RENDER_EXTERNAL_URL"].rstrip("/"),),
                     daemon=True).start()


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 8000)))
