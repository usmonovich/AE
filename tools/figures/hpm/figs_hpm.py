"""Анимированные рисунки для Human Performance and Medicine. Числа посчитаны по формулам (стандартная атмосфера NASA,
закон Бойля — Мариотта, гидростатика) и по данным лекций; ничего не подобрано на глаз."""
import math
from figlib import fig, f, text, anim, nums, lin  # noqa: F401


def isa_hpa(h):
    """Давление стандартной атмосферы (тропосфера), гПа; модель NASA Glenn."""
    t = 15.04 - 0.00649 * h
    return 1012.9 * ((t + 273.1) / 288.08) ** 5.256


def steps_anim(attr, values, dur, hold=0.8):
    """Дискретные состояния: каждое значение держится, затем быстрый переход к следующему."""
    n = len(values)
    vs, kt = [], []
    for i, v in enumerate(values):
        a, b = i / n, (i + hold) / n
        vs += [v, v]
        kt += [a, b]
    vs.append(values[0])
    kt.append(1)
    return (f'<animate attributeName="{attr}" values="{";".join(f(v) if isinstance(v, (int, float)) else v for v in vs)}" '
            f'keyTimes="{";".join(f(k) for k in kt)}" dur="{dur}s" repeatCount="indefinite"/>')


def show_only(i, n, dur, hold=0.8):
    """opacity = 1 только в i-м из n состояний."""
    vals = [1 if k == i else 0 for k in range(n)]
    return steps_anim('opacity', vals, dur, hold)


# ─────────── Основы: закон Бойля — Мариотта (газ в полости при подъёме) ───────────
@fig('hpm-boyle', 'Закон Бойля — Мариотта: пузырь газа в кишечнике при подъёме. Давление стандартной атмосферы '
     '1013 → 753 → 506 → 265 гПа (0; 2440; 5500; 10 000 м), объём V = V₀·p₀/p растёт в 1,35; 2,0 и 3,8 раза', 400, 240)
def boyle():
    dur = 12
    hs = [0, 2440, 5500, 10000]
    # те же значения, что в таблице темы (модель стандартной атмосферы NASA, округлено)
    ps = [1013, 753, 506, 265]
    p0 = ps[0]
    ratios = [p0 / p for p in ps]
    o = []
    # шкала высоты слева
    X, Y0, Y1 = 50, 210, 30
    sy = lambda h: Y0 - (Y0 - Y1) * h / 11000
    o.append(f'<path class="s-mute" d="M{X},{Y0}V{Y1}" stroke-width="1.5"/>')
    for h, lab in ((0, '0'), (2440, '2,4 км'), (5500, '5,5 км'), (10000, '10 км')):
        o.append(f'<path class="s-mute" d="M{X - 4},{f(sy(h))}H{X + 4}" stroke-width="1.5"/>' + text(X - 8, sy(h) + 4, lab, 't-s', 'end'))
    o.append(text(X, Y1 - 10, 'высота', 't-s'))
    o.append(f'<circle class="f-red" cx="{X}" r="6">{steps_anim("cy", [sy(h) for h in hs], dur)}</circle>')
    # «полость» — пузырь; объём ~ r³, поэтому r = r0·∛(V/V0)
    cx, cy, r0 = 235, 125, 30
    o.append(f'<circle class="s-acc" cx="{cx}" cy="{cy}" r="{r0}" stroke-width="1.2" stroke-dasharray="4 4" fill="none"/>')
    o.append(f'<circle class="s-acc" cx="{cx}" cy="{cy}" stroke-width="2.6" fill="none">{steps_anim("r", [r0 * k ** (1 / 3) for k in ratios], dur)}</circle>')
    o.append(text(cx, cy + 5, 'газ', 't-acc'))
    # подписи состояний
    for i, (h, p, k) in enumerate(zip(hs, ps, ratios)):
        lab_h = '0 м' if h == 0 else f'{h:,} м'.replace(',', ' ')
        o.append(f'<g opacity="0">{show_only(i, 4, dur)}'
                 + text(330, 60, lab_h, 't', 'middle')
                 + text(330, 84, f'p = {round(p)} гПа', 't-s', 'middle')
                 + text(330, 108, f'V = {k:.2f} V_0'.replace('.', ','), 't-red', 'middle')
                 + '</g>')
    o.append(text(235, 226, 'p·V = const: давление падает — объём растёт', 't-s'))
    return ''.join(o)


