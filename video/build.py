"""Builds the Codegeist demo video from the recorded takes and video/script.json.

Run from the repository root:  python video/build.py
Needs: ffmpeg/ffprobe on PATH, edge-tts, the recordings in video/raw/ and the cards from `node video/cards.mjs`.
Outputs: video/out/config-doctor-codegeist2026.mp4, ...-subtitled.mp4, .srt, and QC stills in video/qc/.
"""
import asyncio
import json
import pathlib
import subprocess

import edge_tts

ROOT = pathlib.Path(__file__).resolve().parent
RAW = ROOT / 'raw'
OUT = ROOT / 'out'
QC = ROOT / 'qc'
FPS = 30
XFADE = 0.3
LEAD = 0.4   # narration starts this long after the scene starts
TAIL = 0.9   # footage kept after the narration ends
MAX_ELASTIC = 2.5
NAME = 'config-doctor-codegeist2026'


def run(args):
    subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', *args], check=True)


def duration(path):
    out = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', str(path)],
                         capture_output=True, text=True, check=True).stdout
    return float(out.strip())


async def voice(scene, cfg):
    mp3 = RAW / 'voice' / f"{scene['id']:02d}.mp3"
    meta = mp3.with_suffix('.json')
    if mp3.exists() and meta.exists() and json.loads(meta.read_text('utf-8')).get('text') == scene['narration']:
        return json.loads(meta.read_text('utf-8'))
    mp3.parent.mkdir(parents=True, exist_ok=True)
    comm = edge_tts.Communicate(scene['narration'], cfg['voice'], rate=cfg['rate'], boundary='SentenceBoundary')
    sentences = []
    with open(mp3, 'wb') as f:
        async for chunk in comm.stream():
            if chunk['type'] == 'audio':
                f.write(chunk['data'])
            elif chunk['type'] == 'SentenceBoundary':
                sentences.append({'start': chunk['offset'] / 1e7, 'end': (chunk['offset'] + chunk['duration']) / 1e7,
                                  'text': chunk['text']})
    data = {'text': scene['narration'], 'sentences': sentences}
    meta.write_text(json.dumps(data, indent=1), 'utf-8')
    return data


def layout_filter(name, layouts, bg):
    lay = layouts[name]
    x, y, w, h = lay['crop']
    crop = f'crop={w}:{h}:{x}:{y}'
    if name == 'zoom':
        return None, f'{crop},scale=1920:1080:flags=lanczos'
    if name == 'panel':
        return bg, f"[0:v]{crop},scale=-2:{lay['height']}:flags=lanczos[p];[1:v][p]overlay={lay['x']}:{lay['y']}:shortest=1"
    return RAW / 'cards' / 'bg-plain.png', f'[0:v]{crop}[p];[1:v][p]overlay=(W-w)/2:(H-h)/2:shortest=1'


def render_segment(seg, idx, scene, cfg, speed, dest):
    if 'card' in seg:
        run(['-loop', '1', '-t', str(seg['dur']), '-i', str(RAW / 'cards' / f"{seg['card']}.png"),
             '-vf', f'fps={FPS},format=yuv420p', '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', str(dest)])
        return seg['dur']
    src = ROOT / cfg['sources'][seg['src']]
    bg = RAW / 'cards' / f"bg-{scene['id']:02d}.png"
    bg_in, filt = layout_filter(seg['layout'], cfg['layouts'], bg)
    length = (seg['out'] - seg['in']) / speed
    tail = f',setpts=(PTS-STARTPTS)/{speed},fps={FPS},format=yuv420p'
    args = ['-ss', str(seg['in']), '-t', str(seg['out'] - seg['in']), '-i', str(src)]
    if bg_in is None:
        args += ['-vf', filt + tail]
    else:
        args += ['-loop', '1', '-i', str(bg_in), '-filter_complex', filt + tail]
    run(args + ['-an', '-t', f'{length:.3f}', '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', str(dest)])
    return length


def build_scene(scene, cfg, narration_len):
    target = LEAD + narration_len + TAIL
    segs = scene['segments']
    fixed = sum(s['dur'] for s in segs if 'card' in s) + \
        sum((s['out'] - s['in']) / s.get('speed', 1) for s in segs if 'card' not in s and not s.get('elastic'))
    elastic_src = sum(s['out'] - s['in'] for s in segs if s.get('elastic'))
    room = target - fixed
    k = 1.0 if not elastic_src else min(MAX_ELASTIC, max(1.0, elastic_src / room if room > 0 else MAX_ELASTIC))
    parts = []
    for i, seg in enumerate(segs):
        dest = RAW / 'seg' / f"{scene['id']:02d}_{i}.mp4"
        dest.parent.mkdir(parents=True, exist_ok=True)
        render_segment(seg, i, scene, cfg, k if seg.get('elastic') else seg.get('speed', 1), dest)
        parts.append(dest)
    lst = RAW / 'seg' / f"{scene['id']:02d}.txt"
    lst.write_text(''.join(f"file '{p.as_posix()}'\n" for p in parts), 'utf-8')
    joined = RAW / 'seg' / f"{scene['id']:02d}_joined.mp4"
    run(['-f', 'concat', '-safe', '0', '-i', str(lst), '-c', 'copy', str(joined)])
    have = duration(joined)
    scene_file = RAW / 'scene' / f"{scene['id']:02d}.mp4"
    scene_file.parent.mkdir(parents=True, exist_ok=True)
    pad = max(0.0, target - have)
    run(['-i', str(joined), '-vf', f'tpad=stop_mode=clone:stop_duration={pad:.3f},fps={FPS},format=yuv420p',
         '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', str(scene_file)])
    return {'file': scene_file, 'len': duration(scene_file), 'elastic_speed': round(k, 2), 'footage': round(have, 2),
            'target': round(target, 2), 'held': round(pad, 2)}


