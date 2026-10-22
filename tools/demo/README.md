# 演示录像怎么做的

README 里的动图和「完整通关」视频都是**机器人驱动真实引擎**跑出来的，不是外部录像软件截屏，也不是把状态摆出来拍照。
这里的东西只给开发用，`index.html` 不引用 `bot.js`，玩家不会加载到一行。

## 四步

```bash
python -m http.server 8000            # 游戏本体
python tools/demo/sink.py             # 接收端：127.0.0.1:8124，把帧和流水账写到 tools/demo/out/
```

浏览器开 <http://127.0.0.1:8000>，控制台里：

```js
const s = document.createElement('script');
s.src = '/tools/demo/bot.js';
document.head.appendChild(s);          // 加载完才有 botStart / botStep

botStart('story', { render: true, rec: true, inspect: true, tag: 'story-cut' });
botPump(400);                          // 无人值守连续跑，随时 botStopPump() 停
```

最后合成：

```bash
python tools/demo/encode.py video story-cut 主线通关 --fps 15 --scale 2
python tools/demo/encode.py gif   story-cut 主线精选 --fps 15 --range 5600-5900 --width 640
```

## 机器人是怎么「玩」的

它不直接改状态，走的全是玩家那条代码路径：`boothInput`、`dragStart / dragMove / dragEnd`、`setTray`、`stamp`。
所以判定真过了 `judge()`，结算真走了 `summaryClick`，画面真由 `render()` 画出来。

唯一作弊的地方是它知道答案：每个旅客的可接受处置本来就写在 `spec.ok` 里，机器人照抄。
例外是第 9 天的岳母 Opus——她没有标准答案，三种章各通向一种结局，演示里固定走「那我回去」（见 `DEMO.forceDec`）。

一台机器上跑多快：

| 跑法 | 每帧成本 | 结果 |
|---|---|---|
| 只跑逻辑（`render: false`） | 0.15 ms | 无尽 1000 班、11951 名旅客，0.8 秒 |
| 逐帧渲染 + 每 4 帧抓一张 | 约 7 ms | 主线 9 天约 8600 张 PNG，4 分多钟 |

时间由 `demoFrame` 自己推（`now += 1/60`），并且把 `window.loop` 换成空函数冻结了 rAF，
所以跑多久都跟真实时间无关——这是能在几秒内跑完一千个班的原因。
`botStep(n)` 一定停在「没有人在柜台前」的安全点上，跟玩家中途走开一样，随时能续。

## 三种出片方式

- **完整通关视频**：`render: true, rec: true`，每 4 帧抓一张（15 fps），合成 mp4。
- **无尽延时**：`lapse: true`，每班只抓「日卡 / 桌上一张 / 结算单」三张，1000 班 = 3000 张，
  播出来是 3 分 20 秒的流水灯。逐帧渲染 1000 班要 5.4M 帧、几十 GB，没人会看，所以不渲。
- **README 动图**：从 `*-marks.json` 里取某一名旅客的起止帧号，用 `--range` 裁出来做 GIF。
  `marks` 是机器人在每名旅客进场/离场时记下的截图序号。

## 产物

`tools/demo/out/`（已 gitignore）：

| 文件 | 内容 |
|---|---|
| `frames/<tag>/%06d.png` | 抓帧，640×360 |
| `<mode>-<tag>-shifts.csv` | 一天（一班）一行：人数、判对、工资、罚款、结余 |
| `<mode>-<tag>-people.csv` | 一名旅客一行：想要什么章、盖了什么章、对不对 |
| `<mode>-<tag>-marks.json` | 每名旅客在录像里的起止帧号 |
| `<mode>-<tag>-notes.txt` | 机器人自己的异常。**跑完必看，正常应该是空的** |
| `playthrough-stats.xlsx` | 上面几份流水账合成的表：概览 / 主线逐日 / 主线逐人 / 无尽逐日 / 无尽逐人 |

要出这张表：

```bash
python tools/demo/report.py           # 只用标准库写 xlsx，不额外装 openpyxl
```

主线 9 天 65 人全对、无尽 1000 班 11951 人全对，两份 notes 都是空的——
这既是录像的质检，也是「无尽排班真的能无限玩」的证据。