# ─────────── Лекция 5: положительная перегрузка и давление крови на уровне глаз ───────────
@fig('hpm-g-blood', 'Положительная перегрузка (+Gz): «вес» столба крови между сердцем и глазами (≈ 30 см) растёт в n раз, '
     'давление на уровне глаз ≈ 120 − 23·n мм рт. ст. (оценка по формуле ρgh). Примерно при n ≈ 3 — «серая пелена», '
     'около 4 — «чёрная пелена», около 5 — потеря сознания (по лекции G-LOC у неподготовленного — при 4–6g)', 400, 270)
def g_blood():
    dur = 14
    ns = [1, 2, 3, 4, 5]
    rho, g, hgt = 1060, 9.81, 0.30
    dp = rho * g * hgt / 133.3          # ≈ 23 мм рт. ст. на одну единицу перегрузки
    peye = [max(0, 120 - dp * n) for n in ns]
    states = ['норма', 'тяжесть в теле, зрение сохранено', 'серая пелена, туннельное зрение', 'чёрная пелена (blackout)', 'потеря сознания (G-LOC)']
    o = []
    # фигура лётчика (схема)
    hx, hy = 90, 60
    o.append(f'<circle class="s-ink" cx="{hx}" cy="{hy}" r="20" stroke-width="2" fill="none"/>')
    o.append(f'<path class="s-ink" d="M{hx},{hy + 20}V{hy + 130}M{hx - 34},{hy + 50}H{hx + 34}M{hx},{hy + 130}L{hx - 24},{hy + 180}M{hx},{hy + 130}L{hx + 24},{hy + 180}" stroke-width="2"/>')
    o.append(f'<circle class="f-red" cx="{hx}" cy="{hy + 62}" r="7"/>' + text(hx + 12, hy + 66, 'сердце', 't-s', 'start'))
    o.append(text(hx + 24, hy - 4, 'глаза', 't-s', 'start'))
    # «кровь» у головы: прозрачность падает
    o.append(f'<circle class="f-red" cx="{hx}" cy="{hy}" r="17">{steps_anim("opacity", [0.55 * p / peye[0] for p in peye], dur)}</circle>')
    # стрелка смещения крови к ногам
    o.append(f'<path class="s-red" d="M{hx + 52},{hy + 40}V{hy + 160}" stroke-width="3"><animate attributeName="stroke-width" values="1;4;1" dur="2s" repeatCount="indefinite"/></path>')
    o.append(f'<path class="f-red" d="M{hx + 44},{hy + 152}L{hx + 52},{hy + 168}L{hx + 60},{hy + 152}Z"/>')
    o.append(text(hx + 62, hy + 110, 'кровь', 't-red', 'start'))
    # столбик давления на уровне глаз
    bx, by, bh = 250, 210, 150
    o.append(f'<rect class="s-mute" x="{bx}" y="{by - bh}" width="34" height="{bh}" fill="none" stroke-width="1.2"/>')
    hs = [bh * p / 120 for p in peye]
    o.append(f'<rect class="f-red" x="{bx}" width="34">{steps_anim("y", [by - h for h in hs], dur)}{steps_anim("height", hs, dur)}</rect>')
    o.append(text(bx + 17, by + 16, 'давление у глаз', 't-s'))
    for v in (0, 60, 120):
        o.append(text(bx - 6, by - bh * v / 120 + 4, str(v), 't-s', 'end'))
    for i, (n, p, s) in enumerate(zip(ns, peye, states)):
        o.append(f'<g opacity="0">{show_only(i, len(ns), dur)}'
                 + text(340, 70, f'n = {n}', 't', 'middle')
                 + text(340, 94, f'≈ {round(p)} мм рт. ст.', 't-s', 'middle')
                 + text(200, 262, s, 't-red' if i >= 2 else 't-grn', 'middle')
                 + '</g>')
    return ''.join(o)


