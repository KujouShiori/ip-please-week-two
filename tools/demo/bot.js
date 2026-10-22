'use strict';
// 演示机器人：驱动真实引擎把主线和无尽排班跑通，用来出录像、动图和流水账。
// 只有 tools/demo/ 引它，index.html 不引用，所以玩家不会加载到这些代码。
//
// 用法（浏览器控制台，或 tools/demo/record.py 通过 CDP 注入）：
//   botStart('story', { render: true, rec: true })
//   botStep(3000)        // 推进 3000 帧，停在没人排队的安全点，随时再调
//   botDump()            // 流水账 POST 给本地接收端
//
// 它走的是玩家那条路：boothInput / dragStart / dragMove / dragEnd / setTray / stamp，
// 不直接改状态，所以跑出来的每帧都是真画面，判定也真过 judge()。
// 唯一「作弊」的是它知道答案：正确答案写在 spec.ok 里，机器人照抄。

const DEMO = {
  dt: 1 / 60,
  frames: 0,
  draw: false,          // 逐帧渲染很慢：只出流水账时关掉，要录画面时打开
  rec: false,           // 打开后每 grabEvery 帧推一张 PNG 给本地接收端
  grabEvery: 4,         // 60 帧取 15 帧 = 15 fps
  lapse: false,         // 延时摄影：不逐帧抓，每班抓「日卡 / 桌上一张 / 结算单」三张
  lapseBooth: 0,
  sink: 'http://127.0.0.1:8124',
  tag: 'run',
  sent: 0,
  dropped: 0,
  ledger: [],           // 一名旅客一行
  marks: [],            // 一名旅客在录像里的起止帧号，剪动图靠它定位
  shifts: [],           // 一天（一班）一行
  notes: [],            // 机器人自己遇到的异常，跑完必看
  forceDec: { OPUS: 'deny' },   // 没有标准答案的那位，演示里固定走「那我回去」
  lang: 'zh',
  mode: 'story',
  target: null,         // 无尽模式跑到第几个班
  stopAt: Infinity,     // 本次 botStep 的帧预算
  finished: false,
  showInspect: false,
};

// ———————————————————— 推进 ————————————————————

function demoFrame(draw) {
  now += DEMO.dt;
  update();
  if (draw) { render(); if (DEMO.rec && !DEMO.lapse && DEMO.frames % DEMO.grabEvery === 0) demoGrab(); }
  DEMO.frames++;
}

function demoRun(sec, draw) {
  const on = draw === undefined ? DEMO.draw : draw;
  const n = Math.max(1, Math.round(sec / DEMO.dt));
  for (let i = 0; i < n; i++) demoFrame(on);
}

// 每帧先查条件；超时记一笔，别让机器人悄悄卡死
function demoWait(cond, sec = 25, why = '') {
  const n = Math.max(1, Math.round(sec / DEMO.dt));
  for (let i = 0; i < n; i++) {
    if (cond()) return true;
    demoFrame(DEMO.draw);
  }
  DEMO.notes.push(`超时 ${sec}s：${why || '未说明'}（第 ${S.day} 天，帧 ${DEMO.frames}）`);
  return false;
}

// 停表条件：帧预算用完，且正好停在一个没有人的安全点——和玩家中途走开一样，随时能续
function demoHalted() {
  if (DEMO.finished) return true;
  if (DEMO.mode === 'endless' && DEMO.target && S.day > DEMO.target) return true;
  if (DEMO.frames < DEMO.stopAt) return false;
  return !(scene === 'booth' && B && (B.ent || B.event || B.cut || B.closeup || B.ending));
}

const boxCenter = (b) => [Math.round((b[0] + b[2]) / 2), Math.round((b[1] + b[3]) / 2)];

function demoClick(x, y) { if (scene === 'booth') boothInput(x, y); else sceneClick(x, y); }
const demoClickBox = (b) => { const [x, y] = boxCenter(b); demoClick(x, y); };

