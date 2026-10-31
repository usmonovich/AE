"""Animated figures for Mathematics III. All curves are computed from the formulas of the lectures."""
import math
from figlib import fig, f, text  # noqa: F401


def steps_anim(attr, frames, dur, hold=0.75):
    """Discrete animation: each frame is held, then morphs quickly into the next one (cyclic)."""
    n = len(frames)
    vals, kts = [], []
    for i, fr in enumerate(frames):
        t0 = i / n
        t1 = t0 + hold / n
        vals += [fr, fr]
        kts += [t0, t1]
    vals.append(frames[0])
    kts.append(1)
    kt = ';'.join('0' if k == 0 else ('1' if k == 1 else f'{k:.4f}') for k in kts)
    return f'<animate attributeName="{attr}" values="{";".join(vals)}" keyTimes="{kt}" dur="{dur}s" repeatCount="indefinite"/>'


def show_in(i, n, dur, hold=0.75):
    """Opacity 1 only while frame i is held."""
    t0 = i / n
    t1 = t0 + hold / n
    if i == 0:
        return (f'<animate attributeName="opacity" values="1;1;0;0" keyTimes="0;{t1:.4f};{t1 + 0.001:.4f};1" '
                f'dur="{dur}s" repeatCount="indefinite"/>')
    return (f'<animate attributeName="opacity" values="0;0;1;1;0;0" '
            f'keyTimes="0;{t0:.4f};{t0 + 0.001:.4f};{t1:.4f};{t1 + 0.001:.4f};1" dur="{dur}s" repeatCount="indefinite"/>')


def path(pts):
    return 'M' + 'L'.join(f'{f(x)},{f(y)}' for x, y in pts)


def axes(x0, y0, x1, y1, ox, oy):
    """Axes: x from x0 to x1 at height oy, y from y1 (bottom) to y0 (top) at ox."""
    return (f'<path class="s-mute" d="M{f(x0)},{f(oy)}H{f(x1)}M{f(ox)},{f(y1)}V{f(y0)}" stroke-width="1.2"/>')


# ─────────── Lecture 1, slides 5 and 14: xⁿ on [0, 1] ───────────
@fig('m3-xn-nonuniform', 'fₙ(x) = xⁿ on [0, 1]: the curves tend to 0 for every x < 1, but near x = 1 the error '
     'sup|xⁿ − f(x)| stays equal to 1, so the convergence is not uniform (Lecture 1, slides 5 and 14)', 400, 240)
def xn_nonuniform():
    dur = 12
    X0, Y0, W, H = 50, 200, 300, 160          # origin and size of the unit square
    sx = lambda x: X0 + W * x
    sy = lambda y: Y0 - H * y
    ns = [1, 2, 4, 8, 16, 32]
    N = 61
    frames = [path([(sx(i / (N - 1)), sy((i / (N - 1)) ** n)) for i in range(N)]) for n in ns]
    o = [axes(X0 - 8, Y0 - H - 14, X0 + W + 20, Y0 + 6, X0, Y0)]
    o.append(text(X0 + W + 20, Y0 - 6, 'x', 't-s') + text(X0 - 10, Y0 - H - 16, 'y', 't-s'))
    o.append(f'<path class="s-mute" d="M{f(sx(1))},{f(Y0)}V{f(sy(1))}H{f(X0)}" stroke-width="1" stroke-dasharray="3 4"/>')
    o.append(text(sx(1), Y0 + 18, '1', 't-s') + text(X0 - 10, sy(1) + 5, '1', 't-s', 'end') + text(X0 - 8, Y0 + 18, '0', 't-s'))
    # limit function: 0 on [0, 1) and the point (1, 1)
    o.append(f'<path class="s-grn" d="M{f(sx(0))},{f(Y0)}H{f(sx(1) - 5)}" stroke-width="3.2"/>')
    o.append(f'<circle class="f-paper s-grn" cx="{f(sx(1))}" cy="{f(Y0)}" r="4" stroke-width="2"/>')
    o.append(f'<circle class="f-grn" cx="{f(sx(1))}" cy="{f(sy(1))}" r="4.2"/>')
    o.append(text(sx(0.42), Y0 - 14, 'limit f(x) = 0 for x < 1', 't-grn'))
    o.append(f'<path class="s-acc" d="{frames[0]}" stroke-width="2.6" fill="none">{steps_anim("d", frames, dur)}</path>')
    # point where the error equals 1/2: x = (1/2)^(1/n) — moves towards 1
    xs = [0.5 ** (1 / n) for n in ns]
    cx = [f(sx(x)) for x in xs]
    o.append(f'<circle class="f-red" cx="{cx[0]}" cy="{f(sy(0.5))}" r="4.5">{steps_anim("cx", cx, dur)}</circle>')
    o.append(f'<path class="s-red" d="M{f(X0)},{f(sy(0.5))}H{f(sx(1))}" stroke-width="1" stroke-dasharray="2 4"/>')
    for i, n in enumerate(ns):
        o.append(f'<g opacity="{1 if i == 0 else 0}">{show_in(i, len(ns), dur)}'
                 + text(sx(0.3), sy(0.86), f'n = {n}', 't-acc')
                 + text(sx(0.3), sy(0.72), f'xⁿ = 1/2 at x ≈ {xs[i]:.3f}', 't-red') + '</g>')
    o.append(text(200, 232, 'the point with error 1/2 moves to x = 1, but never disappears: sup = 1', 't-s'))
    return ''.join(o)


