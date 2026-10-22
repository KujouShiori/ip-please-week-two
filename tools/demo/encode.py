#!/usr/bin/env python3
"""把 tools/demo/out/frames/<tag>/ 里的抓帧合成成视频或动图。

    python tools/demo/encode.py video story-zh 主线通关 --fps 15 --scale 2
    python tools/demo/encode.py gif   story-zh 主线精选 --fps 10 --range 1200-1500 --width 640

video 出 mp4（H.264 + yuv420p，浏览器和播放器都能放）；gif 走出调色板两遍，比默认调色板清楚。
帧本身是 640×360 的像素画，放大一律用邻域，不糊。
"""
import argparse
import os
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
FRAMES = os.path.join(HERE, 'out', 'frames')
OUT = os.path.join(HERE, 'out')


def run(cmd):
    print('+ ' + ' '.join(str(c) for c in cmd), flush=True)
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode:
        print(r.stdout[-3000:])
        print(r.stderr[-3000:])
        sys.exit(1)
    return r


def count(tag, rng):
    d = os.path.join(FRAMES, tag)
    files = sorted(f for f in os.listdir(d) if f.endswith('.png'))
    if rng:
        a, b = rng
        files = [f for f in files if a <= int(f.split('.')[0]) < b]
    if files and rng:
        # ffmpeg 的 %06d 会从起始号一路读到断号为止，所以取区间还得自己限帧数
        lo = int(files[0].split('.')[0])
        if len(files) != int(rng[1]) - int(rng[0]) or lo != int(rng[0]):
            sys.exit(f'区间 {rng} 内有缺号（{lo} 起，{len(files)} 张），先确认抓帧没掉')
    return d, files


def video(tag, name, fps, scale, rng):
    d, files = count(tag, rng)
    if not files:
        sys.exit(f'{tag}: 没有帧')
    out = os.path.join(OUT, f'{name}.mp4')
    cmd = ['ffmpeg', '-y', '-framerate', str(fps), '-start_number', files[0].split('.')[0],
           '-i', os.path.join(d, '%06d.png')]
    if scale != 1:
        cmd += ['-vf', f'scale=iw*{scale}:ih*{scale}:flags=neighbor']
    cmd += ['-frames:v', str(len(files)), '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', out]
    run(cmd)
    print(f'{out}  {len(files)} 帧  {len(files) / fps:.0f} 秒  {os.path.getsize(out) / 1e6:.1f} MB')


def gif_out(src, name, fps, width, n):
    out = os.path.join(OUT, f'{name}.gif')
    pal = os.path.join(OUT, f'{name}.palette.png')
    run(['ffmpeg', '-y'] + src + ['-vf', f'scale={width}:-1:flags=lanczos,palettegen=stats_mode=diff', pal])
    # 第二遍写成单条 -lavfi：paletteuse 自己拿第二个输入当调色板，用 [v:p] 那种标签会报「调色板必须 256 像素」
    run(['ffmpeg', '-y'] + src + ['-i', pal, '-lavfi',
         f'scale={width}:-1:flags=lanczos,paletteuse=dither=bayer:bayer_scale=4',
         '-frames:v', str(n), out])
    os.remove(pal)
    print(f'{out}  {n} 帧  {n / fps:.0f} 秒  {os.path.getsize(out) / 1e6:.2f} MB')


def gif(tag, name, fps, width, rng):
    d, files = count(tag, rng)
    if not files:
        sys.exit(f'{tag}: 没有帧')
    gif_out(['-framerate', str(fps), '-start_number', files[0].split('.')[0], '-i', os.path.join(d, '%06d.png')],
            name, fps, width, len(files))


def rng_arg(v):
    if not v:
        return None
    a, b = v.split('-')
    return (int(a), int(b))


def collect(parts, name):
    """把若干 tag:起-止 片段按顺序拷进一个目录，编号连续，供 ffmpeg 一次读完。"""
    d = os.path.join(OUT, 'gifsrc', name)
    os.makedirs(d, exist_ok=True)
    for f in os.listdir(d):
        os.remove(os.path.join(d, f))
    n = 0
    for p in parts:
        tag, rng = p.split(':')
        a, b = rng_arg(rng)
        for i in range(a, b):
            src = os.path.join(FRAMES, tag, f'{i:06d}.png')
            if not os.path.exists(src):
                sys.exit(f'{tag} 缺帧 {i:06d}.png')
            shutil.copyfile(src, os.path.join(d, f'{n:06d}.png'))
            n += 1
    print(f'{name}: {len(parts)} 段 {n} 帧', flush=True)
    return d, n


def gif_parts(parts, name, fps, width):
    d, n = collect(parts, name)
    gif_out(['-framerate', str(fps), '-start_number', '0', '-i', os.path.join(d, '%06d.png')], name, fps, width, n)


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('kind', choices=['video', 'gif'])
    ap.add_argument('tag', nargs='?', default='')
    ap.add_argument('name')
    ap.add_argument('--fps', type=int, default=15)
    ap.add_argument('--scale', type=int, default=2)
    ap.add_argument('--width', type=int, default=640)
    ap.add_argument('--range', help='帧号区间，如 1200-1500')
    ap.add_argument('--parts', help='gif 专用：story-cut:5818-5917,story-cut:6609-6714')
    a = ap.parse_args()
    if a.kind == 'video':
        video(a.tag, a.name, a.fps, a.scale, rng_arg(a.range))
    elif a.parts:
        gif_parts(a.parts.split(','), a.name, a.fps, a.width)
    else:
        gif(a.tag, a.name, a.fps, a.width, rng_arg(a.range))
