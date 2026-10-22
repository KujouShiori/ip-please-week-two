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


def date_of(d):
    t = DAY0 + timedelta(days=d)
    return f'{t.year}.{t.month:02d}.{t.day:02d}'


def build(story_mode='story-w2zh', endless_mode='endless-e1000zh'):
    s_shifts = read(f'{story_mode}-shifts.csv')
    s_people = read(f'{story_mode}-people.csv')
    e_shifts = read(f'{endless_mode}-shifts.csv')
    e_people = read(f'{endless_mode}-people.csv')

    last = int(s_shifts[-1]['day'])                     # 第 9 天不结算：最后一位旅客直接进结局
    d9 = [r for r in s_people if int(r['day']) == last + 1]
    judged = [r for r in d9 if r['pass'] != '']
    tail = {'day': last + 1, 'date': date_of(last + 1), 'weekday': '', 'people': len(d9),
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
                ['旅客数', total(s_all), total(e_shifts)],
                ['判对', sum(int(r['correct']) for r in s_all), sum(int(r['correct']) for r in e_shifts)],
                ['误判', story_wrong, end_wrong],
                ['放行 / 驳回 / 拘留',
                 ' / '.join(str(sum(1 for r in s_people if r['got'] == k)) for k in ('approve', 'deny', 'detain')),
                 ' / '.join(str(sum(1 for r in e_people if r['got'] == k)) for k in ('approve', 'deny', 'detain'))],
                ['警告单合计', sum(int(r['cites']) for r in s_shifts), sum(int(r['cites']) for r in e_shifts)],
                ['罚款合计', sum(int(r['fines']) for r in s_shifts), sum(int(r['fines']) for r in e_shifts)],
                ['结束时的结余', s_all[-1]['savings'], e_shifts[-1]['savings']],
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
    return sheets


if __name__ == '__main__':
    build()