# ─────────── Lecture 5, slides 13 and 18: square wave and its partial sums ───────────
@fig('m3-fourier-square', 'Square wave (−1 on [−π, 0), 1 on [0, π)) and the partial sums '
     'S_N(x) = (4/π) Σ sin((2k−1)x)/(2k−1): more harmonics give a better approximation; at the jumps '
     'the sums pass through 0, the average of the one-sided limits (Lecture 5, slides 13, 18 and 34)', 400, 230)
def fourier_square():
    dur = 14
    X0, Y0, W, A = 30, 112, 340, 70           # x ∈ [−π, π] → [X0, X0+W]; amplitude 1 → A px
    sx = lambda x: X0 + W * (x + math.pi) / (2 * math.pi)
    sy = lambda y: Y0 - A * y
    Ns = [1, 2, 3, 5, 10, 25]
    M = 241

    def S(N, x):
        return 4 / math.pi * sum(math.sin((2 * k - 1) * x) / (2 * k - 1) for k in range(1, N + 1))
    frames = [path([(sx(-math.pi + 2 * math.pi * i / (M - 1)), sy(S(N, -math.pi + 2 * math.pi * i / (M - 1)))) for i in range(M)]) for N in Ns]
    o = [axes(X0 - 6, Y0 - A - 26, X0 + W + 10, Y0 + A + 20, sx(0), Y0)]
    o.append(text(X0 + W + 6, Y0 - 8, 'x', 't-s'))
    for xv, lab in ((-math.pi, '−π'), (-math.pi / 2, '−π/2'), (math.pi / 2, 'π/2'), (math.pi, 'π')):
        o.append(f'<path class="s-mute" d="M{f(sx(xv))},{f(Y0 - 3)}V{f(Y0 + 3)}" stroke-width="1"/>' + text(sx(xv), Y0 + 16, lab, 't-s'))
    o.append(text(sx(0) - 6, sy(1) + 4, '1', 't-s', 'end') + text(sx(0) + 6, sy(-1) + 4, '−1', 't-s', 'start'))
    # the square wave itself
    o.append(f'<path class="s-grn" d="M{f(sx(-math.pi))},{f(sy(-1))}H{f(sx(0))}M{f(sx(0))},{f(sy(1))}H{f(sx(math.pi))}" stroke-width="3"/>')
    o.append(f'<circle class="f-grn" cx="{f(sx(0))}" cy="{f(Y0)}" r="3.6"/>')
    o.append(f'<path class="s-acc" d="{frames[0]}" stroke-width="2" fill="none">{steps_anim("d", frames, dur)}</path>')
    for i, N in enumerate(Ns):
        terms = '1 harmonic' if N == 1 else f'{N} harmonics'
        o.append(f'<g opacity="{1 if i == 0 else 0}">{show_in(i, len(Ns), dur)}'
                 + text(sx(-math.pi) + 4, 24, f'S_N, N = {N}: {terms}', 't-acc', 'start') + '</g>')
    o.append(text(sx(math.pi) - 4, 24, 'f(x) — square wave', 't-grn', 'end'))
    o.append(text(200, 222, 'at x = 0 every S_N equals 0 = ½[f(0⁺) + f(0⁻)]', 't-s'))
    return ''.join(o)


# ─────────── Lecture 8, slides 23 and 31: damped oscillation vs resonance ───────────
@fig('m3-damped-resonance', 'Two solutions from Lecture 8: y = e⁻ˣ·cos 2x — complex roots −1 ± 2i give a damped '
     'oscillation (quick classification table, slide 18) — and the resonant particular solution y = −(x/2)·cos x of '
     'y″ + y = sin x, whose amplitude grows like x/2 (slide 31)', 400, 250)
def damped_resonance():
    dur = 9
    X0, W = 34, 346
    o = []

    def panel(y0, h, xmax, fn, env, cls, label, sub):
        sx = lambda x: X0 + W * x / xmax
        sy = lambda y: y0 - h * y
        M = 301
        pts = [(sx(xmax * i / (M - 1)), sy(fn(xmax * i / (M - 1)))) for i in range(M)]
        d = path(pts)
        L = sum(math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(pts, pts[1:]))
        out = [axes(X0 - 4, y0 - h - 6, X0 + W + 8, y0 + h + 4, X0, y0)]
        e1 = path([(sx(xmax * i / 60), sy(env(xmax * i / 60))) for i in range(61)])
        e2 = path([(sx(xmax * i / 60), sy(-env(xmax * i / 60))) for i in range(61)])
        out.append(f'<path class="s-mute" d="{e1}{e2}" stroke-width="1.2" stroke-dasharray="4 4" fill="none"/>')
        out.append(f'<path class="{cls}" d="{d}" stroke-width="2.4" fill="none" stroke-dasharray="{f(L)}" stroke-dashoffset="{f(L)}">'
                   f'<animate attributeName="stroke-dashoffset" values="{f(L)};0;0" keyTimes="0;0.75;1" dur="{dur}s" repeatCount="indefinite"/></path>')
        out.append(text(X0 + W, y0 - h - 10, label, 't-' + cls[2:], 'end'))
        out.append(text(X0 + 6, y0 - h - 10, sub, 't-s', 'start'))
        return ''.join(out)
    o.append(panel(72, 46, 4.5, lambda x: math.exp(-x) * math.cos(2 * x), lambda x: math.exp(-x),
                   's-acc', 'y = e⁻ˣ cos 2x', 'roots −1 ± 2i: damped')) 
    o.append(panel(186, 50 / 6.5, 13.0, lambda x: -x / 2 * math.cos(x), lambda x: x / 2,
                   's-red', 'y = −(x/2) cos x', 'resonance: amplitude x/2 grows'))
    o.append(text(200, 244, 'dashed lines — envelopes ±e⁻ˣ and ±x/2', 't-s'))
    return ''.join(o)