// ———————————————————— 抓帧与导出 ————————————————————

function demoGrab() {
  try {
    if (!DEMO.draw) render();     // 延时摄影只在不画的那几帧需要现画一次，省掉 99% 的渲染开销
    const shot = DEMO.sent;      // 截图序号：ffmpeg 要连续编号，接收端按它落盘
    const body = `${DEMO.tag}\n${shot}\n${S.day}\n${F.toDataURL('image/png')}`;
    fetch(`${DEMO.sink}/frame`, { method: 'POST', body }).catch(() => { DEMO.dropped++; });
    DEMO.sent++;
  } catch (e) { DEMO.dropped++; }
}

// 流水账文本交给本地接收端落盘，免得几千行塞进一次求值的返回里
function demoDump() {
  const csv = (rows, head) => [head.join(',')].concat(rows.map((r) => head.map((k) => (r[k] === undefined || r[k] === null ? '' : String(r[k]))).join(','))).join('\n');
  const shiftRows = DEMO.shifts.map((r) => ({ ...r, date: dateOf(r.day), weekday: weekdayOf(r.day) }));
  const name = `${DEMO.mode}-${DEMO.tag}`;
  fetch(`${DEMO.sink}/file/${name}-shifts.csv`, { method: 'POST', body: csv(shiftRows, ['day', 'date', 'weekday', 'mode', 'people', 'correct', 'pay', 'bonus', 'fines', 'cites', 'bribe', 'savings']) }).catch(() => {});
  fetch(`${DEMO.sink}/file/${name}-people.csv`, { method: 'POST', body: csv(DEMO.ledger, ['day', 'mode', 'person', 'kind', 'want', 'got', 'pass', 'then']) }).catch(() => {});
  fetch(`${DEMO.sink}/file/${name}-notes.txt`, { method: 'POST', body: DEMO.notes.join('\n') }).catch(() => {});
  fetch(`${DEMO.sink}/file/${name}-marks.json`, { method: 'POST', body: JSON.stringify(DEMO.marks, null, 1) }).catch(() => {});
  return name;
}

// ———————————————————— 搬证件 ————————————————————

// dragMove 用「抓取点减证件左上角」的偏移定位，所以松手点取 (X + off, Y + off)，
// 夹取范围算完之后左上角落在 (X, Y)。
function botPlaceAt(d, X, Y) {
  B.docs = B.docs.filter((o) => o !== d).concat([d]);    // 置顶，免得抓到压在上面的另一张
  dragStart(d, d.x + 2, d.y + 2);
  const off = d.big ? [2, 2] : [Math.min(24, d.doc.w / 2), 12];
  drag.off = off;
  drag.startedBig = d.big;
  dragMove(X + off[0], Y + off[1]);
  dragEnd(X + off[0], Y + off[1]);
}

// 其余证件往左边扇形排开；主角证件单独算，要盖到章
function botSpotFor(d, i, primary) {
  if (d.key === primary) return null;
  const n = i > 3 ? i - 3 : i;
  return [232 + n * 16, 140 + n * 14];
}

// MARK_XY 是印章图形的左上角，落章点在它右下 29,17——把主证件压在这个点上才盖得上
function botStampSpot(d, dec) {
  const [mx, my] = MARK_XY[dec];
  return [Math.max(DESK[0], Math.min(mx + 29 - d.doc.w / 2, W - d.doc.w)), Math.max(DESK[1], my + 17 - d.doc.h / 2)];
}

// 把柜台上还没拿起来的证件摆上桌（主角证件留给盖章那步），顺带等套娃/手风琴吐出下一张
function botUnpack(e) {
  for (let pass = 0; pass < 6; pass++) {
    const todo = e.docs.filter((d) => !d.big && !d.returned && d.owner === 'ent' && d.key !== e.spec.primary);
    if (!todo.length) { if (pass === 0) return; continue; }
    todo.forEach((d, i) => botPlaceAt(d, ...botSpotFor(d, i, e.spec.primary)));
    demoRun(0.7);
  }
}

