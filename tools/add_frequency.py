#!/usr/bin/env python3
"""
Добавляет частотность слов в таблицу оценок.

Источник — пакет wordfreq (Speer, 2022): сводные частоты русского языка по нескольким корпусам
(Википедия, субтитры, новости, книги, интернет). Это НЕ Национальный корпус русского языка:
в статье указывайте источник именно так.

Столбцы: «частотность» — число словоупотреблений на миллион (ipm), «zipf» — шкала Zipf (log10 ipm + 3).
Слова, которых нет в словаре, получают пустое значение (в генераторе такие слова не мешают,
но уравнивание по частотности для них отключается).

Использование: pip install wordfreq; python3 tools/add_frequency.py вход.csv выход.csv
"""
import csv, sys
from wordfreq import word_frequency, zipf_frequency


def main(src, dst):
    with open(src, encoding='utf-8-sig', newline='') as f:
        rows = list(csv.DictReader(f, delimiter=';'))
    missing = []
    for r in rows:
        w = r['слово'].strip().lower()
        ipm = word_frequency(w, 'ru') * 1e6
        if ipm <= 0:
            r['частотность'] = ''
            r['zipf'] = ''
            missing.append(r['слово'])
        else:
            r['частотность'] = f'{ipm:.2f}'.replace('.', ',')
            r['zipf'] = f'{zipf_frequency(w, "ru"):.2f}'.replace('.', ',')
    cols = list(rows[0].keys())
    with open(dst, 'w', encoding='utf-8-sig', newline='') as f:
        w = csv.DictWriter(f, fieldnames=cols, delimiter=';')
        w.writeheader()
        w.writerows(rows)
    print(f'слов: {len(rows)}, без частоты: {len(missing)} {missing[:20]}')


if __name__ == '__main__':
    main(*sys.argv[1:3])
