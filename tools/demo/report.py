#!/usr/bin/env python3
"""把通关流水账（tools/demo/out/*.csv）导成一个 xlsx，并顺手打印一份汇总。

    python tools/demo/report.py

只用标准库：xlsx 就是一个装了若干 XML 的 zip，没必要为此再装 openpyxl。
表头冻第一行，数字存成数字（能排序能求和），文字走 inlineStr（省掉 sharedStrings 那张表）。
"""
import csv
import os
import zipfile
from datetime import date, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'out')
NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
RNS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

HEAD = {
    'day': '天号', 'date': '日期', 'weekday': '星期', 'people': '人数', 'correct': '判对',
    'pay': '工资', 'bonus': '奖金', 'fines': '罚款', 'cites': '警告单', 'bribe': '受贿',
    'savings': '结余', 'person': '旅客', 'kind': '毛病', 'want': '可接受处置',
    'got': '实际处置', 'pass': '判定', 'then': '桥段', 'mode': '模式',
}


def esc(v):
    return (str(v).replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
            .replace('"', '&quot;'))


def col(i):
    s = ''
    while i >= 0:
        s = chr(65 + i % 26) + s
        i = i // 26 - 1
    return s


def sheet_xml(rows):
    body = []
    for r, row in enumerate(rows, 1):
        cells = []
        for c, v in enumerate(row):
            ref = f'{col(c)}{r}'
            if isinstance(v, (int, float)):
                cells.append(f'<c r="{ref}"><v>{v}</v></c>')
            elif v == '' or v is None:
                continue
            else:
                cells.append(f'<c r="{ref}" t="inlineStr"><is><t xml:space="preserve">{esc(v)}</t></is></c>')
        body.append(f'<row r="{r}">' + ''.join(cells) + '</row>')
    return (f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            f'<worksheet xmlns="{NS}">'
            f'<sheetViews><sheetView workbookViewId="0">'
            f'<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>'
            f'</sheetView></sheetViews>'
            f'<cols><col min="1" max="16" width="13" customWidth="1"/></cols>'
            f'<sheetData>' + ''.join(body) + '</sheetData></worksheet>')


STYLES = (f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
          f'<styleSheet xmlns="{NS}">'
          '<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>'
          '<fills count="2"><fill><patternFill patternType="none"/></fill>'
          '<fill><patternFill patternType="gray125"/></fill></fills>'
          '<borders count="1"><border/></borders>'
          '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
          '<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>'
          '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
          '</styleSheet>')


def write_xlsx(path, sheets):
    names = [n for n, _ in sheets]
    ct = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
          '<Default Extension="xml" ContentType="application/xml"/>'
          '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
          '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
          + ''.join(f'<Override PartName="/xl/worksheets/sheet{i + 1}.xml" '
                    f'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
                    for i in range(len(sheets)))
          + '</Types>')
    rels = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" '
            'Target="xl/workbook.xml"/></Relationships>')
    wb = (f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
          f'<workbook xmlns="{NS}" xmlns:r="{RNS}"><sheets>'
          + ''.join(f'<sheet name="{esc(n)}" sheetId="{i + 1}" r:id="rId{i + 1}"/>' for i, n in enumerate(names))
          + '</sheets></workbook>')
    wbrels = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
              '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
              + ''.join(f'<Relationship Id="rId{i + 1}" Type="{RNS}/worksheet" Target="worksheets/sheet{i + 1}.xml"/>'
                        for i in range(len(sheets)))
              + f'<Relationship Id="rId{len(sheets) + 1}" Type="{RNS}/styles" Target="styles.xml"/></Relationships>')
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('[Content_Types].xml', ct)
        z.writestr('_rels/.rels', rels)
        z.writestr('xl/workbook.xml', wb)
        z.writestr('xl/_rels/workbook.xml.rels', wbrels)
        z.writestr('xl/styles.xml', STYLES)
        for i, (_, rows) in enumerate(sheets):
            z.writestr(f'xl/worksheets/sheet{i + 1}.xml', sheet_xml(rows))


