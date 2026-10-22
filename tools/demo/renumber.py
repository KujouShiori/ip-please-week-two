#!/usr/bin/env python3
"""补上抓帧里掉号的那几张，把帧号重新排成连续，并同步改写 marks 里的起止号。

    python tools/demo/renumber.py story-en

掉帧是 fetch 偶发失败（DEMO.dropped），一次跑下来 0～3 张。
不补的话 ffmpeg 的 %06d 读到断号就停，剪出来的动图也会少一帧或串段。
"""
import glob
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
FRAMES = os.path.join(HERE, 'out', 'frames')
OUT = os.path.join(HERE, 'out')


def renumber(tag):
    d = os.path.join(FRAMES, tag)
    if not os.path.isdir(d):
        sys.exit(f'没有 {d}')
    old = sorted(int(f.split('.')[0]) for f in os.listdir(d) if f.endswith('.png'))
    mp = {o: i for i, o in enumerate(old)}
    for o in old:                                   # 先全改名，避免新旧号互相覆盖
        os.rename(os.path.join(d, f'{o:06d}.png'), os.path.join(d, f'{o:06d}.png.tmp'))
    for o in old:
        os.rename(os.path.join(d, f'{o:06d}.png.tmp'), os.path.join(d, f'{mp[o]:06d}.png'))

    holes = (old[-1] - old[0] + 1) - len(old)
    for p in glob.glob(os.path.join(OUT, f'*-{tag}-marks.json')) + glob.glob(os.path.join(OUT, f'{tag}-marks.json')):
        marks = json.load(open(p, encoding='utf-8'))
        for m in marks:
            m['from'] = mp.get(m['from'], m['from'])
            m['to'] = mp.get(m['to'], m['to'])
        json.dump(marks, open(p, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
        print(f'{os.path.basename(p)}: {len(marks)} 段起止号已改写')
    print(f'{tag}: {len(old)} 帧连续，补掉 {holes} 个断号')


if __name__ == '__main__':
    renumber(sys.argv[1] if len(sys.argv) > 1 else 'story-cut')
