#!/usr/bin/env python3
"""Builds the shared starter pack (backend/assets/sounds) from picks.json.

For each pick (from OpenGameArt, Freesound or a Kenney zip you downloaded): REFUSE unless the source says CC0, then
ffmpeg it to a loudness-normalised mono/stereo Ogg Vorbis (beds are crossfaded so the end flows into the start;
one-shots are trimmed of silence). Writes catalogue.json and SOURCES.md (who made each clip, where it came from,
its licence). Downloads are cached in scripts/sound-pack/.cache (git-ignored); one request per second.

    scripts/sound-pack/build.py            # needs ffmpeg
"""
import json, os, pathlib, re, subprocess, sys, time, urllib.parse, urllib.request, html, zipfile

HERE = pathlib.Path(__file__).parent
OUT = HERE.parent.parent / 'backend' / 'assets' / 'sounds'
CACHE = HERE / '.cache'
UA = {'User-Agent': 'vtt-chat-sound-pack/1.0 (licence-checked CC0 curation)'}
LOUD = {'ambience': -28, 'music': -22, 'effect': -18}   # integrated LUFS target per kind of sound
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


def freesound_facts(sound_id):
    key = pathlib.Path(os.path.expanduser('~/.config/vtt-chat/freesound.key')).read_text().strip()
    fields = 'id,name,license,username,url,previews'
    r = json.loads(get(f'https://freesound.org/apiv2/sounds/{sound_id}/?fields={fields}&token={key}'))
    if 'publicdomain/zero' not in r['license']:
        sys.exit(f"REFUSED: freesound {sound_id} is not CC0 ({r['license']})")
    return r['name'], r['username'], r['url'], r['previews']['preview-hq-mp3']


KENNEY_DIR = pathlib.Path(os.path.expanduser('~/Downloads/kenney'))


def kenney_extract(spec):
    """`rpg-audio/drawKnife1` -> a cached .ogg from the zip in ~/Downloads/kenney, refusing unless the zip is CC0."""
    pack, name = spec.split('/', 1)
    zpath = KENNEY_DIR / f'kenney_{pack}.zip'
    with zipfile.ZipFile(zpath) as z:
        lic = next((n for n in z.namelist() if n.lower().endswith('license.txt')), None)
        if not lic or 'CC0' not in z.read(lic).decode('utf-8', 'replace'):
            sys.exit(f'REFUSED: {zpath.name} does not carry a CC0 licence file')
        member = next((n for n in z.namelist() if n.endswith('/' + name + '.ogg') or n == name + '.ogg'), None)
        if not member:
            sys.exit(f'no {name}.ogg in {zpath.name}')
        out = CACHE / f'kenney_{pack}_{name}.ogg'
        out.write_bytes(z.read(member))
    return out, f'Kenney {pack}: {name}', 'Kenney (kenney.nl)', f'https://kenney.nl/assets/{pack}'


def fetch(spec):
    """One source spec -> (cached file, title, author, page)."""
    if 'kenney' in spec:
        return kenney_extract(spec['kenney'])
    if 'freesound' in spec:
        title, author, page, url = freesound_facts(spec['freesound'])
        cached = CACHE / f"freesound_{spec['freesound']}.mp3"
    else:
        title, author, files = page_facts(spec['page'])
        page = 'https://opengameart.org/content/' + spec['page']
        match = [f for f in files if spec['file'].lower() in urllib.parse.unquote(f).lower()]
        if not match:
            sys.exit(f"no file matching {spec['file']!r} on {spec['page']}: {files}")
        url = match[0]
        cached = CACHE / re.sub(r'[^A-Za-z0-9._-]', '_', urllib.parse.unquote(url.rsplit('/', 1)[-1]))
    if not cached.exists():
        cached.write_bytes(get(url, binary=True))
    return cached, title, author, page


def peak_gain_db(src, target=-3.0):
    """Gain that brings a short clip's loudest peak to `target` dB (loudnorm is unreliable under a few seconds)."""
    out = subprocess.run(['ffmpeg', '-hide_banner', '-i', str(src), '-af', 'volumedetect', '-f', 'null', '-'],
                         capture_output=True, text=True).stderr
    m = re.search(r'max_volume: (-?[\d.]+) dB', out)
    return target - float(m.group(1)) if m else 0.0


