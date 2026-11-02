"""Animated figures for Circuit Theory. Values are computed from the formulas and numbers of the lectures."""
import math
from figlib import fig, f, text, anim, nums, times, lin, arrow, head  # noqa: F401


def path(pts):
    return 'M' + 'L'.join(f'{f(x)},{f(y)}' for x, y in pts)


# ─────────── Lecture 2, slide 16: KCL at a node ───────────
@fig('ct-kcl-node', 'KCL at node a (Lecture 2, slide 16): I₁ = 5 A and I₃ = 3 A enter, I₂ = 2 A and I_T leave; '
     'the dots flowing in and out show that what enters equals what leaves: I_T = I₁ − I₂ + I₃ = 6 A', 400, 230)
def kcl_node():
    cx, cy = 200, 108
    o = []
    branches = [  # (angle deg, label, amps, entering?)
        (180, 'I₁ = 5 A', 5, True), (0, 'I₃ = 3 A', 3, True), (90, 'I₂ = 2 A', 2, False), (270, 'I_T = 6 A', 6, False)]
    for ang, lab, amps, inn in branches:
        a = math.radians(ang)
        x2, y2 = cx + 150 * math.cos(a), cy - 80 * math.sin(a)
        cls = 's-acc' if inn else 's-red'
        o.append(f'<line class="{cls}" x1="{f(cx)}" y1="{f(cy)}" x2="{f(x2)}" y2="{f(y2)}" stroke-width="{f(1.5 + amps * 0.6)}"/>')
        # moving dots: speed proportional to current
        n = 3
        dur = 6 / amps * 1.2
        for k in range(n):
            if inn:
                xs = lin(x2, cx, 9); ys = lin(y2, cy, 9)
            else:
                xs = lin(cx, x2, 9); ys = lin(cy, y2, 9)
            o.append(f'<circle class="{"f-acc" if inn else "f-red"}" r="4">'
                     f'<animate attributeName="cx" values="{nums(xs)}" dur="{f(dur)}s" begin="{f(-k * dur / n)}s" repeatCount="indefinite"/>'
                     f'<animate attributeName="cy" values="{nums(ys)}" dur="{f(dur)}s" begin="{f(-k * dur / n)}s" repeatCount="indefinite"/></circle>')
        if abs(math.cos(a)) > 0.5:
            o.append(text(cx + 150 * math.cos(a), cy - 10, lab, 't-acc' if inn else 't-red', 'end' if math.cos(a) > 0 else 'start'))
        else:
            o.append(text(cx + 14, cy - 80 * math.sin(a) + (12 if math.sin(a) > 0 else -2), lab, 't-acc' if inn else 't-red', 'start'))
    o.append(f'<circle class="f-ink" cx="{cx}" cy="{cy}" r="7"/>' + text(cx + 16, cy - 10, 'a', 't'))
    o.append(text(200, 224, 'in: 5 + 3 = 8 A   ·   out: 2 + 6 = 8 A', 't-s'))
    return ''.join(o)


# ─────────── Lecture 6, slide 5: capacitor memory ───────────
@fig('ct-cap-memory', 'Capacitor memory (Lecture 6, slide 5): the current i_S(t) into a 5 F capacitor and the voltage '
     'v(t) = (1/C)∫i dt — the voltage grows by the area under the current and keeps its value (5 V) after the current stops', 400, 250)
