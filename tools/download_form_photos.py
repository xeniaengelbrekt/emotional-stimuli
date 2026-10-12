"""Скачивает картинки опросных форм и называет их метками из таблицы оценок (порядок вопросов = порядок «фото_в_опросе»).

  python3 -I tools/download_form_photos.py <папка со структурами форм (*.json)> <таблица photos_ratings_*.csv> <куда сохранить>
Картинки лежат в публичной форме респондента; имена файлов в ней не видны, поэтому имя берётся из таблицы оценок.
"""
import csv, glob, json, os, re, sys, urllib.request
from concurrent.futures import ThreadPoolExecutor

EXT = {b'\xff\xd8\xff': '.jpg', b'\x89PNG': '.png', b'RIFF': '.webp'}


def main(forms_dir, table, out):
    rows = list(csv.DictReader(open(table, encoding='utf-8-sig'), delimiter=';'))
    label = {(int(r['опрос_№']), int(r['фото_в_опросе'])): r['файл'] for r in rows}
    jobs, problems = [], []
    for p in glob.glob(os.path.join(forms_dir, '*.json')):
        d = json.load(open(p, encoding='utf-8'))
        n = int(re.search(r'(\d+)\s*$', d['name']).group(1))
        imgs = [it for pg in d['pages'] for it in pg['items'] if it.get('image') and it['type'] == 'matrix']
        expected = sum(1 for k in label if k[0] == n)
        if len(imgs) != expected:
            problems.append(f'опрос {n}: в форме {len(imgs)} картинок, в таблице {expected}')
        for k, it in enumerate(imgs, 1):
            if (n, k) in label:
                links = it['image']['links']
                jobs.append((n, k, label[(n, k)], links.get('2560x') or links.get('1280x')))
    os.makedirs(out, exist_ok=True)

    def get(job):
        n, k, name, url = job
        for _ in range(3):
            try:
                data = urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'}), timeout=60).read()
                ext = next((e for sig, e in EXT.items() if data.startswith(sig)), '.jpg')
                open(os.path.join(out, name + ext), 'wb').write(data)
                return None
            except Exception as e:  # noqa
                err = str(e)
        return f'{name}: {err}'

    with ThreadPoolExecutor(6) as ex:
        problems += [r for r in ex.map(get, sorted(jobs)) if r]
    return len(jobs), problems


if __name__ == '__main__':
    n, problems = main(*sys.argv[1:4])
    print('скачано', n); print('\n'.join(problems) or 'проблем нет')