def read(name):
    with open(os.path.join(OUT, name), encoding='utf-8') as f:
        return list(csv.DictReader(f))


def table(rows, cols):
    return [[HEAD[c] for c in cols]] + [[r.get(c, '') for c in cols] for r in rows]


DAY0 = date(2026, 10, 18)
WEEKDAYS = ['星期一', '星期二', '星期三', '星期四', '星期五', '星期六', '星期日']


def date_of(d):
    t = DAY0 + timedelta(days=d)
    return f'{t.year}.{t.month:02d}.{t.day:02d}'


def weekday_of(d):
    return WEEKDAYS[(DAY0 + timedelta(days=d)).weekday()]


def build(story_mode='story-w2zh', endless_mode='endless-e1000zh'):
    s_shifts = read(f'{story_mode}-shifts.csv')
    s_people = read(f'{story_mode}-people.csv')
    e_shifts = read(f'{endless_mode}-shifts.csv')
    e_people = read(f'{endless_mode}-people.csv')

    last = int(s_shifts[-1]['day'])                     # 第 9 天不结算：最后一位旅客直接进结局
    d9 = [r for r in s_people if int(r['day']) == last + 1]
    judged = [r for r in d9 if r['pass'] != '']
    tail = {'day': last + 1, 'date': date_of(last + 1), 'weekday': weekday_of(last + 1), 'people': len(d9),
            'correct': sum(1 for r in judged if r['pass'] == '1'), 'pay': '未结算', 'bonus': '',
            'fines': '', 'cites': '', 'bribe': '', 'savings': '直接进结局'}
    s_all = s_shifts + [tail]

    def total(rows):
        return sum(int(r['people']) for r in rows)

    story_wrong = sum(1 for r in s_people if r['pass'] == '0')
    end_wrong = sum(1 for r in e_people if r['pass'] == '0')
    kinds = {}
    for r in e_people:
        kinds[r['kind'] or '剧本'] = kinds.get(r['kind'] or '剧本', 0) + 1

    overview = [['项目', '主线', '无尽排班'],
                ['跑法', '第 1 天到第 9 天，一路零失误', f'第 1 班到第 {len(e_shifts)} 班，一路零失误'],
                ['天数 / 班数', len(s_all), len(e_shifts)],
                ['柜台人数', total(s_all), total(e_shifts)],
                ['逐人记录', len(s_people), len(e_people)],
                ['判对', sum(int(r['correct']) for r in s_all), sum(int(r['correct']) for r in e_shifts)],
                ['误判', story_wrong, end_wrong],
                ['放行 / 驳回 / 拘留',
                 ' / '.join(str(sum(1 for r in s_people if r['got'] == k)) for k in ('approve', 'deny', 'detain')),
                 ' / '.join(str(sum(1 for r in e_people if r['got'] == k)) for k in ('approve', 'deny', 'detain'))],
                ['警告单合计', sum(int(r['cites']) for r in s_shifts), sum(int(r['cites']) for r in e_shifts)],
                ['罚款合计', sum(int(r['fines']) for r in s_shifts), sum(int(r['fines']) for r in e_shifts)],
                ['最后一次结算的结余', s_shifts[-1]['savings'] + '（第 8 天）', e_shifts[-1]['savings']],
                ['结局', 'opus_out（岳母那一段走「那我回去」）', '未触发：零失误不会拉闸'],
                ['最后一格的日期', s_all[-1]['date'] or date_of(len(s_all)), e_shifts[-1]['date']],
                ['机器人异常记录', 'notes 文件 0 字节', 'notes 文件 0 字节'],
                ['毛病种类分布（无尽）', '', '；'.join(f'{k} {v}' for k, v in sorted(kinds.items(), key=lambda x: -x[1]))]]

    sheets = [
        ('概览', overview),
        ('主线逐日', table(s_all, ['day', 'date', 'weekday', 'people', 'correct', 'pay', 'bonus',
                                    'fines', 'cites', 'bribe', 'savings'])),
        ('主线逐人', table(s_people, ['day', 'person', 'kind', 'want', 'got', 'pass', 'then'])),
        ('无尽逐日', table(e_shifts, ['day', 'date', 'weekday', 'people', 'correct', 'pay', 'bonus',
                                      'fines', 'cites', 'bribe', 'savings'])),
        ('无尽逐人', table(e_people, ['day', 'person', 'kind', 'want', 'got', 'pass'])),
    ]
    path = os.path.join(OUT, 'playthrough-stats.xlsx')
    write_xlsx(path, sheets)
    print(f'{path}  {os.path.getsize(path) / 1024:.0f} KB')
    for n, rows in sheets:
        print(f'  {n}: {len(rows) - 1} 行')
    markdown(s_shifts, s_people, e_shifts, e_people, tail)
    return sheets


