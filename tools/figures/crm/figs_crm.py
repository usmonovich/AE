"""Иллюстрации к лекциям CRM (авиационная психология). Числа — по рисункам на слайдах лекции 2."""
import math
from figlib import fig, f, text, anims, lin, nums, times, markers, mline  # noqa: F401


def appear(t0, t1, dur):
    """Видно в доле периода [t0, t1)."""
    return (f'<animate attributeName="opacity" values="0;0;1;1;0;0" '
            f'keyTimes="0;{f(t0)};{f(t0 + 0.001)};{f(t1)};{f(t1 + 0.001)};1" dur="{dur}s" repeatCount="indefinite"/>')


# ─────────── лекция 2, слайд 3: угол обзора из кабины вниз ───────────
@fig('crm-view-angle', 'Угол обзора из кабины вниз: высота глаз 50 м, угол 15° — ближайшая видимая точка ВПП примерно в 185 м; '
     'при подъёме носа на 5° угол 10° — около 285 м (рисунок лекции 2, слайд 3)', 400, 230)
def view_angle():
    dur = 8
    H_m, k = 50, 1.0          # метры → пиксели
    ex, ey = 52, 190 - H_m * k * 1.6   # глаз пилота
    gy = 190                  # уровень ВПП
    sx = 1.0                  # горизонтальный масштаб: 1 px = 1 м
    # тангаж θ(t): 0 → 5° → 0
    th = [0, 0, 5, 5, 0]
    kt = '0;0.15;0.45;0.75;1'
    n = 41
    ts = [i / (n - 1) for i in range(n)]

    def theta_at(t):
        pts = [(0, 0), (0.15, 0), (0.45, 5), (0.75, 5), (1, 0)]
        for (t0, a0), (t1, a1) in zip(pts, pts[1:]):
            if t0 <= t <= t1:
                return a0 + (a1 - a0) * (t - t0) / (t1 - t0 or 1)
        return 0

    hpx = gy - ey  # 80 px соответствуют 50 м → вертикальный масштаб 1,6
    xs = [ex + H_m / math.tan(math.radians(15 - theta_at(t))) * sx for t in ts]
    o = []
    o.append(f'<path class="s-ink" d="M10,{gy}H392" stroke-width="2"/>')
    o.append(f'<rect class="f-soft" x="190" y="{gy}" width="200" height="8"/>' + text(372, gy + 22, 'ВПП', 't-s'))
    # горизонт от глаз
    o.append(f'<path class="s-mute" d="M{ex},{f(ey)}H300" stroke-width="1" stroke-dasharray="4 4"/>')
    # линия обзора
    o.append(f'<line class="s-red" x1="{ex}" y1="{f(ey)}" x2="{f(xs[0])}" y2="{gy}" stroke-width="2">{anims(dur, x2=xs)}</line>')
    o.append(f'<circle class="f-red" cy="{gy}" r="5">{anims(dur, cx=xs)}</circle>')
    # самолёт: фюзеляж с носом, поворачивается вокруг глаз пилота
    rot = ';'.join(f'{f(-theta_at(t) * 3)} {ex} {f(ey)}' for t in ts)  # угол на рисунке утрирован ×3 для наглядности
    plane = (f'<path class="f-acc" d="M{ex - 26},{f(ey - 2)}L{ex + 14},{f(ey - 4)}Q{ex + 34},{f(ey + 2)} {ex + 14},{f(ey + 9)}L{ex - 26},{f(ey + 9)}Z"/>'
             f'<path class="f-acc" d="M{ex - 26},{f(ey - 2)}l-6,-14h8l10,14z"/>'
             f'<circle class="f-paper" cx="{ex}" cy="{f(ey)}" r="2.6"/>')
    o.append(f'<g>{plane}<animateTransform attributeName="transform" type="rotate" values="{rot}" keyTimes="{times(n)}" dur="{dur}s" repeatCount="indefinite"/></g>')
    # высота
    o.append(f'<path class="s-ink" d="M{ex - 16},{f(ey)}V{gy}" stroke-width="1.2"/>' + text(ex - 12, ey + hpx / 2 + 5, 'H = 50 м', 't-s', 'start'))
    # подписи двух состояний
    o.append(f'<g>{appear(0, 0.15, dur)}{text(220, 40, "тангаж 0°: угол обзора 15°", "t-red")}{text(220, 62, "ВПП видна с ≈ 185 м", "t")}</g>')
    o.append(f'<g opacity="0">{appear(0.45, 0.75, dur)}{text(220, 40, "нос поднят на 5°: угол 10°", "t-red")}{text(220, 62, "ВПП видна с ≈ 285 м", "t")}</g>')
    o.append(f'<g opacity="0">{appear(0.15, 0.45, dur)}{text(220, 40, "нос поднимается…", "t-s")}</g>')
    o.append(f'<g opacity="0">{appear(0.75, 1, dur)}{text(220, 40, "нос опускается…", "t-s")}</g>')
    o.append(text(200, 222, 'L = H / tg(α − θ)', 't-s'))
    return ''.join(o)


