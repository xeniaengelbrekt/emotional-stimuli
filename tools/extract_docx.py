#!/usr/bin/env python3
"""
Достаёт из .docx с валидационными данными фотографии и средние оценки.

Структура документа: подпись («sad_animals_1»), затем фотография и столбчатая
диаграмма matplotlib (800×500) со средними оценками по пяти шкалам
(Угроза, Нейтральность, Грусть, Позитивность, Реалистичность; ось 1–5).
Значения считываются по высоте столбцов (точность ≈ 0.012 балла на пиксель).

Использование: python3 tools/extract_docx.py файл.docx папка_вывода
Результат: папка_вывода/images/*.jpg|png и папка_вывода/ratings.csv
"""
import csv, re, shutil, sys, zipfile
from pathlib import Path
import numpy as np
from PIL import Image

Y_TOP, Y_BOTTOM = 35, 382          # пиксельные строки значений 5.0 и 1.0
VMIN, VMAX = 1.0, 5.0
SCALES = ['threat', 'neutral', 'sad', 'positive', 'realism']   # порядок столбцов на диаграммах
BAR = np.array([135, 206, 235])
CENTER0, STEP = 153, 136                 # центры столбцов по x (одинаковы на всех диаграммах)

CATS = {'sad': 'sad', 'spositiv': 'positive', 'positiv': 'positive', 'positive': 'positive',
        'danger': 'threat', 'neutral': 'neutral'}
GROUPS = {'animals': 'animals', 'person': 'person', 'perso': 'person', 'group': 'people',
          'subject': 'objects', 'subjects': 'objects'}


def parse_label(label):
    m = re.match(r'^\s*([a-z]+)[_ ]+([a-z]+)', label.lower())
    if not m or m.group(1) not in CATS or m.group(2) not in GROUPS:
        raise ValueError(f'не разобрана подпись: {label!r}')
    return CATS[m.group(1)], GROUPS[m.group(2)]


def read_bars(path):
    a = np.array(Image.open(path).convert('RGB')).astype(int)
    isbar = (np.abs(a - BAR).sum(2) < 40)
    vals = []
    for k in range(5):
        x = CENTER0 + STEP * k - 30                  # в стороне от линии доверительного интервала
        hit = np.where(isbar[Y_TOP:Y_BOTTOM + 1, x])[0]
        if not len(hit):                             # столбец нулевой высоты = минимум шкалы
            vals.append(VMIN)
            continue
        top = hit.min() + Y_TOP - 1                  # −1: чёрная рамка столбца
        vals.append(VMIN + (Y_BOTTOM - top) / (Y_BOTTOM - Y_TOP) * (VMAX - VMIN))
    return vals


def main(docx, out):
    out = Path(out); (out / 'images').mkdir(parents=True, exist_ok=True)
    tmp = out / '_docx'
    with zipfile.ZipFile(docx) as z:
        z.extractall(tmp)
    xml = (tmp / 'word/document.xml').read_text(encoding='utf-8')
    xml = re.sub(r'<mc:Fallback>.*?</mc:Fallback>', '', xml, flags=re.S)
    rels = (tmp / 'word/_rels/document.xml.rels').read_text(encoding='utf-8')
    rid = {}
    for m in re.finditer(r'<Relationship ([^>]*)/?>', rels):
        a = dict(re.findall(r'(\w+)="([^"]*)"', m.group(1))); rid[a['Id']] = a['Target']

    # подпись = весь текст между парами картинок (подписи бывают разбиты на несколько фрагментов)
    items, text = [], ''
    pending = []
    for tok in re.findall(r'<w:t[ >][^<]*</w:t>|<w:t>[^<]*</w:t>|r:embed="[^"]+"', xml):
        if tok.startswith('r:embed'):
            pending.append(rid[tok[9:-1]].replace('media/', ''))
            if len(pending) == 2:
                items.append((text.strip(), pending)); text, pending = '', []
        else:
            text += re.sub(r'<[^>]+>', '', tok)

    rows, counters = [], {}
    for label, files in items:
        cat, grp = parse_label(label)
        chart = next(f for f in files if Image.open(tmp / 'word/media' / f).size == (800, 500))
        photo = next(f for f in files if f != chart)
        vals = dict(zip(SCALES, read_bars(tmp / 'word/media' / chart)))
        k = counters[(grp, cat)] = counters.get((grp, cat), 0) + 1
        name = f'{grp}_{cat}_{k:02d}{Path(photo).suffix.lower()}'
        shutil.copy(tmp / 'word/media' / photo, out / 'images' / name)
        rows.append({'файл': name, 'группа': grp, 'метка_в_документе': label, 'исходный_файл': photo,
                     'нейтральность': round(vals['neutral'], 2), 'позитивность': round(vals['positive'], 2),
                     'грусть': round(vals['sad'], 2), 'угроза': round(vals['threat'], 2),
                     'реалистичность': round(vals['realism'], 2)})
    with open(out / 'ratings.csv', 'w', newline='', encoding='utf-8-sig') as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]), delimiter=';')
        w.writeheader(); w.writerows(rows)
    shutil.rmtree(tmp)
    print(f'Готово: {len(rows)} изображений → {out}')


if __name__ == '__main__':
    main(*sys.argv[1:3])