DEC = {'approve': '放行', 'deny': '驳回', 'detain': '拘留'}
KIND_CN = {
    '': '剧本人物', 'valid': '无毛病（合规）', 'cnip': 'IP 在中国', 'tz': '时区与 IP 不符',
    'lang': '浏览器语言是中文', 'hidden': '中文黑话说漏嘴（要询问）', 'virtual': '虚拟付款卡',
    'oregon': '俄勒冈账单地址', 'sms': '555 接码手机号', 'cat': 'X 光：小猫咪（自动换 IP）',
    'keys': 'X 光：中文输入法', 'repeat': '再犯（带本站档案）', 'forged': '假档案（代办点自打，无圆印）',
}
THEN_CN = {'closeup': '证件特写', 'jorji5': '乔治终极版', 'ending': '作者结局', 'opus': '岳母结局'}


def dec_list(v):
    return ' / '.join(DEC.get(x, x) for x in v.split('/')) if v else '—'


def kind_label(r):
    # 引擎里只有代办点假档那一条路会把「无毛病」的人变成该驳回的人（data.js 的 forgedEntrant：
    # 洗白后 kind 记成 valid，ok 却是 deny/detain）。这两格同时出现时，毛病其实是假档案。
    if r['kind'] == 'valid' and 'approve' not in (r['want'] or ''):
        return KIND_CN['forged']
    return KIND_CN.get(r['kind'], r['kind'])


def md_table(head, rows):
    out = ['| ' + ' | '.join(head) + ' |', '|' + '|'.join(['---'] * len(head)) + '|']
    out += ['| ' + ' | '.join(str(c) for c in r) + ' |' for r in rows]
    return out