def srt_time(t):
    ms = int(round(t * 1000))
    return f'{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d},{ms % 1000:03d}'


def wrap(text, width=58):
    words, lines, cur = text.split(), [], ''
    for w in words:
        if len(cur) + len(w) + 1 > width and cur:
            lines.append(cur)
            cur = w
        else:
            cur = f'{cur} {w}'.strip()
    lines.append(cur)
    return '\n'.join(lines)


def main():
    cfg = json.loads((ROOT / 'script.json').read_text('utf-8'))
    OUT.mkdir(exist_ok=True)
    QC.mkdir(exist_ok=True)
    voices = [asyncio.run(voice(s, cfg)) for s in cfg['scenes']]
    report, starts, t = [], [], 0.0
    for scene, v in zip(cfg['scenes'], voices):
        mp3 = RAW / 'voice' / f"{scene['id']:02d}.mp3"
        n = duration(mp3)
        info = build_scene(scene, cfg, n)
        info.update(id=scene['id'], narration=round(n, 2))
        starts.append(t)
        t += info['len'] - XFADE
        report.append(info)
    total = t + XFADE

    # Video: chain xfades.
    inputs, chain, prev, offset = [], [], '0:v', 0.0
    for i, r in enumerate(report):
        inputs += ['-i', str(r['file'])]
    for i in range(1, len(report)):
        offset += report[i - 1]['len'] - XFADE
        label = f'v{i}'
        chain.append(f'[{prev}][{i}:v]xfade=transition=fade:duration={XFADE}:offset={offset:.3f}[{label}]')
        prev = label
    # Audio: each narration delayed to its scene start + LEAD, mixed, normalised to -16 LUFS.
    a_inputs, a_chain = [], []
    for i, scene in enumerate(cfg['scenes']):
        a_inputs += ['-i', str(RAW / 'voice' / f"{scene['id']:02d}.mp3")]
        d = int((starts[i] + LEAD) * 1000)
        a_chain.append(f'[{len(report) + i}:a]adelay={d}|{d},aresample=48000[a{i}]')
    mix = ''.join(f'[a{i}]' for i in range(len(report)))
    a_chain.append(f'{mix}amix=inputs={len(report)}:normalize=0,apad,atrim=0:{total:.3f},'
                   f'loudnorm=I=-16:TP=-1.5:LRA=11[aout]')
    final = OUT / f'{NAME}.mp4'
    run(inputs + a_inputs + ['-filter_complex', ';'.join(chain + a_chain), '-map', f'[{prev}]', '-map', '[aout]',
                             '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', str(FPS),
                             '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart', str(final)])

    # Subtitles from edge-tts sentence boundaries.
    cues = []
    for i, v in enumerate(voices):
        for s in v['sentences']:
            cues.append((starts[i] + LEAD + s['start'], starts[i] + LEAD + s['end'], s['text']))
    srt = OUT / f'{NAME}.srt'
    srt.write_text(''.join(f'{n}\n{srt_time(a)} --> {srt_time(b)}\n{wrap(txt)}\n\n'
                           for n, (a, b, txt) in enumerate(cues, 1)), 'utf-8')
    style = "FontName=Arial,FontSize=11,PrimaryColour=&H00FFFFFF,OutlineColour=&H90000000,BorderStyle=3,Outline=1,Shadow=0,MarginV=14"
    # The subtitles filter takes a bare file name, so this step runs inside video/out.
    subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', final.name, '-vf',
                    f"subtitles={srt.name}:force_style='{style}'", '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
                    '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-movflags', '+faststart', f'{NAME}-subtitled.mp4'],
                   cwd=OUT, check=True)

    # QC stills: middle of every scene.
    for i, r in enumerate(report):
        mid = starts[i] + r['len'] / 2
        run(['-ss', f'{mid:.2f}', '-i', str(final), '-frames:v', '1', str(QC / f"scene{r['id']:02d}-mid.png")])
    (OUT / 'build-report.json').write_text(json.dumps({'total': round(total, 2), 'scenes': [
        {k: (str(v) if isinstance(v, pathlib.Path) else v) for k, v in r.items()} | {'start': round(starts[i], 2)}
        for i, r in enumerate(report)]}, indent=1), 'utf-8')
    print(f'total {total:.1f}s')
    for i, r in enumerate(report):
        print(f"scene {r['id']:2d} start {starts[i]:6.1f} len {r['len']:5.1f} narr {r['narration']:5.1f} "
              f"footage {r['footage']:5.1f} held {r['held']:4.1f} elastic x{r['elastic_speed']}")


if __name__ == '__main__':
    main()