# ─────────── Лекция 7: цикл СЛР 30 : 2 ───────────
@fig('hpm-cpr', 'Цикл базовой СЛР у взрослого: 30 компрессий грудной клетки с частотой 100–120 в минуту (здесь 110) '
     'на глубину 5–6 см, затем 2 вдоха по 1 с; цикл повторяется без лишних пауз', 400, 230)
def cpr():
    rate = 110
    tc = 60 / rate                     # период одной компрессии, с
    t30 = 30 * tc                      # ≈ 16,4 с
    tb = 5.0                           # два вдоха с паузами (рекомендуется прерывать компрессии < 10 с)
    dur = t30 + tb
    o = []
    # грудная клетка: прямоугольник «сжимается» на 5–6 см (масштаб: 1 см = 4 px)
    X, Y = 60, 70
    k = 30
    kt, ys = [0], [Y]
    for i in range(30):
        t0 = i * tc
        kt += [(t0 + tc * 0.5) / dur, (t0 + tc) / dur]
        ys += [Y + 22, Y]
    kt += [1]
    ys += [Y]
    o.append(f'<rect class="s-ink" x="{X}" width="140" height="70" rx="18" fill="none" stroke-width="2">'
             f'<animate attributeName="y" values="{nums(ys)}" keyTimes="{";".join(f(t) for t in kt)}" dur="{f(dur)}s" repeatCount="indefinite"/>'
             f'<animate attributeName="height" values="{nums([140 - y for y in ys])}" keyTimes="{";".join(f(t) for t in kt)}" dur="{f(dur)}s" repeatCount="indefinite"/></rect>')
    o.append(f'<path class="s-mute" d="M{X - 10},142H{X + 150}" stroke-width="2"/>')
    o.append(text(X + 70, 162, 'глубина 5–6 см', 't-s'))
    # руки
    o.append(f'<rect class="f-acc" x="{X + 55}" width="30" height="16" rx="4">'
             f'<animate attributeName="y" values="{nums([y - 16 for y in ys])}" keyTimes="{";".join(f(t) for t in kt)}" dur="{f(dur)}s" repeatCount="indefinite"/></rect>')
    # счётчик из 30 отметок
    for i in range(30):
        cx = 240 + (i % 10) * 14
        cy = 60 + (i // 10) * 18
        t_on = (i * tc + tc * 0.5) / dur
        o.append(f'<circle class="f-acc" cx="{cx}" cy="{cy}" r="5" opacity="0.15">'
                 f'<animate attributeName="opacity" values="0.15;0.15;1;1;0.15" keyTimes="0;{f(t_on)};{f(min(t_on + 0.001, 0.999))};0.999;1" dur="{f(dur)}s" repeatCount="indefinite"/></circle>')
    o.append(text(303, 40, '30 компрессий', 't-acc'))
    # два вдоха
    for j in range(2):
        a = (t30 + j * 2.5) / dur
        b = (t30 + j * 2.5 + 1.0) / dur
        o.append(f'<circle class="s-red" cx="{280 + j * 50}" cy="150" r="10" fill="none" stroke-width="2.5">'
                 f'<animate attributeName="r" values="10;10;22;10;10" keyTimes="0;{f(a)};{f((a + b) / 2)};{f(b)};1" dur="{f(dur)}s" repeatCount="indefinite"/></circle>')
    o.append(text(303, 190, '2 вдоха по 1 с', 't-red'))
    o.append(text(200, 222, f'{rate} компрессий в минуту → 30 компрессий ≈ {t30:.0f} с'.replace('.', ','), 't-s'))
    return ''.join(o)