function botReturn(e) {
  for (let pass = 0; pass < 4; pass++) {
    const on = e.docs.filter((d) => d.big && !d.returned);
    if (!on.length) return;
    on.forEach((d) => botPlaceAt(d, 150, 250));
    demoRun(0.3);
  }
}

// ———————————————————— 判定 ————————————————————

// spec.ok 是这个旅客的可接受处置；优先盖章，盖不了才拘留。
// ok 为空的（岳母 Opus）没有标准答案，三种章各通向一种结局，按 DEMO.forceDec 点名。
function botDecision(spec) {
  const forced = DEMO.forceDec[spec.person];
  if (forced) return forced;
  if (spec.ok.includes('approve')) return 'approve';
  if (spec.ok.includes('deny')) return 'deny';
  return 'detain';
}

function botStamp(dec) {
  setTray(true);
  demoWait(() => trayU() > 0.6, 3, '印章栏没拉开');
  demoClickBox(stampBtnBox(dec, trayX()));
  demoRun(0.9);
}

// 把一条矛盾点出来：演示要让人看见「查」这个动作
function botFindField(key) {
  const dot = key.indexOf('.');
  const dk = key.slice(0, dot), name = key.slice(dot + 1);
  if (dk === 'say') {
    const line = B.lines.slice(-3).find((ln) => ln.who === 'E');
    const lb = lineBoxes().find((x) => x.ln === line);
    return lb ? boxCenter(lb.box) : null;
  }
  if (dk === 'xr') {
    const e = B.ent;
    const it = e && e.spec.xray ? e.spec.xray.find((o) => o.key === key) : null;
    return it && entrantX(e) !== null ? boxCenter(xrayItemBox(e, it)) : null;
  }
  for (const d of [...B.docs].reverse()) {
    if (!d.big || !d.doc.fields) continue;
    const f = d.doc.fields[name];
    if (!f) continue;
    return boxCenter([d.x + f[0], d.y + f[1], d.x + f[2], d.y + f[3]]);
  }
  return null;
}

// 宪法要翻到含这一条的那页才点得到
function botRuleOnPage(ruleKey) {
  if (!B.ruleInst) toggleRules();
  const book = B.ruleInst.doc;
  for (let i = 0; i <= book.npages; i++) {
    if (book.fields[ruleKey]) return true;
    book.flip();
  }
  return false;
}

function botInspect(spec) {
  if (!spec.issues || !spec.issues.length) return;
  const is = spec.issues.find((o) => o.pairs && o.pairs.length);
  if (!is) return;
  if (!B.insp.on) demoClickBox(INSPECT_BTN);
  const pair = is.pairs[0];
  const rules = pair.filter((k) => k.startsWith('rule.'));
  if (rules.length) {
    for (const k of rules) botRuleOnPage(k.slice(5));
    if (!B.ruleInst.big) botPlaceAt(B.ruleInst, 470, 150);
  }
  for (const k of pair) {
    const at = botFindField(k);
    if (!at) { DEMO.notes.push(`第 ${S.day} 天：找不到字段 ${k}`); continue; }
    demoClick(at[0], at[1]);
    demoRun(0.25);
  }
  demoRun(0.5);
  if (B.insp.on) demoClickBox(INSPECT_BTN);
}

// ———————————————————— 桥段 ————————————————————

