#!/usr/bin/env python3
"""Lists CC0 audio on OpenGameArt matching search words, with the facts needed to choose one:
title, author, licence list, description snippet and file links. Read-only; one request per second.

    scripts/sound-pack/discover.py rain "tavern music" --per 6
"""
import argparse, html, re, sys, time, urllib.parse, urllib.request

UA = {'User-Agent': 'vtt-chat-sound-pack/1.0 (licence-checked CC0 curation)'}

def get(url):
    time.sleep(1)
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
        return r.read().decode('utf-8', 'replace')

def search(words, per):
    q = urllib.parse.urlencode({'keys': words, 'sort_by': 'count', 'sort_order': 'DESC'})
    url = ('https://opengameart.org/art-search-advanced?' + q +
           '&field_art_type_tid%5B%5D=12&field_art_licenses_tid%5B%5D=4')
    slugs = []
    for s in re.findall(r'href="/content/([^"/?#]+)"', get(url)):
        if s not in slugs and s != 'faq':
            slugs.append(s)
    return slugs[:per]

def detail(slug):
    h = get('https://opengameart.org/content/' + slug)
    lic = re.search(r'field-name-field-art-licenses.*?field-items">(.*?)</div></div></div>', h, re.S)
    lics = sorted(set(re.findall(r"license-name'?>?([^<]+)<", lic.group(1)))) if lic else []
    lic_txt = re.sub(r'<[^>]+>', ' ', lic.group(1)) if lic else ''
    cc0 = 'CC0' in lic_txt
    only_cc0 = cc0 and not re.search(r'CC-BY|GPL|OGA-BY', lic_txt)
    title = html.unescape(re.search(r'<title>(.*?) \|', h).group(1))
    user = re.search(r'href="/users/([^"]+)"', h)
    body = re.search(r'field-name-body.*?field-item even">(.*?)</div>', h, re.S)
    desc = html.unescape(re.sub(r'<[^>]+>', ' ', body.group(1)))[:220].strip() if body else ''
    files = re.findall(r'href="(https://opengameart.org/sites/default/files/[^"]+\.(?:ogg|mp3|wav|flac))"', h)
    return dict(slug=slug, title=title, author=user.group(1) if user else '?', cc0=cc0,
                only_cc0=only_cc0, desc=re.sub(r'\s+', ' ', desc), files=files[:4])

if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('queries', nargs='+')
    ap.add_argument('--per', type=int, default=6)
    a = ap.parse_args()
    for q in a.queries:
        print(f'\n## {q}')
        try:
            for s in search(q, a.per):
                d = detail(s)
                flag = 'CC0' if d['only_cc0'] else ('cc0+other' if d['cc0'] else 'NOT-CC0')
                print(f"- {d['slug']} [{flag}] by {d['author']}: {d['title']} :: {d['desc']}")
                for f in d['files']:
                    print('    ', f.rsplit('/', 1)[-1])
        except Exception as e:
            print('  error', e, file=sys.stderr)
