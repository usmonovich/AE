#!/usr/bin/env python3
"""Генератор анимированных иллюстраций предмета: content/subjects/<предмет>/figures/<id>.svg.

Код рисунков предмета лежит в tools/figures/<предмет>/*.py (каждый файл регистрирует рисунки
декоратором @fig из figlib.py). ID рисунка начинается с префикса предмета (например, «ct-ohm»),
все id внутри SVG — с «<id>-». Цвета — только классы s-*, f-*, t-* (их задаёт styles.css).
Запуск: python3 tools/figures/make_figures.py <предмет>
"""
import importlib.util
import json
import os
import re
import sys
import xml.etree.ElementTree as ET

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, '..', '..')
sys.path.insert(0, HERE)
from figlib import FIGS  # noqa: E402


def main():
    subjects = {s['id']: s for s in json.load(open(os.path.join(ROOT, 'content', 'subjects.json'), encoding='utf8'))['subjects']}
    if len(sys.argv) != 2 or sys.argv[1] not in subjects:
        raise SystemExit(f'Укажите предмет: {" | ".join(subjects)}')
    sid = sys.argv[1]
    src = os.path.join(HERE, sid)
    if not os.path.isdir(src):
        raise SystemExit(f'Нет папки с кодом рисунков: tools/figures/{sid}/')
    for name in sorted(os.listdir(src)):
        if name.endswith('.py'):
            spec = importlib.util.spec_from_file_location(f'figs_{sid}_{name[:-3]}', os.path.join(src, name))
            spec.loader.exec_module(importlib.util.module_from_spec(spec))
    out = os.path.join(ROOT, 'content', 'subjects', sid, 'figures')
    os.makedirs(out, exist_ok=True)
    prefix = subjects[sid]['prefix'] + '-'
    for fid, (title, w, h, fn) in FIGS.items():
        if not fid.startswith(prefix):
            raise SystemExit(f'{fid}: ID рисунка должен начинаться с «{prefix}»')
        body = fn()
        title = re.sub(r'_([0-9A-Za-zА-Яа-яЁё]+)', r'\1', title)  # индексы для экранного диктора — без «_»
        title = title.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
        svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" font-family="inherit">'
               f'<title>{title}</title>{body}</svg>\n')
        try:
            ET.fromstring(svg)
        except ET.ParseError as e:
            raise SystemExit(f'{fid}: SVG не разбирается как XML — {e}')
        with open(os.path.join(out, f'{fid}.svg'), 'w', encoding='utf8') as fh:
            fh.write(svg)
    print(f'{sid}: рисунков {len(FIGS)}')


if __name__ == '__main__':
    main()