// 黑话快剪 / 蒸馏大军 / 特写 / 聊天封号
function botEvents() {
  if (B.closeup) { demoClick(320, 200); demoRun(0.3); return true; }
  if (B.cut) { demoRun(0.5); return true; }   // 聊天封号让它自己演完，点击只能提前跳过，画面反而缺一段
  const ev = B.event;
  if (!ev) return false;
  if (ev.type === 'rush') {
    if (!ev.lock && B.ent) demoClickBox(ev.list[ev.i].ok === 'approve' ? RUSH_APPROVE : RUSH_DENY);
    else demoRun(0.2);
    demoWait(() => !B.event || B.event !== ev || !ev.lock, 6, '快剪卡住');
    return true;
  }
  if (ev.type === 'clones') {
    for (const c of ev.items) {
      if (c.state !== 'run') continue;
      const [cx, cy] = clonePos(c);
      if (cy - 6 < 124) demoClick(Math.round(cx), Math.round(cy - 6));
    }
    demoRun(0.1);
    return true;
  }
  demoRun(0.2);
  return true;
}

// ———————————————————— 一名旅客 ————————————————————

function botTraveler() {
  const e = B.ent;
  if (!e) return false;
  const spec = e.spec;
  demoWait(() => e.phase === 'here' || e.phase === 'waiting' || e.phase === 'leave', 20, '旅客没进场');
  if (e.phase !== 'here') return true;
  // 纯剧情人物（封号后的乔治）不插手：它自己走完台词就会被 later() 送走
  if (!spec.docs || !spec.docs.length) {
    demoWait(() => B.ent !== e, 40, '剧情人物没走完');
    if (B.ent !== e) botLedger(e);
    return true;
  }
  demoWait(() => e.handed, 20, '证件没递进来');
  if (!e.handed) return true;

  const dec = botDecision(spec);
  const prim = primaryOf(e);
  if (!prim) { DEMO.notes.push(`第 ${S.day} 天：${spec.person} 没有主证件`); return true; }

  botUnpack(e);
  botPlaceAt(prim, 296, 196);          // 主证件摊在桌中间：字段点得到，掉出来的东西也归它管
  demoRun(0.7);
  botUnpack(e);
  if (DEMO.showInspect && dec !== 'approve') botInspect(spec);
  botUnpack(e);

  if (dec === 'detain') {
    demoClickBox(DETAIN_BTN);
    demoWait(() => B.ent !== e, 6, '拘留没生效');
    if (B.ent !== e) botLedger(e);
    return true;
  }
  botPlaceAt(prim, ...botStampSpot(prim, dec));
  botStamp(dec);
  if (!decisionOf(prim)) {            // 章没落在主证件上：挪一下再压一次
    botPlaceAt(prim, botStampSpot(prim, dec)[0] - 20, botStampSpot(prim, dec)[1] + 6);
    botStamp(dec);
    if (!decisionOf(prim)) DEMO.notes.push(`第 ${S.day} 天：${spec.person} 的 ${dec} 章没盖上`);
  }
  botReturn(e);
  if (DEMO.lapse && DEMO.rec && !DEMO.lapseBooth && B.idx > B.queue.length / 2) {   // 每班留一张桌面上的画面
    DEMO.lapseBooth = 1;
    demoRun(0.4);
    demoGrab();
  }
  demoWait(() => B.ent !== e, 12, '递回后人没走');
  if (B.ent !== e) botLedger(e);
  return true;
}

function botLedger(e) {
  if (e.noJudge) return;   // 封号后的乔治只是段戏，judge 根本不跑，别记成误判
  const ok = e.spec.ok || [];
  DEMO.ledger.push({
    day: S.day, mode: S.mode, person: e.spec.person, kind: e.spec.kind || '',
    want: ok.join('/'), got: e.decided || 'detain',
    pass: e.spec.author || e.spec.family || !ok.length ? '' : (ok.includes(e.decided || 'detain') ? '1' : '0'),
    then: e.spec.then || '',
  });
}

// ———————————————————— 一天 / 一整局 ————————————————————