def encode(src, dst, pick):
    dur = float(subprocess.check_output(
        ['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', str(src)]).strip())
    max_sec = pick.get('maxSec', 12 if pick['kind'] == 'oneshot' else None)
    take = min(dur, max_sec) if max_sec else dur
    norm = f"loudnorm=I={LOUD[pick['category']]}:TP=-2:LRA=9"
    if pick['kind'] == 'bed' and take > FADE * 3:
        f = FADE
        graph = (f'[0:a]atrim=0:{take},asetpts=PTS-STARTPTS,asplit[a][b];'
                 f'[a]atrim=start={f},asetpts=PTS-STARTPTS[body];[b]atrim=end={f},asetpts=PTS-STARTPTS[head];'
                 f'[body][head]acrossfade=d={f}:c1=tri:c2=tri,{norm}[out]')
        args = ['-filter_complex', graph, '-map', '[out]']
    elif pick['kind'] == 'oneshot':
        trim = 'silenceremove=start_periods=1:start_threshold=-50dB'
        args = ['-t', str(take), '-af', f'{trim},areverse,{trim},areverse,volume={peak_gain_db(src):.1f}dB,afade=t=out:st={max(take - 0.05, 0):.2f}:d=0.05']
    else:
        args = ['-t', str(take), '-af', norm]
    subprocess.check_call(['ffmpeg', '-v', 'error', '-y', '-i', str(src), *args,
                           '-ar', '44100', '-c:a', 'libvorbis', '-q:a', '3', str(dst)])


def sequence(srcs, dst_wav, gap, count):
    """Lays `count` steps (cycling through `srcs`) `gap` seconds apart into one wav, so single footsteps become a walk."""
    inputs, labels, parts = [], [], []
    for i in range(count):
        src = srcs[i % len(srcs)]
        inputs += ['-i', str(src)]
        # a small deterministic wobble in timing so the walk is not a metronome
        offset = int((i * gap + (0.03 if i % 2 else 0.0)) * 1000)
        parts.append(f'[{i}:a]aformat=channel_layouts=mono,adelay={offset}[s{i}]')
        labels.append(f'[s{i}]')
    graph = ';'.join(parts) + ';' + ''.join(labels) + f'amix=inputs={count}:normalize=0[out]'
    subprocess.check_call(['ffmpeg', '-v', 'error', '-y', *inputs, '-filter_complex', graph, '-map', '[out]', str(dst_wav)])


def main():
    picks = json.loads((HERE / 'picks.json').read_text())
    CACHE.mkdir(exist_ok=True)
    sources, sounds = [], []
    for p in picks['sounds']:
        specs = p.get('takes') or [p]
        (OUT / p['category']).mkdir(parents=True, exist_ok=True)
        rels = []
        if p.get('sequence'):
            seq = p['sequence']
            fetched = [fetch(spec) for spec in specs]
            wav = CACHE / f"seq_{p['key']}.wav"
            sequence([f[0] for f in fetched], wav, seq['gap'], seq['count'])
            rel = f"{p['category']}/{p['key']}.ogg"
            encode(wav, OUT / rel, {**p, 'maxSec': p.get('maxSec', seq['count'] * seq['gap'] + 1.0)})
            size = (OUT / rel).stat().st_size
            print(f"{rel}  {size // 1024} KB  <- {fetched[0][3]} ({fetched[0][2]}) x{seq['count']} steps")
            sounds.append({'key': p['key'], 'name': p['name'], 'category': p['category'], 'takes': [rel]})
            sources.append((rel, fetched[0][1] + f" (+{len(fetched) - 1} more, sequenced)", fetched[0][2], fetched[0][3], size))
            continue
        for i, spec in enumerate(specs):
            cached, title, author, page = fetch(spec)
            rel = f"{p['category']}/{p['key']}{'' if len(specs) == 1 else '-' + str(i + 1)}.ogg"
            encode(cached, OUT / rel, p)
            size = (OUT / rel).stat().st_size
            print(f"{rel}  {size // 1024} KB  <- {page} ({author})")
            rels.append(rel)
            sources.append((rel, title, author, page, size))
        sounds.append({'key': p['key'], 'name': p['name'], 'category': p['category'], 'takes': rels})
    catalogue = {'version': 1, 'sounds': sounds, 'boards': picks['boards'], 'scenes': picks['scenes']}
    (OUT / 'catalogue.json').write_text(json.dumps(catalogue, indent=2) + '\n')
    lines = ['# Starter sound pack: sources and licences', '',
             'Every clip is CC0 (public domain), from [Freesound](https://freesound.org), [OpenGameArt](https://opengameart.org)',
             'or [Kenney](https://kenney.nl), checked against the source\'s licence by `scripts/sound-pack/build.py`, which refuses anything that is not CC0. Clips are',
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
