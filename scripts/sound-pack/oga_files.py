#!/usr/bin/env python3
"""Lists a content page's licence(s), author, and every file it offers: oga_files.py <slug> [<slug> ...]"""
import html, re, sys, time, urllib.request
UA = {'User-Agent': 'vtt-chat-sound-pack/1.0 (licence-checked curation)'}
for slug in sys.argv[1:]:
    time.sleep(1)
    h = urllib.request.urlopen(urllib.request.Request('https://opengameart.org/content/' + slug, headers=UA), timeout=30).read().decode('utf-8', 'replace')
    lic = re.search(r'field-name-field-art-licenses.*?field-items">(.*?)</div></div></div>', h, re.S)
    lt = re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', lic.group(1))).strip() if lic else '?'
    user = re.search(r'href="/users/([^"]+)"', h)
    files = re.findall(r'href="(https://opengameart.org/sites/default/files/[^"]+)"', h)
    print(f"\n## {slug}  by {user.group(1) if user else '?'}  [{lt}]  ({len(files)} files)")
    for f in files[:80]:
        print('  ', f.rsplit('/', 1)[-1])