function botBooth() {
  while (!demoHalted()) {
    if (scene !== 'booth') return;
    if (B.ending) { demoWait(() => scene !== 'booth', 30, '当天结算没出来'); return; }
    if (B.event || B.closeup || B.cut) { botEvents(); continue; }
    if (B.ent) {
      const e = B.ent;
      const shot0 = DEMO.sent;
      botTraveler();
      if (B.ent !== e) DEMO.marks.push({ tag: DEMO.tag, day: S.day, person: e.spec.person, kind: e.spec.kind || '', dec: e.decided || (e.noJudge ? 'noJudge' : 'detain'), from: shot0, to: DEMO.sent });
      if (B.ent === e) {
        demoRun(0.5);
        if (B.ent === e) { DEMO.notes.push(`第 ${S.day} 天：${e.spec.person} 处理完还没走，跳过`); e.phase = 'leave'; }
      }
      continue;
    }
    if (B.idx >= B.queue.length) { demoWait(() => scene !== 'booth', 40, '当天没结算'); return; }
    demoWait(() => !B.ent && !B.event && now - B.lastFinish > 0.3, 20, '下一位等太久');
    demoClickBox(SPEAKER);
    demoRun(0.6);
  }
}

// 检查亭之外：日卡自己走，报纸/结算/片尾/结局都要点一下
function botScenes(stopAtEnd) {
  for (let guard = 0; guard < 200 && !demoHalted(); guard++) {
    if (scene === 'booth') return;
    if (scene === 'daycard') {
      if (DEMO.lapse && DEMO.rec) { demoGrab(); DEMO.lapseBooth = 0; }
      if (demoWait(() => scene !== 'daycard', 8, '日卡没走')) continue;
      return;
    }
    if (scene === 'news') { if (st() > 0.6) demoClick(320, 330); demoRun(0.4); continue; }
    if (scene === 'summary') {
      if (st() <= 1.2) { demoRun(0.3); continue; }
      DEMO.shifts.push({ day: S.day, mode: S.mode, people: B ? B.total : 0, correct: B ? B.correct : 0, pay: B ? B.pay : 0, bonus: B ? B.bonus : 0, fines: B ? B.fines : 0, cites: B ? B.cites : 0, bribe: B ? B.bribe : 0, savings: S.savings });
      if (DEMO.lapse && DEMO.rec) demoRun(1.6);          // 结算单上的字要长齐了再拍
      if (DEMO.lapse && DEMO.rec) demoGrab();
      demoClickBox(CONTINUE_BTN);
      demoRun(0.6);
      continue;
    }
    if (scene === 'erased') { demoRun(0.5); continue; }
    if (scene === 'end') {
      if (stopAtEnd) return;
      // 第 6 天的作者结局是周目分叉，画面要等 2.4 秒才受理点击
      if (hasNextWeek() && S.day === END_DAY) {
        if (st() > 2.4) demoClickBox(WEEK_BTN);
        else demoRun(0.4);
        continue;
      }
      return;
    }
    if (scene === 'over') { DEMO.notes.push(`第 ${S.day} 天余额见底，停机`); return; }
    if (scene === 'title' || scene === 'codex') return;
    demoRun(0.3);
  }
}

function botStart(mode, opts = {}) {
  botBoot(opts.lang);
  Object.assign(DEMO, {
    ledger: [], shifts: [], notes: [], marks: [], finished: false, mode,
    target: mode === 'endless' ? (opts.shifts || null) : null,
    showInspect: !!opts.inspect, draw: !!opts.render, rec: !!opts.rec, tag: opts.tag || mode,
    lapse: !!opts.lapse, lapseBooth: 0,
    stopAt: Infinity, frames: 0, sent: 0, dropped: 0,
  });
  clearSave(mode); newGame(mode); S.day = 1; go('daycard');
}

// 机器人也得走一次选语言：initChat() 挂在 chooseLang 上，跳过它 Day 6 的聊天桥段会缺变量。
function botBoot(lang) {
  chooseLang(lang || DEMO.lang || 'zh');
  localStorage.clear();
  if (!SFX.muted) SFX.toggleMute();   // 机器人不点 canvas，本来就不会建 AudioContext，这里是双保险
  window.loop = () => {};             // 冻结 rAF：时间只由 demoFrame 推，跑多长都不受真实时间限制
}

