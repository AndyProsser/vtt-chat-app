#!/usr/bin/env python3
"""Finds CC0 candidates on Freesound for each slot in slots.json and writes candidates.json (with preview URLs).
Nothing is added to the pack from here: Andy listens to the candidates, then the chosen ones go in picks.json.

The API key is read from ~/.config/vtt-chat/freesound.key (never printed, never committed).
    scripts/sound-pack/freesound.py [slot-key ...]
"""
import json, os, pathlib, sys, time, urllib.parse, urllib.request

HERE = pathlib.Path(__file__).parent
KEY = pathlib.Path(os.path.expanduser('~/.config/vtt-chat/freesound.key')).read_text().strip()
FIELDS = 'id,name,duration,license,tags,username,avg_rating,num_ratings,num_downloads,description,previews,url'


def search(query, lo, hi, n):
    params = {
        'query': query + ' -music -song -melody -beat',
        'filter': f'license:"Creative Commons 0" duration:[{lo} TO {hi}]',
        'sort': 'rating_desc',
        'page_size': n,
        'fields': FIELDS,
        'token': KEY,
    }
    url = 'https://freesound.org/apiv2/search/text/?' + urllib.parse.urlencode(params)
    time.sleep(1.2)  # the API allows 60 requests a minute
    with urllib.request.urlopen(url, timeout=30) as r:
        return json.load(r)['results']


def main():
    args = sys.argv[1:]
    slots_file = args.pop(0)[len('--slots='):] if args and args[0].startswith('--slots=') else 'slots.json'
    slots = json.loads((HERE / slots_file).read_text())
    only = set(args)
    out = json.loads((HERE / 'candidates.json').read_text()) if slots_file != 'slots.json' and (HERE / 'candidates.json').exists() else {}
    for slot in slots:
        if only and slot['key'] not in only:
            continue
        found = {}
        for q in slot['queries']:
            for r in search(q, slot['min'], slot['max'], 8):
                found.setdefault(r['id'], r)
        ranked = sorted(found.values(), key=lambda r: (r.get('avg_rating') or 0, r.get('num_downloads') or 0), reverse=True)
        out[slot['key']] = {
            'name': slot['name'], 'kind': slot['kind'], 'category': slot['category'],
            'candidates': [{
                'id': r['id'], 'name': r['name'], 'duration': round(r['duration'], 1), 'user': r['username'],
                'rating': r.get('avg_rating'), 'downloads': r.get('num_downloads'), 'tags': r['tags'][:12],
                'description': (r.get('description') or '')[:200].replace('\n', ' '), 'page': r['url'],
                'preview': r['previews']['preview-hq-mp3'],
            } for r in ranked[:slot.get('top', 5)]],
        }
        print(f"{slot['key']}: {len(ranked)} found, kept {len(out[slot['key']]['candidates'])}")
    (HERE / 'candidates.json').write_text(json.dumps(out, indent=2))


if __name__ == '__main__':
    main()