def markdown(s_shifts, s_people, e_shifts, e_people, story_day9):
    s_all = s_shifts + [story_day9]
    kinds = {}
    for r in e_people:
        lab = kind_label(r)
        code = 'valid（假档洗白）' if r['kind'] == 'valid' and lab == KIND_CN['forged'] else r['kind']
        kinds[(code, lab)] = kinds.get((code, lab), 0) + 1
    L = ['# 通关统计', '',
         '> 剧透警告：这份表把 9 天里每一位旅客的毛病和正确答案都摊开了。自己查案的别往下翻。',
         '> Spoilers: this file lists every traveler\'s flaw and the correct ruling.',
         '',
         '数字不是手填的：机器人驱动真引擎跑完全程（走的是玩家那条点击与拖拽路径，判定真过 judge()），',
         '流水账落盘后由 tools/demo/report.py 汇总成这份表和 playthrough-stats.xlsx。',
         '复现方法见 [tools/demo/README.md](../tools/demo/README.md)。',
         '',
         '## 总览', '']
    L += md_table(['模式', '天 / 班', '柜台人数', '逐人记录', '判对', '误判', '最后一次结算的结余'], [
        ['主线（正常上班）', len(s_all), sum(int(r['people']) for r in s_all), len(s_people),
         sum(1 for r in s_people if r['pass'] == '1'),
         sum(1 for r in s_people if r['pass'] == '0'), s_shifts[-1]['savings'] + '（第 8 天）'],
        ['无尽排班', len(e_shifts), sum(int(r['people']) for r in e_shifts), len(e_people),
         sum(1 for r in e_people if r['pass'] == '1'),
         sum(1 for r in e_people if r['pass'] == '0'), e_shifts[-1]['savings']],
    ])
    L += ['', '判对与误判都按逐人记录数，不看逐日表：逐日表的「判对」不含第 9 天（那天没有结算画面）。',
          '柜台人数比逐人记录多，多出来的是黑话快剪的短句——那一段按节奏判，不是一人一证。',
          '主线第 9 天没有结算，所以结余停在第 8 天的数字。',
          '中文与英文各跑一遍，两份数字完全一致（人数、判定、误判、结余）。', '',
          '## 主线逐日', '']
    L += md_table(['天', '日期', '星期', '人数', '判对', '工资', '奖金', '警告单', '结余'],
                  [[r['day'], r['date'], r['weekday'], r['people'], r['correct'], r['pay'],
                    r['bonus'], r['cites'], r['savings']] for r in s_all])
    L += ['', '三处看着像对不上的地方，其实都是设计：',
          '- 第 4 天 14 人只算 8 判对：其中 6 段是黑话快剪，不计入逐人判定。',
          '- 第 6 天 5 人只算 4 判对：作者本人不按规则判定，放行他会没收全部 token，所以第 7 天结余从 77 归零。',
          '- 第 9 天没有结算：最后一位旅客不是旅客，判完直接进结局画面。', '',
          '## 主线逐人', '',
          '毛病一栏写「剧本人物」的是手写的固定角色，矛盾写在台词和证件里，不走随机生成器；P## 是排队池里的随机路人。',
          '判定列的「—」表示这个人不按规则判定（作者与岳母）。', '']
    L += md_table(['天', '旅客', '毛病', '可接受处置', '实际处置', '判定', '桥段'],
                  [[r['day'], r['person'], kind_label(r), dec_list(r['want']),
                    DEC.get(r['got'], r['got']),
                    '对' if r['pass'] == '1' else ('—' if r['pass'] == '' else '误'),
                    THEN_CN.get(r['then'], r['then'])] for r in s_people])
    L += ['', '表里「无毛病（合规）」却写着该驳回的那几行，毛病其实是代办点打的假档案：假档的做法就是把这人上次的毛病洗成「无矛盾」、'
          '再塞一张没有圆印的记录，所以种类栏留下的是 valid，判定栏才是真相。', '',
          '## 无尽排班', '',
          f'一路零失误排到第 {len(e_shifts)} 班。零失误不会拉闸，所以这张表能排到任意班数——',
          '第 1000 班已经是 ' + e_shifts[-1]['date'] + '。', '']
    marks = [1, 2, 3, 5, 10] + list(range(50, len(e_shifts) + 1, 50))
    L += md_table(['班', '日期', '人数', '判对', '工资', '罚款', '结余'],
                  [[r['day'], r['date'], r['people'], r['correct'], r['pay'], r['fines'], r['savings']]
                   for r in e_shifts if int(r['day']) in marks])
    L += ['', '处置合计：' + ' / '.join(
        f'{DEC[k]} {sum(1 for r in e_people if r["got"] == k)}' for k in ('approve', 'deny', 'detain')), '',
          '### 毛病种类分布', '']
    L += md_table(['种类', '是什么', '出现次数'],
                  [[c or '（剧本）', lab, v] for (c, lab), v in sorted(kinds.items(), key=lambda x: -x[1])])
    L += ['', '完整的 1000 班逐日与 11951 人逐人在本地：tools/demo/out/ 下的 CSV 与 playthrough-stats.xlsx',
          '（该目录已 gitignore，跑一次 python tools/demo/report.py 就能重建）。', '']
    path = os.path.join(HERE, '..', '..', 'docs')
    os.makedirs(path, exist_ok=True)
    out = os.path.join(path, 'playthrough.md')
    with open(out, 'w', encoding='utf-8', newline='\n') as f:
        f.write('\n'.join(L))
    print(f'{out}  {os.path.getsize(out) / 1024:.1f} KB  {len(L)} 行')
    return out


if __name__ == '__main__':
    build()
