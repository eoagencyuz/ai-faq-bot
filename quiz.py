"""Yo'nalish tanlash testi va faq.txt'dan yo'nalishlar ro'yxati."""
from __future__ import annotations

import re

# "- 60610400 Dasturiy injiniring — 4 yil — 12 850 000 so'm"
_PROGRAM_RE = re.compile(r"^-\s*(\d{8})\s+(.+?)\s+—\s+(\d+)\s*yil\s+—\s+([\d\s]+so'm)", re.M)


def parse_programs(faq: str) -> dict[str, dict]:
    return {m[1]: {"code": m[1], "name": m[2].strip(), "years": m[3], "price": m[4].strip()}
            for m in _PROGRAM_RE.finditer(faq)}


# Kodlar faq.txt'dagi yo'nalishlarga mos
IT = "60610400"
ECON, ACC, FIN = "60410100", "60410200", "60410500"
OIL = "60721100"
PRESCHOOL, PRIMARY = "60110200", "60110400"
IDEOLOGY, PSY = "60111100", "60310300"
DE, EN, RU, UZ = "60230100", "60230101", "60230102", "60230103"
LANGS = [DE, EN, RU, UZ]

# Har bir javob -> {yo'nalish kodi: ball}
QUESTIONS = [
    ("1/4. Maktabda qaysi fanlar sizga ko'proq yoqadi?", [
        ("🧮 Matematika, informatika", {IT: 3, ECON: 2, ACC: 2, FIN: 2, OIL: 1}),
        ("📚 Tillar, adabiyot", {EN: 2, DE: 2, RU: 2, UZ: 2, PRIMARY: 1}),
        ("⚖️ Tarix, huquq, jamiyat", {IDEOLOGY: 3, PSY: 1, ECON: 1}),
        ("🧪 Fizika, kimyo, biologiya", {OIL: 3, PSY: 1, PRESCHOOL: 1}),
    ]),
    ("2/4. Kelajakda qayerda ishlashni xohlaysiz?", [
        ("🏦 Bank, biznes, ofis", {ECON: 3, FIN: 3, ACC: 3}),
        ("💻 IT kompaniya", {IT: 4}),
        ("🏫 Maktab yoki bog'cha", {PRIMARY: 3, PRESCHOOL: 3, EN: 1, DE: 1, RU: 1, UZ: 1}),
        ("🏭 Sanoat, ishlab chiqarish", {OIL: 4}),
        ("🤝 Davlat tashkiloti, jamoatchilik", {IDEOLOGY: 3, PSY: 2, ECON: 1}),
    ]),
    ("3/4. Qaysi ish uslubi sizga yaqinroq?", [
        ("📊 Raqamlar va tahlil", {ACC: 3, FIN: 3, ECON: 2, IT: 1}),
        ("🛠 Kompyuterda yangi narsa yaratish", {IT: 4}),
        ("🧸 Bolalar bilan ishlash", {PRESCHOOL: 4, PRIMARY: 4}),
        ("🗣 Odamlar bilan muloqot", {PSY: 3, IDEOLOGY: 2, EN: 2, DE: 2, RU: 2, UZ: 2}),
        ("⛽ Texnika va dala ishlari", {OIL: 4}),
    ]),
    ("4/4. Qaysi tilni chuqur o'rganishni xohlaysiz?", [
        ("🇬🇧 Ingliz tili", {EN: 3}),
        ("🇩🇪 Nemis tili", {DE: 3}),
        ("🇷🇺 Rus tili", {RU: 3}),
        ("🇺🇿 O'zbek tili va adabiyoti", {UZ: 3}),
        ("🤷 Til yo'nalishi kerak emas", {l: -2 for l in LANGS}),
    ]),
]


def question_markup(q: int) -> dict:
    _, options = QUESTIONS[q]
    return {"inline_keyboard": [[{"text": text, "callback_data": f"quiz:{q}:{i}"}]
                                for i, (text, _) in enumerate(options)]}


def recommend(answers: list[int], programs: dict[str, dict], top: int = 2) -> list[dict]:
    scores: dict[str, int] = {}
    for q, a in enumerate(answers):
        for code, pts in QUESTIONS[q][1][a][1].items():
            scores[code] = scores.get(code, 0) + pts
    ranked = sorted((c for c in scores if c in programs and scores[c] > 0), key=lambda c: -scores[c])
    return [programs[c] for c in ranked[:top]]
