"""Сборка средних оценок картинок из выгрузок Яндекс Форм (16 опросов по 25 картинок).

Использование:
  python3 -I tools/build_validation_ratings.py <папка с выгрузками> <старая таблица photos_ratings_386.csv> <куда писать>

Выгрузка: csv или xlsx; файл опроса N имеет номер N перед расширением. Столбцы оценок —
блоки по 5 (Угроза, Нейтральность, Грусть, Позитивность, Реалистичность) в порядке картинок в форме;
первым считается столбец, заголовок которого начинается с «/». Если для опроса есть и csv, и xlsx,
берётся файл с большим числом респондентов. Личные данные (пол, возраст, специальность, ID) в результат не попадают.
"""
import csv, glob, os, re, statistics as st, sys
import openpyxl

SCALES = ['угроза', 'нейтральность', 'грусть', 'позитивность', 'реалистичность']
EN = {'угроза': 'threat', 'нейтральность': 'neutral', 'грусть': 'sad', 'позитивность': 'positive', 'реалистичность': 'realism'}


def load(path):
    if path.endswith('.csv'):
        return list(csv.reader(open(path, encoding='utf-8-sig')))
    ws = openpyxl.load_workbook(path, read_only=True, data_only=True).active
    return [['' if c is None else str(c) for c in r] for r in ws.iter_rows(values_only=True)]


def num(x):
    try:
        v = float(str(x).replace(',', '.'))
        return v if 1 <= v <= 5 else None
    except ValueError:
        return None


def read_survey(path):
    rows = load(path)
    head = rows[0]
    first = next(i for i, c in enumerate(head) if c.strip().startswith('/'))
    n_score = sum(1 for c in head if c.strip().startswith('/'))
    assert n_score % 5 == 0, (path, n_score)
    body = [r for r in rows[1:] if any(c.strip() for c in r)]
    dur = next((i for i, c in enumerate(head) if 'затраченное' in c.lower()), None)
    resp = []
    for r in body:
        r = r + [''] * (len(head) - len(r))
        vals = [num(x) for x in r[first:first + n_score]]
        resp.append({'vals': vals, 'time': r[head.index('Время создания')] if 'Время создания' in head else '', 'dur': r[dur] if dur is not None else ''})
    return {'n_photos': n_score // 5, 'resp': resp}


def photo_stats(resp, k, skip=()):
    out = {}
    for j, s in enumerate(SCALES):
        v = [r['vals'][5 * k + j] for i, r in enumerate(resp) if i not in skip and r['vals'][5 * k + j] is not None]
        out[s] = (st.mean(v) if v else None, st.stdev(v) if len(v) > 1 else None, len(v))
    return out


def corr(a, b):
    ma, mb = st.mean(a), st.mean(b)
    return sum((x - ma) * (y - mb) for x, y in zip(a, b)) / (sum((x - ma) ** 2 for x in a) * sum((y - mb) ** 2 for y in b)) ** .5


def respondent_quality(resp, n_photos):
    """Согласие каждого респондента с остальными (корреляция его ответов со средним остальных) и доля одинаковых ответов."""
    K = n_photos * 5
    out = []
    for i, r in enumerate(resp):
        v = r['vals']
        mine, cons = [], []
        for j in range(K):
            if v[j] is None:
                continue
            o = [x['vals'][j] for t, x in enumerate(resp) if t != i and x['vals'][j] is not None]
            if len(o) >= 3:
                mine.append(v[j]); cons.append(st.mean(o))
        agree = corr(mine, cons) if len(mine) > 10 and st.pstdev(mine) > 0 else float('nan')
        vals = [x for x in v if x is not None]
        same = max(vals.count(x) for x in set(vals)) / len(vals) if vals else 1.0
        out.append({'agree': agree, 'same': same, 'missing': sum(x is None for x in v)})
    return out


def main(folder, old_path, out_dir, min_agree=0.3, max_same=0.6):
    files = {}
    for p in glob.glob(os.path.join(folder, '*')):
        m = re.search(r'(\d+)\.(csv|xlsx)$', p)
        if not m:
            continue
        n = int(m.group(1)); s = read_survey(p)
        if n not in files or len(s['resp']) > len(files[n]['resp']):
            files[n] = s
    old = list(csv.DictReader(open(old_path, encoding='utf-8-sig'), delimiter=';'))
    f = lambda x: float(x.replace(',', '.'))
    fmt = lambda x, d=2: '' if x is None else f'{x:.{d}f}'.replace('.', ',')
    cols = ['файл', 'группа', 'метка_автора', 'нейтральность', 'позитивность', 'грусть', 'угроза', 'реалистичность', 'число_оценок',
            'sd_нейтральность', 'sd_позитивность', 'sd_грусть', 'sd_угроза', 'sd_реалистичность', 'опрос_№', 'фото_в_опросе',
            'прежнее_число_оценок', 'сдвиг_нейтральность', 'сдвиг_позитивность', 'сдвиг_грусть', 'сдвиг_угроза', 'сдвиг_реалистичность', 'примечание']
    quality, tables = [], {'all': [], 'filtered': []}
    for n, s in sorted(files.items()):
        q = respondent_quality(s['resp'], s['n_photos'])
        bad = {i for i, x in enumerate(q) if not (x['agree'] >= min_agree) or x['same'] > max_same}
        for i, (x, r) in enumerate(zip(q, s['resp'])):
            quality.append({'опрос': n, 'строка_в_выгрузке': i + 2, 'дата': r['time'][:10], 'согласие_с_остальными': fmt(x['agree']), 'доля_одинаковых_ответов': fmt(x['same']), 'пропусков': x['missing'], 'исключён_в_filtered': int(i in bad)})
        o = {int(r['фото_в_опросе']): r for r in old if r['опрос_№'] == str(n)}
        for k in range(s['n_photos']):
            r0 = o[k + 1]
            for mode, skip in (('all', ()), ('filtered', bad)):
                ps = photo_stats(s['resp'], k, skip)
                row = {c: '' for c in cols}
                row.update({'файл': r0['файл'], 'группа': r0['группа'], 'метка_автора': r0['метка_автора'], 'опрос_№': n, 'фото_в_опросе': k + 1,
                            'число_оценок': ps['нейтральность'][2], 'прежнее_число_оценок': r0['число_оценок'], 'примечание': r0.get('примечание', '')})
                for sc in SCALES:
                    row[sc] = fmt(ps[sc][0]); row['sd_' + sc] = fmt(ps[sc][1])
                    row['сдвиг_' + sc] = fmt(ps[sc][0] - f(r0[sc])) if ps[sc][0] is not None else ''
                tables[mode].append(row)
    os.makedirs(out_dir, exist_ok=True)
    for name, rows in (('photos_ratings_updated_all.csv', tables['all']), ('photos_ratings_updated_filtered.csv', tables['filtered'])):
        with open(os.path.join(out_dir, name), 'w', encoding='utf-8-sig', newline='') as fh:
            w = csv.DictWriter(fh, cols, delimiter=';'); w.writeheader(); w.writerows(rows)
    with open(os.path.join(out_dir, 'respondent_quality.csv'), 'w', encoding='utf-8-sig', newline='') as fh:
        w = csv.DictWriter(fh, list(quality[0]), delimiter=';'); w.writeheader(); w.writerows(quality)
    return files, quality


if __name__ == '__main__':
    main(*sys.argv[1:4])