def cap_memory():
    dur = 8
    X0, W = 40, 330
    t0, t1 = -1.5, 4.0
    sx = lambda t: X0 + W * (t - t0) / (t1 - t0)

    def i_of(t):
        if t < -1: return 0
        if t < 1: return 5 * (t + 1)
        if t < 2: return 10
        if t < 3: return 10 * (3 - t)
        return 0

    def v_of(t):  # integral / 5
        if t < -1: return 0
        if t < 1: return (2.5 * (t + 1) ** 2) / 5
        if t < 2: return (10 + 10 * (t - 1)) / 5
        if t < 3: return (20 + 10 * (t - 2) - 5 * (t - 2) ** 2) / 5
        return 5
    yi = lambda i: 100 - 7 * i     # top panel: 10 A → 30 px above baseline 100
    yv = lambda v: 225 - 14 * v    # bottom panel: 5 V → 70 px
    ts = lin(t0, t1, 111)
    o = []
    for base, lab in ((100, 'i_S (A)'), (225, 'v (V)')):
        o.append(f'<path class="s-mute" d="M{X0},{base}H{X0 + W}M{f(sx(0))},{base + 4}V{base - 85}" stroke-width="1.2"/>')
        o.append(text(f(sx(0)) if False else sx(0) + 6, base - 76, lab, 't-s', 'start'))
    for t in (1, 2, 3):
        o.append(text(sx(t), 238, str(t), 't-s') + f'<path class="s-mute" d="M{f(sx(t))},{yi(10)}V100M{f(sx(t))},{yv(5)}V225" stroke-width="0.8" stroke-dasharray="3 4"/>')
    o.append(text(sx(-1), 238, '−1', 't-s') + text(X0 + W, 238, 't (s)', 't-s', 'end'))
    o.append(text(X0 - 4, yi(10) + 4, '10', 't-s', 'end') + text(X0 - 4, yv(5) + 4, '5', 't-s', 'end') + text(X0 - 4, yv(2) + 4, '2', 't-s', 'end') + text(X0 - 4, yv(4) + 4, '4', 't-s', 'end'))
    o.append(f'<path class="s-acc" d="{path([(sx(t), yi(i_of(t))) for t in ts])}" stroke-width="2.4" fill="none"/>')
    o.append(f'<path class="s-red" d="{path([(sx(t), yv(v_of(t))) for t in ts])}" stroke-width="2.4" fill="none"/>')
    # sweeping marker with shaded area
    n = 41
    tt = lin(-1, 3.6, n)
    xs = [sx(t) for t in tt]
    o.append(f'<line class="s-ink" y1="18" y2="228" stroke-width="1" stroke-dasharray="2 3">{anim("x1", nums(xs), dur)}{anim("x2", nums(xs), dur)}</line>')
    o.append(f'<circle class="f-acc" r="4.5">{anim("cx", nums(xs), dur)}{anim("cy", nums([yi(i_of(t)) for t in tt]), dur)}</circle>')
    o.append(f'<circle class="f-red" r="4.5">{anim("cx", nums(xs), dur)}{anim("cy", nums([yv(v_of(t)) for t in tt]), dur)}</circle>')
    o.append(text(370, 30, 'C = 5 F', 't-s', 'end'))
    return ''.join(o)


# ─────────── Lecture 4, slide 25: maximum power transfer ───────────
@fig('ct-max-power', 'Maximum power transfer (Lecture 4, slides 25–28): load power p = (V_Th/(R_Th+R_L))²·R_L for '
     'V_Th = 22 V, R_Th = 9 Ω; as R_L is varied, the power peaks at R_L = R_Th = 9 Ω with p_max = 13.44 W', 400, 240)
def max_power():
    dur = 9
    V, R = 22.0, 9.0
    X0, Y0, W, H = 46, 200, 320, 160
    rmax = 40
    sx = lambda r: X0 + W * r / rmax
    sy = lambda p: Y0 - H * p / 15
    p = lambda r: (V / (R + r)) ** 2 * r
    rs = lin(0, rmax, 121)
    o = [f'<path class="s-mute" d="M{X0},{Y0}H{X0 + W + 8}M{X0},{Y0 + 4}V{Y0 - H - 8}" stroke-width="1.2"/>']
    o.append(text(X0 + W + 6, Y0 - 8, 'R_L (Ω)', 't-s', 'end') + text(X0 + 4, Y0 - H - 10, 'p (W)', 't-s', 'start'))
    for r in (0, 9, 20, 30, 40):
        o.append(text(sx(r), Y0 + 16, str(r), 't-s'))
    for pv in (5, 10):
        o.append(text(X0 - 6, sy(pv) + 4, str(pv), 't-s', 'end'))
    o.append(f'<path class="s-mute" d="M{f(sx(9))},{Y0}V{f(sy(p(9)))}H{X0}" stroke-width="1" stroke-dasharray="3 4"/>')
    o.append(text(sx(9) + 10, sy(p(9)) - 10, 'p_max = 13.44 W', 't-grn', 'start'))
    o.append(f'<path class="s-acc" d="{path([(sx(r), sy(p(r))) for r in rs])}" stroke-width="2.6" fill="none"/>')
    n = 49
    rr = [rmax * (0.5 - 0.5 * math.cos(2 * math.pi * k / (n - 1))) * 0.95 + 0.5 for k in range(n)]
    o.append(f'<circle class="f-red" r="6">{anim("cx", nums([sx(r) for r in rr]), dur)}{anim("cy", nums([sy(p(r)) for r in rr]), dur)}</circle>')
    o.append(f'<circle class="f-grn" cx="{f(sx(9))}" cy="{f(sy(p(9)))}" r="4"/>')
    o.append(text(sx(9) + 8, Y0 - 8, 'R_L = R_Th', 't-grn', 'start'))
    return ''.join(o)