// 推进至多 frames 帧，一定停在安全点上；返回进度，可以反复调用
function botStep(frames) {
  DEMO.stopAt = DEMO.frames + (frames || 1e12);
  while (!demoHalted()) {
    if (scene === 'over') { DEMO.finished = true; break; }
    if (scene === 'end' && !(DEMO.mode === 'story' && hasNextWeek() && S.day === END_DAY)) { DEMO.finished = true; break; }
    if (scene === 'booth') botBooth();
    else botScenes(DEMO.mode === 'endless');
  }
  return {
    done: DEMO.finished, frames: DEMO.frames, day: S.day, scene,
    people: DEMO.ledger.length, shifts: DEMO.shifts.length, notes: DEMO.notes.length,
    correct: S.stats ? S.stats.correct : 0, wrong: S.stats ? S.stats.wrong : 0, savings: S.savings,
    ending: S.flags ? S.flags.ending : '', sent: DEMO.sent, dropped: DEMO.dropped,
  };
}

// 无人值守连续推进：用 MessageChannel 排任务，后台标签页里不会像 setInterval 那样被节流。
// 长局（无尽 1000 班）靠它自己跑，外面只在需要时查一次进度。
function botPump(framesPerTask = 600) {
  if (DEMO.pump) return DEMO.pump;
  const ch = new MessageChannel();
  const state = { running: true, tasks: 0, last: null, started: Date.now() };
  DEMO.pump = state;
  const tick = () => {
    if (!state.running) { DEMO.pump = null; return; }
    state.last = botStep(framesPerTask);
    state.tasks++;
    if (state.last.done) { state.running = false; DEMO.pump = null; return; }
    ch.port2.postMessage(0);
  };
  ch.port1.onmessage = tick;
  tick();
  return state;
}

function botStopPump() { if (DEMO.pump) { DEMO.pump.running = false; return true; } return false; }

function botStopPump() { if (DEMO.pump) { DEMO.pump.running = false; return true; } return false; }

// 一串任务连着跑，全程无人值守：每个任务跑完就起下一个，并把它的流水账落盘。
// 任务形如 { mode: 'story', tag: 'w2zh', lang: 'zh', render: true, rec: true, inspect: true }
//        或 { mode: 'endless', tag: 'e1zh', shifts: 1, render: true, rec: true }
function botQueue(jobs) {
  const ch = new MessageChannel();
  const st = { running: true, i: 0, jobs, log: [] };
  DEMO.series = st;
  const done = () => DEMO.finished || (DEMO.mode === 'endless' && DEMO.target && S.day > DEMO.target);
  const tick = () => {
    if (!st.running) { DEMO.series = null; return; }
    const job = jobs[st.i];
    if (st.i === 0 && !st.log.length) { botStart(job.mode, job); st.log.push(job.tag); }
    if (job.from) { DEMO.draw = S.day >= job.from; DEMO.rec = S.day >= job.from; }   // 前面那些班只跑逻辑，到指定班才开始画
    botStep(600);
    if (done()) {
      botDump();
      st.i++;
      if (st.i >= jobs.length) { st.running = false; return; }
      botStart(jobs[st.i].mode, jobs[st.i]);
      st.log.push(jobs[st.i].tag);
    }
    ch.port2.postMessage(0);
  };
  ch.port1.onmessage = tick;
  tick();
  return st;
}

window.DEMO = DEMO;
window.botBoot = botBoot;
window.botStart = botStart;
window.botStep = botStep;
window.botPump = botPump;
window.botQueue = botQueue;
window.botStopPump = botStopPump;
window.botDump = demoDump;
window.demoRun = demoRun;
