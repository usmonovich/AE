#!/usr/bin/env python3
"""Шаг 1 импорта: PDF со сканами/фото → изображения страниц для приложения и для распознавания.

Развороты (ширина > высоты) режутся на левую (L) и правую (R) страницы.
Выход: <out>/<префикс>XX[L|R].webp (для приложения, серые, ~70 КБ) и <out>/ocr/pXX[L|R].jpg (для распознавания, до 1400 px).
Использование: python3 tools/import/pdf_to_pages.py input.pdf content/subjects/<предмет>/pages <префикс: одна буква>
Требуется: poppler-utils (pdfimages), Pillow.
"""
import subprocess, sys, tempfile, glob, os, hashlib
from PIL import Image, ImageOps

def main(pdf, out, prefix='p'):
    os.makedirs(os.path.join(out, 'ocr'), exist_ok=True)
    sha = hashlib.sha256(open(pdf, 'rb').read()).hexdigest()
    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run(['pdfimages', '-j', pdf, os.path.join(tmp, 'img')], check=True)
        files = sorted(glob.glob(os.path.join(tmp, 'img-*')))
        if not files:
            sys.exit('В PDF нет изображений страниц — это текстовый PDF, используйте pdftotext.')
        refs = []
        for n, f in enumerate(files, start=1):
            im = ImageOps.exif_transpose(Image.open(f)).convert('RGB')
            w, h = im.size
            parts = [('', (0, 0, w, h))] if w < h else [('L', (0, 0, w // 2, h)), ('R', (w // 2, 0, w, h))]
            for side, box in parts:
                ref = f'{prefix}{n:02d}{side}'
                page = im.crop(box)
                ocr = page.copy(); ocr.thumbnail((1400, 1400)); ocr.save(os.path.join(out, 'ocr', ref + '.jpg'), quality=85)
                app = ImageOps.autocontrast(page.convert('L'), cutoff=1); app.thumbnail((820, 1180))
                app.save(os.path.join(out, ref + '.webp'), 'WEBP', quality=40, method=6)
                refs.append(ref)
    print(f'sha256={sha}\nлистов PDF: {len(files)}, страниц: {len(refs)}\nпервые: {refs[:3]} … последние: {refs[-3:]}')

if __name__ == '__main__':
    if len(sys.argv) not in (3, 4):
        sys.exit(__doc__)
    main(*sys.argv[1:])
