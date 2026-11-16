#!/usr/bin/env python3
"""Builds the shared starter pack (backend/assets/sounds) from picks.json.

For each pick: fetch the OpenGameArt page, REFUSE unless CC0 is among its licences, download the file, then
ffmpeg it to a loudness-normalised mono/stereo Ogg Vorbis (beds are crossfaded so the end flows into the start;
one-shots are trimmed of silence). Writes catalogue.json and SOURCES.md (who made each clip, where it came from,
its licence). Downloads are cached in scripts/sound-pack/.cache (git-ignored); one request per second.

    scripts/sound-pack/build.py            # needs ffmpeg
"""
import json, pathlib, re, subprocess, sys, time, urllib.parse, urllib.request, html

HERE = pathlib.Path(__file__).parent
OUT = HERE.parent.parent / 'backend' / 'assets' / 'sounds'
CACHE = HERE / '.cache'
UA = {'User-Agent': 'vtt-chat-sound-pack/1.0 (licence-checked CC0 curation)'}
LOUD = {'ambience': -24, 'music': -20, 'effect': -18}   # integrated LUFS target per kind of sound
FADE = 3.0                                               # seconds of loop crossfade for beds


def get(url, binary=False):
    time.sleep(1)
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120) as r:
        data = r.read()
    return data if binary else data.decode('utf-8', 'replace')


def page_facts(slug):
    h = get('https://opengameart.org/content/' + slug)
    lic = re.search(r'field-name-field-art-licenses.*?field-items">(.*?)</div></div></div>', h, re.S)
    text = re.sub(r'<[^>]+>', ' ', lic.group(1)) if lic else ''
    if 'CC0' not in text:
        sys.exit(f'REFUSED: {slug} does not list CC0 ({text.strip()!r})')
    title = html.unescape(re.search(r'<title>(.*?) \|', h).group(1))
    user = re.search(r'href="/users/([^"]+)"', h)
    files = re.findall(r'href="(https://opengameart.org/sites/default/files/[^"]+\.(?:ogg|mp3|wav|flac))"', h)
    return title, urllib.parse.unquote(user.group(1)) if user else 'unknown', files


def encode(src, dst, pick):
    dur = float(subprocess.check_output(
        ['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', str(src)]).strip())
    max_sec = pick.get('maxSec')
    take = min(dur, max_sec) if max_sec else dur
    lufs = LOUD[pick['category']]
    norm = f'loudnorm=I={lufs}:TP=-2:LRA=9'
    if pick['kind'] == 'bed' and take > FADE * 3:
        f = FADE
        graph = (f'[0:a]atrim=0:{take},asetpts=PTS-STARTPTS,asplit[a][b];'
                 f'[a]atrim=start={f},asetpts=PTS-STARTPTS[body];[b]atrim=end={f},asetpts=PTS-STARTPTS[head];'
                 f'[body][head]acrossfade=d={f}:c1=tri:c2=tri,{norm}[out]')
        args = ['-filter_complex', graph, '-map', '[out]']
    elif pick['kind'] == 'oneshot':
        args = ['-af', f'silenceremove=start_periods=1:start_threshold=-50dB,areverse,'
                       f'silenceremove=start_periods=1:start_threshold=-50dB,areverse,{norm}']
    else:
        args = ['-t', str(take), '-af', norm]
    subprocess.check_call(['ffmpeg', '-v', 'error', '-y', '-i', str(src), *args,
                           '-ar', '44100', '-c:a', 'libvorbis', '-q:a', '3', str(dst)])


def main():
    picks = json.loads((HERE / 'picks.json').read_text())
    CACHE.mkdir(exist_ok=True)
    sources, sounds = [], []
    for p in picks['sounds']:
        title, author, files = page_facts(p['page'])
        match = [f for f in files if p['file'].lower() in urllib.parse.unquote(f).lower()]
        if not match:
            sys.exit(f"no file matching {p['file']!r} on {p['page']}: {files}")
        url = match[0]
        cached = CACHE / re.sub(r'[^A-Za-z0-9._-]', '_', urllib.parse.unquote(url.rsplit('/', 1)[-1]))
        if not cached.exists():
            cached.write_bytes(get(url, binary=True))
        rel = f"{p['category']}/{p['key']}.ogg"
        (OUT / p['category']).mkdir(parents=True, exist_ok=True)
        encode(cached, OUT / rel, p)
        size = (OUT / rel).stat().st_size
        print(f"{rel}  {size // 1024} KB  <- {p['page']} ({author})")
        sounds.append({'key': p['key'], 'name': p['name'], 'category': p['category'], 'takes': [rel]})
        sources.append((rel, title, author, 'https://opengameart.org/content/' + p['page'], size))
    catalogue = {'version': 1, 'sounds': sounds, 'boards': picks['boards'], 'scenes': picks['scenes']}
    (OUT / 'catalogue.json').write_text(json.dumps(catalogue, indent=2) + '\n')
    lines = ['# Starter sound pack: sources and licences', '',
             'Every clip is CC0 (public domain) from [OpenGameArt](https://opengameart.org), checked against the page\'s',
             'licence list by `scripts/sound-pack/build.py`, which refuses anything that does not list CC0. Clips are',
             'loudness-normalised and re-encoded to Ogg Vorbis; beds are crossfaded to loop. No credit is required;',
             'it is given here anyway.', '', '| File | Work | Author | Page | Size |', '| --- | --- | --- | --- | --- |']
    for rel, title, author, page, size in sources:
        lines.append(f'| `{rel}` | {title} | {author} | {page} | {size // 1024} KB |')
    lines.append(f'\nTotal: {sum(s[4] for s in sources) // 1024} KB.')
    (OUT / 'SOURCES.md').write_text('\n'.join(lines) + '\n')
    print('total', sum(s[4] for s in sources) // 1024, 'KB')
    print('now run: npx prettier --write backend/assets/sounds/catalogue.json')


if __name__ == '__main__':
    main()