# ─────────── лекция 2, слайд 4: зоны восприятия земли на посадке ───────────
@fig('crm-landing-zones', 'Зоны восприятия земли на посадке (по Г. Г. Голубеву): вдали — зона ясной видимости, ближе — зона мелькания, '
     'у самолёта — зона слияния, где предметы сливаются в сплошную полосу', 400, 220)
def landing_zones():
    o = []
    gy = 150
    o.append(f'<path class="s-ink" d="M8,{gy}H392" stroke-width="2"/>')
    # самолёт слева низко над землёй
    o.append('<path class="f-acc" d="M14,96h40q16,4 0,10h-40z"/><path class="f-acc" d="M18,96l-6,-12h8l8,12z"/>')
    # зоны: слияние 60–140, мелькание 140–250, ясная видимость 250–392
    zones = [(60, 140, 'слияния', 'f-red-soft'), (140, 250, 'мелькания', 'f-soft'), (250, 392, 'ясной видимости', 'f-soft')]
    for x1, x2, name, cls in zones:
        o.append(f'<rect class="{cls}" x="{x1}" y="{gy + 4}" width="{x2 - x1}" height="22" opacity="0.8"/>')
        o.append(text((x1 + x2) / 2, gy + 44, f'зона {name}', 't-s'))
    # предметы плывут к самолёту; видимая скорость растёт по мере приближения
    period = 6
    for k in range(5):
        delay = -k * period / 5
        o.append(f'<circle class="f-grn" cx="392" cy="{gy - 8}" r="6">'
                 f'<animate attributeName="cx" values="392;60" keyTimes="0;1" keySplines="0.6 0 1 1" calcMode="spline" '
                 f'dur="{period}s" begin="{f(delay)}s" repeatCount="indefinite"/></circle>')
    # в зоне слияния — сплошные полосы
    for i, y in enumerate((gy - 14, gy - 8, gy - 2)):
        o.append(f'<line class="s-grn" x1="62" y1="{y}" x2="138" y2="{y}" stroke-width="2" stroke-dasharray="30 6">'
                 f'<animate attributeName="stroke-dashoffset" values="0;36" dur="{0.25 + i * 0.05}s" repeatCount="indefinite"/></line>')
    o.append(f'<rect class="f-paper" x="56" y="{gy - 24}" width="6" height="22"/>')
    o.append(text(225, 30, 'Чем ближе к самолёту, тем быстрее', 't-s') + text(225, 46, 'предметы проносятся мимо взгляда', 't-s'))
    return ''.join(o)


# ─────────── лекция 2, слайд 8: структура образа полёта ───────────
def box(x, y, w, h, lines, cls='s-ink', tcls='t-s'):
    out = [f'<rect class="{cls} f-paper" x="{x}" y="{y}" width="{w}" height="{h}" rx="6" stroke-width="1.6"/>']
    y0 = y + h / 2 - (len(lines) - 1) * 6.5 + 4
    for i, ln in enumerate(lines):
        out.append(text(x + w / 2, y0 + i * 13, ln, tcls))
    return ''.join(out)


@fig('crm-flight-image', 'Структура образа полёта: система информации даёт инструментальные и неинструментальные сигналы, '
     'из них складываются образ пространственного положения, чувство самолёта и приборный образ, а над ними — образ-цель (схема лекции 2, слайд 8)', 400, 260)
def flight_image():
    fid = 'crm-flight-image'
    o = [markers(fid, ('acc', 'mute'))]
    # стрелки снизу вверх с бегущим пунктиром
    def flow_line(x1, y1, x2, y2, delay):
        return (f'<line class="s-acc" x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke-width="2" stroke-dasharray="5 5" marker-end="url(#{fid}-m-acc)">'
                f'<animate attributeName="stroke-dashoffset" values="20;0" dur="1s" begin="{delay}s" repeatCount="indefinite"/></line>')
    o.append(flow_line(170, 228, 100, 206, 0) + flow_line(230, 228, 300, 206, 0))
    o.append(flow_line(80, 178, 70, 136, 0.2) + flow_line(110, 178, 190, 136, 0.2) + flow_line(310, 178, 320, 136, 0.2))
    o.append(flow_line(70, 102, 150, 66, 0.4) + flow_line(200, 102, 200, 66, 0.4) + flow_line(330, 102, 250, 66, 0.4))
    o.append(box(130, 18, 140, 46, ['Образ полёта —', 'концептуальная модель'], 's-acc', 't-s'))
    o.append(text(200, 80, 'образ-цель', 't-s'))
    o.append(box(10, 102, 120, 34, ['Образ простран-', 'ственного положения']))
    o.append(box(140, 102, 120, 34, ['Чувство самолёта']))
    o.append(box(270, 102, 120, 34, ['Приборный образ']))
    o.append(text(200, 158, 'сенсорный и моторный образ', 't-s'))
    o.append(box(20, 178, 160, 28, ['Неинструментальные сигналы']))
    o.append(box(220, 178, 160, 28, ['Инструментальные сигналы']))
    o.append(box(130, 228, 140, 26, ['Система информации'], 's-acc'))
    return ''.join(o)
