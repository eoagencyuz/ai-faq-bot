# Gunicorn buni avtomatik o'qiydi — Render'da Start Command'ni o'zgartirish shart emas.
# Suhbat tarixi va holatlar xotirada, shuning uchun worker faqat 1 ta bo'lishi kerak.
import os

bind = f"0.0.0.0:{os.environ.get('PORT', '10000')}"
workers = 1
worker_class = "gthread"
threads = 8
timeout = 120
