#!/usr/bin/env python3
"""Общие функции для анимированных иллюстраций (content/subjects/<предмет>/figures/<id>.svg).

Каждая иллюстрация повторяет рисунок из материалов предмета и оживляет его анимацией SMIL.
Значения движения считаются по формулам материалов, а не подбираются на глаз. Цвета задаются
классами (s-*, f-*, t-*), их определяет styles.css — поэтому рисунки сами меняются в тёмной теме.

Рисунки предмета — в tools/figures/<предмет>/*.py, запуск — python3 tools/figures/make_figures.py <предмет>
"""
import math
import os
import re

FIGS = {}


def fig(fid, title, w, h):
    def deco(fn):
        FIGS[fid] = (title, w, h, fn)
        return fn
    return deco


def f(x):
    """Компактная запись числа."""
    s = f'{x:.2f}'.rstrip('0').rstrip('.')
    return '0' if s in ('-0', '') else s


def vals(seq):
    return ';'.join(seq)


def nums(seq):
    return ';'.join(f(v) for v in seq)


def times(n):
    return ';'.join(f(i / (n - 1)) if i not in (0, n - 1) else ('0' if i == 0 else '1') for i in range(n))


def head(x, y, ang, cls='f-ink', size=7):
    """Наконечник стрелки в точке (x, y), направление ang (градусы, 0 — вправо, 90 — вниз)."""
    a = math.radians(ang)
    p1 = (x - size * math.cos(a) + size * 0.55 * math.sin(a), y - size * math.sin(a) - size * 0.55 * math.cos(a))
    p2 = (x - size * math.cos(a) - size * 0.55 * math.sin(a), y - size * math.sin(a) + size * 0.55 * math.cos(a))
    return f'<path class="{cls}" d="M{f(x)},{f(y)}L{f(p1[0])},{f(p1[1])}L{f(p2[0])},{f(p2[1])}Z"/>'


def arrow(x1, y1, x2, y2, s='s-ink', fl='f-ink', w=2, size=7):
    ang = math.degrees(math.atan2(y2 - y1, x2 - x1))
    a = math.radians(ang)
    xe, ye = x2 - size * 0.6 * math.cos(a), y2 - size * 0.6 * math.sin(a)
    return f'<line class="{s}" x1="{f(x1)}" y1="{f(y1)}" x2="{f(xe)}" y2="{f(ye)}" stroke-width="{w}"/>' + head(x2, y2, ang, fl, size)


SUB_RE = re.compile(r'_([0-9A-Za-zА-Яа-яЁё]+)')


def subs(t):
    """«F_цб» → F с нижним индексом «цб» (в SVG нет кириллических индексов Юникода)."""
    if '<tspan' in t or '</' in t or '&' in t:
        return t
    t = t.replace('<', '&lt;').replace('>', '&gt;')
    if '_' not in t:
        return t
    return SUB_RE.sub(lambda m: f'<tspan baseline-shift="sub" font-size="0.72em">{m.group(1)}</tspan>', t)


def text(x, y, t, cls='t', anchor='middle', extra=''):
    return f'<text class="{cls}" x="{f(x)}" y="{f(y)}" text-anchor="{anchor}"{extra}>{subs(t)}</text>'


def flow(dur=1.0, period=12, rev=False):
    a, b = (0, period) if rev else (period, 0)
    return f'<animate attributeName="stroke-dashoffset" values="{a};{b}" dur="{dur}s" repeatCount="indefinite"/>'


def dot_sym(x, y, r=9, cls='s-ink', fill='f-ink'):
    return f'<circle class="{cls}" cx="{f(x)}" cy="{f(y)}" r="{r}" stroke-width="2"/><circle class="{fill}" cx="{f(x)}" cy="{f(y)}" r="2.6"/>'


def cross_sym(x, y, r=9, cls='s-ink'):
    d = r * 0.62
    return (f'<circle class="{cls}" cx="{f(x)}" cy="{f(y)}" r="{r}" stroke-width="2"/>'
            f'<path class="{cls}" d="M{f(x-d)},{f(y-d)}L{f(x+d)},{f(y+d)}M{f(x+d)},{f(y-d)}L{f(x-d)},{f(y+d)}" stroke-width="2"/>')


def sample(fn, n=33):
    return [fn(i / (n - 1)) for i in range(n)]


def anim(attr, values, dur, extra=''):
    return f'<animate attributeName="{attr}" values="{values}" keyTimes="{times(len(values.split(";")))}" dur="{dur}s" repeatCount="indefinite"{extra}/>'


def rot(values, cx, cy, dur, n=None, extra=''):
    v = values if isinstance(values, list) else None
    vs = ';'.join(f'{f(a)} {f(cx)} {f(cy)}' for a in v)
    return f'<animateTransform attributeName="transform" type="rotate" values="{vs}" keyTimes="{times(len(v))}" dur="{dur}s" repeatCount="indefinite"{extra}/>'


def move(xy, dur, extra=''):
    vs = ';'.join(f'{f(x)} {f(y)}' for x, y in xy)
    return f'<animateTransform attributeName="transform" type="translate" values="{vs}" keyTimes="{times(len(xy))}" dur="{dur}s" repeatCount="indefinite"{extra}/>'


def poles(x, y, w, h, label, cls_fill):
    return f'<rect class="{cls_fill}" x="{f(x)}" y="{f(y)}" width="{f(w)}" height="{f(h)}" rx="4"/>' + text(x + w / 2, y + h / 2 + 6, label, 't-w')




def markers(fid, colors=('ink', 'red', 'acc', 'grn', 'mute')):
    """Наконечники стрелок для анимированных линий (marker-end="url(#<fid>-m-<цвет>)")."""
    out = ['<defs>']
    for c in colors:
        out.append(f'<marker id="{fid}-m-{c}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4.2" markerHeight="4.2" orient="auto-start-reverse">'
                   f'<path class="f-{c}" d="M0,0L10,5L0,10Z"/></marker>')
    out.append('</defs>')
    return ''.join(out)


def mline(fid, x1, y1, x2, y2, color='ink', w=2.4, anims='', extra=''):
    """Линия со стрелкой-маркером; anims — вложенные <animate> для x1/y1/x2/y2."""
    return (f'<line class="s-{color}" x1="{f(x1)}" y1="{f(y1)}" x2="{f(x2)}" y2="{f(y2)}" stroke-width="{w}" '
            f'marker-end="url(#{fid}-m-{color})"{extra}>{anims}</line>')


def anims(dur, **attrs):
    """Несколько <animate> с одинаковыми keyTimes: anims(4, x2=[...], y2=[...])."""
    out = []
    for k, v in attrs.items():
        name = k.replace('_', '-')
        out.append(anim(name, nums(v), dur))
    return ''.join(out)


def lin(a, b, n):
    """n равномерных значений от a до b включительно."""
    return [a + (b - a) * i / (n - 1) for i in range(n)]
