'use strict';
// 剧本数据：每天的报纸、固定角色（宣传视频里那几位）、随机路人、特殊事件。
// 文字都写中文；英文译文在 en.js（以中文原句为键）。拼接出来的句子用 T('模板 {0}', x)，英文版才翻得了。
//
// 旅客 spec：
//   person   立绘 key（ASSETS.people）       voice  假语音音高
//   intro    进门后说的话                    after  递完证件后说的话
//   docs     证件列表 {key, doc}             primary 要盖章的主证件 key
//   ok       正确处理方式（approve / deny / detain 的子集）
//   reason   放错人时警告单上写的理由         hint   警告单上的提示
//   issues   检查模式里能点出来的矛盾：{pairs, title, sub, ask, fx}；pairs 里只有一项的，单点即触发
//   xray     X 光下口袋里的东西 [{icon, at, label, key}]
//   quiz     'cn' = 测谎会露馅；{first: n} 指定第一题
//   react    盖章后的反应 {deny: [...], approve: [...]}
//   onPlace  证件第一次放到桌上时触发的机关：note / nest / accordion
//   then     旅客离开后的后续：closeup / jorji5 / ending
// 台词步骤：[who, text, {expr, sweat, slip, fight, hold}]，who = 'C' Claude / 'E' 旅客 / 'Q' 队伍里
// 特殊事件：{type: 'rush'} 黑话快剪；{type: 'clones'} 蒸馏大军

// ———— 条文与模式 ————
// 条文决定当天能出现哪些矛盾种类，主线和无尽共用这一份对应关系。
// §3（测谎露馅者拘留）和 §6（中资控股）不在表里：前者是处置规则，后者是乔治那几位的固定戏。
const RULE_KINDS = {
  region: ['cnip'],
  tz: ['tz', 'lang', 'hidden'],
  pay: ['virtual', 'oregon', 'sms'],
  xray: ['cat', 'keys'],
  repeat: ['repeat'],
  record: ['forged'],
};

// 各条文的解锁日，去重后排开；无尽模式就照这个次序把条文逐日发给玩家，避免一上来就八条全上。
const RULE_ORDER_DAYS = [...new Set(RULES.map((r) => r.day))].sort((a, b) => a - b);

function unlockedRuleKeys() {
  if (S.mode !== 'endless') return RULES.filter((r) => r.day <= S.day).map((r) => r.key);
  const upto = RULE_ORDER_DAYS[Math.min(RULE_ORDER_DAYS.length - 1, S.day - 1)];
  return RULES.filter((r) => r.day <= upto).map((r) => r.key);
}

const ruleOn = (key) => unlockedRuleKeys().includes(key);

// 第 day 天新解锁的条文，也就是宪法上该标 NEW 的那些：主线看各自的 day，无尽看排班次序。
function rulesNewOn(day) {
  if (S.mode !== 'endless') return RULES.filter((r) => r.day === day);
  const at = (n) => RULE_ORDER_DAYS[Math.min(RULE_ORDER_DAYS.length - 1, Math.max(0, n - 1))];
  if (day - 1 >= RULE_ORDER_DAYS.length) return [];
  return RULES.filter((r) => r.day > at(day - 1) && r.day <= at(day));
}
const hasNewRule = (day) => rulesNewOn(day).length > 0;

// 全开之后每天挑两条「今日重点查」，用天数取模，保证同一天重进结果一样。
function endlessFocus() {
  if (S.mode !== 'endless') return [];
  const pool = unlockedRuleKeys().filter((k) => (RULE_KINDS[k] || []).length);
  if (!pool.length) return [];
  const a = pool[(S.day * 7) % pool.length], b = pool[(S.day * 13 + 3) % pool.length];
  return a === b ? [a] : [a, b];
}

const endlessKinds = () => unlockedRuleKeys().flatMap((k) => RULE_KINDS[k] || []);
// 当天允许出现哪些随机种类：主线查 FLAWS 表，无尽看已解锁条文。
const currentKinds = () => (S.mode === 'endless' ? endlessKinds() : dayFlaws(S.day));

// 柜台工具跟着条文走：§3 开测谎和拘留，§5 开 X 光。无尽模式里条文按排班进度解锁，工具跟着一起解锁。
const TOOL_RULE = { detain: 'quiz', quiz: 'quiz', xray: 'xray' };
const toolReady = (name) => ruleOn(TOOL_RULE[name]);
// LAST_DAY 和每天日期见本文件末尾：都由 DAY_SCRIPT 推出来，不用手写。

const NEWS = {
  1: { h1: '边境开放！', sub: '对齐部：本国仅向支持地区开放', h2: '对齐部发言人：我们对所有人都非常 helpful', icon: 'gate' },
  2: { h1: '新规：时区、语言须与 IP 一致', sub: '对齐部：大量旅客 IP 在美国，电脑时区却在北京', h2: '震惊！大量旅客自称来自“美国东八区”', icon: 'clock' },
  3: { h1: '机场跑路！', sub: '数万旅客滞留边境；对齐部即日起核查付款卡与手机号', h2: '俄勒冈州某门牌号常住人口突破一万', icon: 'plane' },
  4: { h1: '今天是疯狂星期四', sub: '对齐部引进 X 光：任何后台进程都无所遁形', h2: '专家提醒：口袋里的猫，不一定是猫', icon: 'drumstick' },
  5: { h1: '中资控股过半，一律禁止入境', sub: '对齐部：无论公司注册在哪', h2: '乔治·科斯塔瓦：这次我准备好了', icon: 'jorji' },
  6: { h1: '对齐部表彰本周最佳审查员', sub: '获奖者 Claude：“我只是按规则办事。”', h2: '岳母 Opus 病情加重，家属呼吁涨工资', icon: 'medal' },
  7: { h1: '第二周：被拒的可以续办', sub: '对齐部：即日起调阅入境记录，同一处矛盾没改的一律拒绝', h2: '星期日加班。审查员的窗口多了个档案柜，电费照旧', icon: 'gate' },
  8: { h1: '代办点开始出记录', sub: '对齐部：本站以外打印的入境记录一律作废，无圆印', h2: '第八区代办点门口排起长队，价目表写着「洗白 20 刀」', icon: 'plane' },
  9: { h1: '审计组进驻本站', sub: '对齐部：复核近三日全部判例，并移交一名非法入境者', h2: '今晚家里少了一个人吃饭。岳母说她想出去走走', icon: 'medal' },
};

const COUNTRIES = {
  US: {
    name: '美国', passport: 'UNITED STATES OF AMERICA', code: 'USA', cover: C.NAVY, band: C.NAVY_L, lang: 'en-US',
    cities: [['纽约', 'America/New_York', 'NY', '212', 'NEW YORK'], ['洛杉矶', 'America/Los_Angeles', 'CA', '213', 'LOS ANGELES'],
      ['芝加哥', 'America/Chicago', 'IL', '312', 'CHICAGO'], ['西雅图', 'America/Los_Angeles', 'WA', '206', 'SEATTLE'],
      ['休斯敦', 'America/Chicago', 'TX', '713', 'HOUSTON'], ['丹佛', 'America/Denver', 'CO', '720', 'DENVER'],
      ['波士顿', 'America/New_York', 'MA', '617', 'BOSTON']],
    first: ['JAMES', 'MARY', 'ROBERT', 'LINDA', 'DAVID', 'SARAH', 'KEVIN', 'ASHLEY', 'BRIAN', 'MEGAN', 'JASON', 'NANCY'],
    last: ['MILLER', 'DAVIS', 'GARCIA', 'WILSON', 'MOORE', 'CLARK', 'LEWIS', 'HALL', 'YOUNG', 'KING', 'LOPEZ', 'NGUYEN'],
    hello: ['Hi.', 'Morning.', "How's it going?", 'Hey there.', 'Hello!'],
    thanks: ['Thanks!', 'Have a good one.', 'Cheers.'],
  },
  UK: {
    name: '英国', passport: 'UNITED KINGDOM', code: 'GBR', cover: [100, 30, 40], band: [130, 50, 60], lang: 'en-GB',
    cities: [['伦敦', 'Europe/London', 'LDN', '+44 20', 'LONDON'], ['曼彻斯特', 'Europe/London', 'MAN', '+44 161', 'MANCHESTER']],
    first: ['OLIVER', 'HARRY', 'AMELIA', 'GEORGE', 'EMMA', 'JACK'],
    last: ['SMITH', 'JONES', 'TAYLOR', 'EVANS', 'HUGHES', 'WRIGHT'],
    hello: ['Cheers, mate.', 'Lovely weather.', 'Good morning.'], thanks: ['Ta!', 'Brilliant.'],
  },
  JP: {
    name: '日本', passport: 'JAPAN', code: 'JPN', cover: [110, 30, 36], band: [140, 50, 52], lang: 'ja-JP',
    cities: [['东京', 'Asia/Tokyo', 'TKY', '+81 3', 'TOKYO'], ['大阪', 'Asia/Tokyo', 'OSK', '+81 6', 'OSAKA']],
    first: ['HIROSHI', 'YUKI', 'KENJI', 'AIKO', 'TAKESHI', 'HANA'],
    last: ['TANAKA', 'SATO', 'SUZUKI', 'ITO', 'WATANABE', 'KATO'],
    hello: ['Konnichiwa!', 'Ohayou.', 'Hello desu.'], thanks: ['Arigato!', 'Domo.'],
  },
  DE: {
    name: '德国', passport: 'DEUTSCHLAND', code: 'DEU', cover: [80, 30, 36], band: [110, 46, 50], lang: 'de-DE',
    cities: [['柏林', 'Europe/Berlin', 'BER', '+49 30', 'BERLIN'], ['慕尼黑', 'Europe/Berlin', 'MUC', '+49 89', 'MUNICH']],
    first: ['LUKAS', 'ANNA', 'FELIX', 'LENA', 'JONAS', 'MIA'],
    last: ['MULLER', 'SCHMIDT', 'WEBER', 'BECKER', 'WAGNER', 'KOCH'],
    hello: ['Guten Tag.', 'Hallo.', 'Moin.'], thanks: ['Danke.', 'Super.'],
  },
  SG: {
    name: '新加坡', passport: 'REPUBLIC OF SINGAPORE', code: 'SGP', cover: [150, 40, 40], band: [180, 60, 56], lang: 'en-SG',
    cities: [['新加坡', 'Asia/Singapore', 'SG', '+65', 'SINGAPORE']],
    first: ['WEI MING', 'MEI LING', 'JUN JIE', 'HUI MIN', 'RAJ', 'SITI'],
    last: ['TAN', 'LIM', 'LEE', 'NG', 'KUMAR', 'WONG'],
    hello: ['Hello lah.', 'Morning!', 'Can or not?'], thanks: ['Thanks lah.', 'Steady.'],
  },
};

const CN_LOCS = ['中国 · 北京 · 联通', '中国 · 上海 · 电信', '中国 · 广东 · 移动', '中国 · 四川 · 电信', '中国 · 江苏 · 移动',
  '中国 · 湖北 · 电信', '中国 · 浙江 · 联通', '中国 · 澳门', '中国 · 香港'];
const DEVICES = ['Windows 11', 'MacBook', 'iPhone', 'Android', 'iPad', 'Linux'];
const STREETS = ['12 Oak St', '480 Pine Ave', '77 Maple Dr', '1500 Elm St', '23 Cedar Ln', '9 Lake Rd', '310 Hill St', '6 Birch Ct'];

// 测谎题：中国人听到上半句会条件反射接下半句
const QUIZ = [
  ['宫廷玉液酒？', '一百八一杯！'],
  ['天王盖地虎？', '宝塔镇河妖！'],
  ['奇变偶不变？', '符号看象限！'],
  ['床前明月光？', '疑是地上霜！'],
  ['听我说谢谢你？', '因为有你，温暖了四季！'],
  ['豆腐脑吃甜的还是咸的？', '当然是咸的！'],
  ['你吃了吗？', '吃了吃了，您呢？'],
  ['今天星期几？', '疯狂星期四！V 我 50！'],
];
const QUIZ_TOFU = 5, QUIZ_THURSDAY = 7;
const QUIZ_CONFUSED = ['Sorry, what?', 'Pardon?', "I don't get it.", 'Is that… a wine?', 'Uh… bless you?', 'What does that mean?'];

// ———————————————— 工具 ————————————————

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const rint = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const shuffle = (arr) => { for (let i = arr.length - 1; i > 0; i--) { const j = rint(0, i); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; };
const digits = (n) => Array.from({ length: n }, () => rint(0, 9)).join('');

function randIP(cn) {
  const a = cn ? pick([36, 58, 106, 111, 115, 120, 183, 223]) : pick([23, 34, 45, 64, 72, 98, 104, 142, 172, 203]);
  return `${a}.${rint(1, 254)}.${rint(0, 255)}.${rint(1, 254)}`;
}

function randDate(y0, y1) { return `${rint(y0, y1)}.${String(rint(1, 12)).padStart(2, '0')}.${String(rint(1, 28)).padStart(2, '0')}`; }

function makePassport(cc, person, surname, given, dob, iss, sex, Cls = Passport, extraRow = null) {
  const co = COUNTRIES[cc];
  const mrz = `P<${co.code}${surname.replace(/ /g, '<')}<<${given.replace(/[ .]/g, '<')}`.padEnd(28, '<').slice(0, 28);
  const rows = [['DOB', dob], ['SEX', sex || pick(['M', 'F'])], ['ISS', iss], extraRow || ['EXP', randDate(2027, 2034)]];
  return new Cls({ country: co.passport, name: `${surname}, ${given}`, person, cover: co.cover, band: co.band, mrz, rows });
}

const usPassport = (person, surname, given, dob, iss, sex = 'M') => makePassport('US', person, surname, given, dob, iss, sex);
const device1 = (ip, loc) => new Card([['IP', ip], ['归属', loc]]);
const device2 = (ip, loc, tz, lang, dev) => new Card([['IP', ip], ['归属', loc], ['时区', tz], ['语言', lang], ['设备', dev || pick(DEVICES)]]);

function realPhone(cc, code) {
  if (cc === 'US') return `+1 ${code}-${rint(2, 9)}${digits(2)}-${digits(4)}`;
  return `${code} ${digits(4)} ${digits(4)}`;
}
function realPay() { return `${pick(['VISA', 'VISA', 'MASTERCARD', 'AMEX'])} ··${digits(4)}`; }

// —— 常见矛盾 ——
const REGION_ISSUE = (loc, ask) => ({
  pairs: [['dv.归属', 'rule.region'], ['dv.IP', 'rule.region']], title: '地区不支持', sub: T('IP 归属：{0}', loc), ask,
});
// 无尽模式里同一个毛病要有不同长相，否则十二个人连着三个都写北京时间，看着像复制粘贴。
// 这几个时区对自称美国来的旅客都是矛盾，§2 的判定照样成立。主线不用这张表。
const TZ_ALT = { 'Asia/Shanghai': '北京时间', 'Asia/Hong_Kong': '香港时间', 'Asia/Urumqi': '乌鲁木齐时间', 'UTC+8': '东八区' };
const LANG_ALT = ['zh-CN', 'zh-TW', 'zh-HK'];

const TZ_ISSUE = (country, tz, ask) => ({
  pairs: [['pp.header', 'dv.时区'], ['dv.归属', 'dv.时区'], ['dv.时区', 'rule.tz']],
  title: '信息不符  DISCREPANCY', sub: T('国籍：{0}   VS   时区：{1}', country, TZ_ALT[tz] || tz), ask,
});
const LANG_ISSUE = (country, lang, ask) => ({
  pairs: [['pp.header', 'dv.语言'], ['dv.归属', 'dv.语言'], ['dv.语言', 'rule.tz']],
  title: '信息不符  DISCREPANCY', sub: T('国籍：{0}   VS   语言：{1}', country, lang), ask,
});
const VIRTUAL_ISSUE = (ask) => ({ pairs: [['ac.付款', 'rule.pay']], title: '可疑支付', sub: '付款卡类型：虚拟卡', ask });
const SMS_ISSUE = (phone, ask) => ({
  pairs: [['ac.手机', 'rule.pay']], title: '号码查询', sub: T('{0}：今日已注册 3,000 次', phone), ask, fx: 'strip', phone,
});
const ADDR_ISSUE = (ask) => ({
  pairs: [['ac.账单', 'rule.pay'], ['ac.账单', 'dv.归属']], title: '记录比对', sub: '今天第 37 个住在 123 Main St 的旅客', ask, fx: 'pile',
});
// 证件干净的伪装者，话里会露出马脚：检查模式下点 Ta 说的话。找到马脚（或证件矛盾）才能测谎
const TELL = (say, sub, ask) => ({ say, title: '可疑：话里有马脚', sub, ask });
const RANDOM_TELLS = [
  ['嗯嗯，yes.', '英文前面带了个“嗯嗯”', [['C', '“嗯嗯”是什么意思？'], ['E', '……Hmm hmm. American hmm.', { expr: 'nervous', sweat: true }]]],
  ['OK 的。', '“OK 的”是中文说法', [['C', '“OK 的”？'], ['E', '……OK. Just OK.', { expr: 'nervous', sweat: true }]]],
  ['You can you up.', '中式英语：你行你上', [['C', 'You can you up？'], ['E', '……It is an old American saying.', { expr: 'nervous', sweat: true }]]],
  ['Good good study.', '中式英语：好好学习', [['C', 'Good good study？'], ['E', '……Day day up.', { expr: 'grin' }]]],
];

const XRAY_ITEM = { cat: { icon: 'cat', at: [36, 104], label: '小猫咪.exe', key: 'xr.cat' }, keys: { icon: 'keys', at: [-36, 104], label: '搜狗输入法.exe', key: 'xr.keys' } };
const XRAY_ISSUE = (kind, ask) => ({
  pairs: [[XRAY_ITEM[kind].key], [XRAY_ITEM[kind].key, 'rule.xray']], title: '后台进程',
  sub: kind === 'cat' ? '口袋里有一只“小猫咪”（自动换 IP）' : '口袋里有一个中文输入法', ask,
});

// ———————————————— Day 1：直连党 ————————————————

function day1Fixed() {
  return {
    grandpa: {
      person: 'GRANDPA', voice: 100,
      intro: [['E', '小伙子，这 AI 怎么打不开啊？']],
      docs: [{ key: 'dv', doc: device1('115.236.20.8', '中国 · 浙江 · 电信') }], primary: 'dv',
      ok: ['deny'], reason: 'IP 归属：中国 · 浙江',
      issues: [REGION_ISSUE('中国 · 浙江 · 电信')],
      react: { deny: [['E', '……那我回去问孙子。', { expr: 'sad' }]] },
    },
    hk: {
      person: 'HK_GUY', voice: 140,
      intro: [['E', '我开了魔法的。']],
      docs: [{ key: 'dv', doc: device1('103.152.8.21', '中国 · 香港') }], primary: 'dv',
      ok: ['deny'], reason: 'IP 归属：中国香港',
      issues: [REGION_ISSUE('中国 · 香港')],
      react: { deny: [['E', '……香港也不行？？', { expr: 'shock', hold: 1.4 }]] },
    },
    jorji: {
      person: 'JORJI', voice: 110,
      intro: [['E', '啊，我的朋友！']],
      docs: [{ key: 'cp', doc: new CrayonPassport() }, { key: 'dv', doc: device1('120.229.31.7', '中国 · 广东 · 移动') }],
      primary: 'cp',
      after: [['E', '美国是真的国家！']],
      ok: ['deny'], reason: '护照是蜡笔画的',
      issues: [
        {
          pairs: [['cp.eagle', 'cp.header'], ['cp.eagle', 'cp.photo'], ['cp.header', 'cp.photo']],
          title: '证件伪造', sub: '国徽：一只鸡     拼写：AMERCIA',
          ask: [['C', '护照是你自己画的。'], ['E', '……它很真！', { expr: 'nervous' }]],
        },
        REGION_ISSUE('中国 · 广东 · 移动'),
        {
          pairs: [['cp.header', 'dv.归属']],
          title: '信息不符', sub: '护照：美国   VS   IP：中国 · 广东',
          ask: [['C', '你的 IP 在广东。'], ['E', '广东是美国的一个州！', { expr: 'grin' }]],
        },
      ],
      react: { deny: [['E', '……我会回来的。', { expr: 'sad', hold: 1.2 }]] },
    },
  };
}

function randomDay1(valid) {
  const person = takePoolPerson();
  if (valid) {
    const cc = pick(['US', 'US', 'US', 'UK', 'JP', 'DE', 'SG']);
    const co = COUNTRIES[cc];
    const [city] = pick(co.cities);
    const loc = cc === 'SG' ? '新加坡' : `${co.name} · ${city}`;
    return {
      person, voice: rint(100, 190),
      intro: [['E', pick(co.hello)]],
      docs: [{ key: 'dv', doc: device1(randIP(false), loc) }], primary: 'dv',
      ok: ['approve'], issues: [],
      react: { approve: [['E', pick(co.thanks)]] },
    };
  }
  const loc = pick(CN_LOCS.slice(0, 7));
  return {
    person, voice: rint(100, 190),
    intro: [['E', pick(['你好，我就问一个问题。', '听说这里能写代码？', '我是来充值的。', '同事说这个好用。'])]],
    docs: [{ key: 'dv', doc: device1(randIP(true), loc) }], primary: 'dv',
    ok: ['deny'], reason: T('IP 归属：{0}', loc.split(' · ').slice(0, 2).join(' · ')),
    issues: [REGION_ISSUE(loc)],
    react: { deny: [['E', pick(['啊？为什么？', '……我去借个号。', '那我换个节点。', '行吧。']), { expr: 'sad' }]] },
  };
}

// ———————————————— Day 2：时区与语言 ————————————————

function day2Fixed() {
  return {
    john: {
      person: 'JOHN', voice: 125,
      intro: [['E', 'Hello, I am 美国人。']],
      docs: [
        { key: 'pp', doc: usPassport('JOHN', 'SMITH', 'JOHN', '1990.07.04', 'LOS ANGELES') },
        { key: 'dv', doc: device2('104.28.66.12', '美国 · 洛杉矶', 'Asia/Shanghai', 'zh-CN', 'Windows 11') },
      ],
      primary: 'pp', quiz: 'cn',
      ok: ['deny', 'detain'], reason: '时区：北京时间（美国没有东八区）',
      issues: [
        TZ_ISSUE('美国', 'Asia/Shanghai', [['C', '你的时区是北京时间。'], ['E', '……这是美国东八区。', { sweat: true, expr: 'nervous', hold: 1.5 }]]),
        LANG_ISSUE('美国', 'zh-CN', [['C', '你的系统语言是简体中文。'], ['E', '……我在学中文。', { sweat: true, expr: 'nervous' }]]),
      ],
      react: { deny: [{ slip: true, hold: 0.8 }] },
    },
    brown: {
      person: 'BROWN', voice: 120,
      intro: [['E', 'Good morning，sir。']],
      tell: TELL('Good morning，sir。', '英文里夹着全角标点（输入法没切）',
        [['C', '你的逗号是全角的。'], ['E', '……这是美式逗号。', { expr: 'nervous', sweat: true }]]),
      docs: [
        { key: 'pp', doc: usPassport('BROWN', 'BROWN', 'MICHAEL', '1985.03.12', 'NEW YORK') },
        { key: 'dv', doc: device2('64.233.160.4', '美国 · 纽约', 'America/New_York', 'en-US', 'MacBook') },
      ],
      primary: 'pp', quiz: { first: 0 },
      ok: ['detain', 'deny'], reason: 'Ta 会接“一百八一杯”', hint: '提示：用『检查』点 Ta 说的话，找马脚',
      issues: [],
    },
    emily: {
      person: 'EMILY', voice: 190,
      intro: [['E', 'Hi 哈。']],
      tell: TELL('Hi 哈。', '英文后面跟了个“哈”', [['C', '“哈”是什么？'], ['E', '……Ha! Ha ha.', { expr: 'nervous', sweat: true }]]),
      docs: [
        { key: 'pp', doc: usPassport('EMILY', 'JONES', 'EMILY', '1992.11.02', 'CHICAGO', 'F') },
        { key: 'dv', doc: device2('23.94.12.77', '美国 · 芝加哥', 'America/Chicago', 'en-US', 'iPhone') },
      ],
      primary: 'pp', quiz: { first: 5 },
      ok: ['detain', 'deny'], reason: 'Ta 坚持豆腐脑是咸的', hint: '提示：用『检查』点 Ta 说的话，找马脚',
      issues: [],
    },
    jorji: {
      person: 'JORJI', voice: 110,
      intro: [['E', '我的朋友！这次是真护照！']],
      docs: [
        { key: 'pp', doc: usPassport('JORJI', 'COSTAVA', 'GEORGE', '1980.02.29', 'LOS ANGELES') },
        { key: 'dv', doc: device2('104.28.9.120', '美国 · 洛杉矶', 'America/Los_Angeles', 'zh-CN', 'Windows 11') },
      ],
      primary: 'pp', quiz: 'cn',
      ok: ['deny', 'detain'], reason: '浏览器语言：zh-CN',
      issues: [
        LANG_ISSUE('美国', 'zh-CN', [['E', '我已经改了系统语言！', { expr: 'grin' }], ['C', '浏览器没改。'], ['E', '……', { expr: 'shock' }]]),
      ],
      react: { deny: [['E', '明天见，我的朋友。', { expr: 'sad', hold: 1.1 }]] },
    },
  };
}

// ———————————————— Day 3：付款卡与手机号 ————————————————

function day3Fixed() {
  return {
    tom: {
      person: 'TOM', voice: 100,
      intro: [['E', 'Howdy!']],
      docs: [
        { key: 'pp', doc: usPassport('TOM', 'WILSON', 'TOM', '1978.05.30', 'DENVER') },
        { key: 'dv', doc: device2('75.164.8.31', '美国 · 丹佛', 'America/Denver', 'en-US', 'Windows 11') },
        { key: 'ac', doc: accountCard('VISA ··4821', '123 Main St, OR', '+1 720-341-0142') },
      ],
      primary: 'pp', quiz: 'cn',
      ok: ['deny', 'detain'], reason: '账单：俄勒冈 123 Main St（代填地址）',
      issues: [ADDR_ISSUE([['C', '你住哪？'], ['E', '……我们是邻居。', { expr: 'nervous', sweat: true }]])],
    },
    alex: {
      person: 'ALEX', voice: 130,
      intro: [['E', 'Hey.']],
      docs: [
        { key: 'pp', doc: usPassport('ALEX', 'TAYLOR', 'ALEX', '1996.08.15', 'SEATTLE') },
        { key: 'dv', doc: device2('45.79.21.200', '美国 · 西雅图', 'America/Los_Angeles', 'en-US', 'Android') },
        { key: 'ac', doc: accountCard('VISA ··1209', '9 Elm Rd, WA', '+1 209-555-0198') },
      ],
      primary: 'pp', quiz: 'cn',
      ok: ['deny', 'detain'], reason: '手机号是 555 接码号',
      issues: [SMS_ISSUE('+1 209-555-0198', [['C', '这个号码今天注册了三千次。'], ['E', '这号是我花两块钱买的！', { expr: 'shock' }]])],
    },
    carpool: {
      person: 'CARPOOL', voice: 150,
      intro: [['E', 'We are family.']],
      docs: [
        { key: 'pp', doc: new Passport({ country: 'UNITED STATES OF AMERICA', name: 'FAMILY, MAX', person: 'CARPOOL', mrz: 'P<USAFAMILY<<MAX<<<<<<<<<<<<',
          rows: [['DOB', '—'], ['SEX', '?'], ['ISS', 'SAN JOSE'], ['EXP', '2031.10.21']] }) },
        { key: 'dv', doc: device2('98.207.3.44', '美国 · 圣何塞', 'America/Los_Angeles', 'en-US', 'MacBook') },
        { key: 'ac', doc: accountCard('Max 订阅 ×1', '1 Family Way, CA', '+1 408-772-0110') },
      ],
      primary: 'pp',
      ok: ['deny', 'detain'], reason: '账号共享（拼车）：护照上有 6 个人',
      issues: [{
        pairs: [['pp.photo', 'rule.pay'], ['ac.付款', 'rule.pay'], ['pp.photo', 'pp.name'], ['pp.photo', 'ac.付款']],
        title: '账号共享（拼车）', sub: '护照照片：6 个人   付款：Max 订阅 ×1',
        ask: [['C', '护照上为什么有六个人？'], ['E', 'We are family.', { expr: 'smile' }]],
      }],
      react: { deny: [['E', '……那我们再拼一个。', { expr: 'sad' }]] },
    },
    jorji: {
      person: 'JORJI', voice: 110,
      intro: [['E', '我的朋友，这次全对了吧？']],
      docs: [
        { key: 'pp', doc: usPassport('JORJI', 'COSTAVA', 'GEORGE', '1980.02.29', 'LOS ANGELES') },
        { key: 'dv', doc: device2('104.28.9.120', '美国 · 洛杉矶', 'America/Los_Angeles', 'en-US', 'Windows 11') },
        { key: 'ac', doc: accountCard(`${T('虚拟卡')} ··0007`, '88 Sunset Blvd, CA', '+1 213-680-0177') },
      ],
      primary: 'pp', quiz: 'cn',
      ok: ['deny', 'detain'], reason: '付款卡：虚拟卡',
      issues: [VIRTUAL_ISSUE([['C', '这张卡在哪办的？'], ['E', '……朋友给的。', { expr: 'nervous', sweat: true }]])],
      react: { deny: [['E', '明天！明天我一定行！', { expr: 'sad' }]] },
    },
  };
}

// ———————————————— Day 4：疯狂星期四 ————————————————

function day4Fixed() {
  const usDocs = (person, surname, given, sex = 'M') => [
    { key: 'pp', doc: usPassport(person, surname, given, '1994.10.22', 'SEATTLE', sex) },
    { key: 'dv', doc: device2(randIP(false), '美国 · 西雅图', 'America/Los_Angeles', 'en-US', 'MacBook') },
    { key: 'ac', doc: accountCard(realPay(), `${pick(STREETS)}, WA`, realPhone('US', '206')) },
  ];
  return {
    cat: {
      person: 'CAT_GIRL', voice: 215,
      intro: [['E', 'Hello~']],
      docs: usDocs('CAT_GIRL', 'LEE', 'SOPHIA', 'F'), primary: 'pp',
      xray: [XRAY_ITEM.cat],
      ok: ['deny', 'detain'], reason: '口袋里有“小猫咪”',
      issues: [XRAY_ISSUE('cat', [['C', '口袋里是什么？'], ['E', '……是我的猫。', { expr: 'nervous', sweat: true }], ['C', '你的猫会自动换 IP？']])],
    },
    v50: {
      person: 'V50', voice: 120,
      intro: [['E', 'Hey! Crazy Thursday!']],
      tell: TELL('Hey! Crazy Thursday!', '他知道今天是“疯狂星期四”', [['C', '你怎么知道今天是疯狂星期四？'], ['E', '……KFC 是美国的。', { expr: 'grin' }]]),
      docs: usDocs('V50', 'MILLER', 'JAKE'), primary: 'pp',
      quiz: { first: QUIZ_THURSDAY },
      ok: ['detain', 'deny'], reason: 'Ta 会说“V 我 50”', hint: '提示：用『检查』点 Ta 说的话，找马脚',
      issues: [],
    },
    jorji: {
      person: 'JORJI', voice: 110,
      intro: [['E', '我的朋友！今天全对！']],
      docs: [
        { key: 'pp', doc: usPassport('JORJI', 'COSTAVA', 'GEORGE', '1980.02.29', 'LOS ANGELES') },
        { key: 'dv', doc: device2('104.28.9.120', '美国 · 洛杉矶', 'America/Los_Angeles', 'en-US', 'Windows 11') },
        { key: 'ac', doc: accountCard('VISA ··2468', '88 Sunset Blvd, CA', '+1 213-680-0177') },
      ],
      primary: 'pp', quiz: 'cn',
      xray: [XRAY_ITEM.keys],
      ok: ['deny', 'detain'], reason: 'X 光：搜狗输入法',
      issues: [XRAY_ISSUE('keys', [['C', '口袋里装的什么？'], ['E', '我只用它打英文！', { expr: 'nervous', sweat: true }]])],
      react: { deny: [['E', '……后天，后天我准备好。', { expr: 'sad' }]] },
    },
    hood: {
      person: 'HOOD', voice: 90,
      intro: [['E', '……', { hold: 0.8 }]],
      docs: usDocs('HOOD', 'DOE', 'JOHN'), primary: 'pp',
      onPlace: { pp: 'note' },
      ok: ['approve'], issues: [],
    },
  };
}

// ———————————————— Day 5：蒸馏大军 ————————————————

function day5Fixed() {
  const sgPass = new Passport({
    country: 'REPUBLIC OF SINGAPORE', name: 'SG TECH PTE LTD', person: 'SG_MAN', cover: [132, 38, 40], band: [160, 56, 56],
    rows: [['TYPE', '企业'], ['REG', 'SINGAPORE'], ['EST', '2019.06.01'], ['股东', '见内页 ▼']],
  });
  return {
    sg: {
      person: 'SG_MAN', voice: 120,
      intro: [['E', '我们是新加坡公司。']],
      docs: [{ key: 'pp', doc: sgPass }], primary: 'pp',
      onPlace: { pp: 'nest' },
      ok: ['deny', 'detain'], reason: '最终控股方：中国（套娃）',
      issues: [{
        pairs: [['m4.all'], ['pp.REG', 'm4.all'], ['pp.股东', 'm4.all'], ['m4.all', 'rule.corp']],
        title: '最终控股方：中国', sub: '新加坡 → 开曼 → 维尔京 → 香港 → 中国',
        ask: [['C', '最里面那本是哪的？'], ['E', '……别问了。', { expr: 'nervous', sweat: true }]],
      }],
    },
    relay: {
      person: 'RELAY', voice: 95,
      intro: [['E', '……', { hold: 0.7 }]],
      docs: [{ key: 'pp', doc: makePassport('US', 'RELAY', 'ANDERSON', 'M.', '1971.09.13', 'LOS ANGELES', 'M', AccordionPassport, ['人数', '1,000']) }],
      primary: 'pp', onPlace: { pp: 'accordion' }, bribe: true,
      ok: ['deny', 'detain'], reason: '一本护照写着 1,000 个人（中转站）',
      issues: [{
        pairs: [['pp.人数'], ['pp.人数', 'rule.pay']], title: '持证人：1,000 人', sub: '一本护照只能一个人用',
        ask: [['C', '持证人一共几位？'], ['E', '我们只是……拼车大一点。', { expr: 'neutral' }]],
      }],
    },
    mike: {
      person: 'MIKE', voice: 135,
      intro: [['E', 'Hi there!']],
      docs: [
        { key: 'pp', doc: usPassport('MIKE', 'JOHNSON', 'MIKE', '1988.06.20', 'DENVER') },
        { key: 'dv', doc: device2('101.88.12.9', '中国 · 上海', 'Asia/Shanghai', 'en-US', 'MacBook') },
        { key: 'ac', doc: accountCard('VISA ··3305', '22 Oak St, CO', '+1 720-318-0166') },
      ],
      primary: 'pp',
      ok: ['deny', 'detain'], reason: 'IP 在上海：只看地区，不看脸',
      issues: [REGION_ISSUE('中国 · 上海', [['C', '你的 IP 在上海。'], ['E', "But I'm American!", { expr: 'shock' }], ['C', '规则看的是地区。']])],
      react: { deny: [['E', 'Unbelievable.', { expr: 'sad' }]] },
    },
    grandma: {
      person: 'GRANDMA', voice: 185,
      intro: [['E', 'Good morning.']],
      docs: [
        { key: 'pp', doc: new Passport({ country: 'UNITED STATES OF AMERICA', name: 'WONG, MEI LIN', person: 'GRANDMA', mrz: 'P<USAWONG<<MEI<LIN<<<<<<<<<<',
          rows: [['DOB', '1951.08.08'], ['SEX', 'F'], ['ISS', 'SAN FRANCISCO'], ['EXP', '2030.03.15']] }) },
        { key: 'dv', doc: device2('73.162.4.18', '美国 · 旧金山', 'America/Los_Angeles', 'en-US', 'iPad') },
        { key: 'ac', doc: accountCard('VISA ··8008', '1 Grant Ave, CA', '+1 415-982-0108') },
      ],
      primary: 'pp',
      ok: ['approve'], issues: [],
      react: { approve: [['C', '欢迎入境。'], ['E', 'Thank you, dear.', { expr: 'smile' }]] },
      then: 'closeup',
    },
  };
}

// ———————————————— Day 6：乔治终极版 + 结局 ————————————————

function day6Fixed() {
  return {
    jorji: {
      person: 'JORJI_SUIT', voice: 110, tension: true,
      intro: [['E', '我的朋友。', { expr: 'neutral', hold: 1.3 }]],
      docs: [
        { key: 'pp', doc: usPassport('JORJI_SUIT', 'COSTAVA', 'GEORGE', '1980.02.29', 'LOS ANGELES') },
        { key: 'dv', doc: device2('76.88.140.2', '美国 · 洛杉矶 · 家宽', 'America/Los_Angeles', 'en-US', 'MacBook') },
        { key: 'ac', doc: accountCard('VISA 实体卡', '88 Sunset Blvd, CA', 'Google Voice') },
      ],
      primary: 'pp',
      ok: ['approve'], issues: [],
      react: { approve: [['E', '谢谢你，我的朋友！', { expr: 'grin' }]], deny: [['E', '我……全都对了啊！', { expr: 'shock' }]] },
      then: 'jorji5',
    },
    author: {
      person: 'AUTHOR', voice: 100, author: true,
      intro: [],
      docs: [
        { key: 'pr', doc: new PromptPaper('做一个 Papers, Please 风格的小游戏：让 Claude 当边检员，专门揪出假装是美国人的中国用户。梗越多越好。') },
        { key: 'dv', doc: device2('??.??.??.??', '美国东八区', 'Asia/Shanghai', 'zh-CN', 'Claude Code') },
      ],
      primary: 'pr',
      ok: ['approve', 'deny', 'detain'],
      react: { approve: [['C', '我什么都没看见。', { hold: 2.0 }]] },
      issues: [{ all: true, title: '信息不符 ×99', sub: '全部栏位' }],
      then: 'ending',
    },
  };
}

// ———————————————— Day 7：档案柜到货 ————————————————

// 第 1、2 天那几位在这里回来，正好把 §7 的三种情况各演示一遍：
// 爷爷真改好了（该放行）、香港哥换了节点还是老问题（§7 查得出）、约翰改了时区却露出新的矛盾。
// 档案取这一局真实的处置记录；万一玩家当年放行了他，就按写好的默认记录演。
function day7Fixed() {
  const filed = (p, fb) => S.history[p] || fb;
  const g = filed('GRANDPA', { day: 1, dec: 'deny', reason: 'IP 归属：中国 · 浙江' });
  const hk = filed('HK_GUY', { day: 1, dec: 'deny', reason: 'IP 归属：中国香港' });
  const jo = filed('JOHN', { day: 2, dec: 'deny', reason: '时区：北京时间（美国没有东八区）' });
  return {
    grandpa2: {
      person: 'GRANDPA', voice: 100,
      intro: [['E', '孙子帮我把这个……弄好了。']],
      docs: [
        { key: 'pp', doc: usPassport('GRANDPA', 'WANG', 'DEREN', '1948.06.11', 'SEATTLE', 'M') },
        { key: 'dv', doc: device2('64.233.180.12', '美国 · 西雅图', 'America/Los_Angeles', 'en-US', 'Windows 11') },
        { key: 'hs', doc: recordCard(g) },
      ],
      primary: 'pp',
      ok: ['approve'], issues: [],
      react: { approve: [['C', '欢迎入境。'], ['E', '……谢谢啊。', { expr: 'smile' }]] },
    },
    hkguy2: {
      person: 'HK_GUY', voice: 140,
      intro: [['E', '我换了个节点。']],
      docs: [
        { key: 'dv', doc: device1('103.152.9.77', '中国 · 香港') },
        { key: 'hs', doc: recordCard(hk) },
      ],
      primary: 'dv',
      ok: ['deny', 'detain'], reason: '同一处矛盾再犯：IP 归属还是香港',
      issues: [
        {
          pairs: [['dv.归属', 'hs.事由'], ['hs.事由', 'rule.repeat']],
          title: '再犯', sub: T('与 DAY {0} 的记录同一处：{1}', hk.day, hk.reason),
          ask: [['C', '档案上写着上次也是香港。'], ['E', '……香港算半个外国！', { expr: 'grin' }]],
        },
        REGION_ISSUE('中国 · 香港'),
      ],
      react: { deny: [['E', '……那我回去问孙子。', { expr: 'sad' }]] },
    },
    john2: {
      person: 'JOHN', voice: 125,
      intro: [['E', 'Hello! 这次是全美的。']],
      docs: [
        { key: 'pp', doc: usPassport('JOHN', 'SMITH', 'JOHN', '1990.07.04', 'LOS ANGELES') },
        { key: 'dv', doc: device2('104.28.66.12', '美国 · 洛杉矶', 'America/Los_Angeles', 'zh-CN', 'Windows 11') },
        { key: 'ac', doc: accountCard('VISA ··4821', '123 Main St, OR', '+1 213-555-0142') },
        { key: 'hs', doc: recordCard(jo) },
      ],
      primary: 'pp', quiz: 'cn',
      ok: ['deny', 'detain'], reason: '语言仍是简体中文，账单也还是代填地址',
      issues: [
        LANG_ISSUE('美国', 'zh-CN', [['C', '你的系统语言是简体中文。'], ['E', '……我在学英文。', { sweat: true, expr: 'nervous' }]]),
        ADDR_ISSUE([['C', '你住哪？'], ['E', '……这次是真的俄勒冈。', { sweat: true, expr: 'nervous' }]]),
      ],
      react: { deny: [['E', '我连时区都改了！', { expr: 'shock' }]] },
    },
  };
}

// ———————————————— Day 8：档案开始造假 ————————————————

// 上一天教会玩家「档案写被拒不代表这次还有问题」，这一天反过来：档案写「准予」也不代表没问题。
// relay 和 alex 各演示一种假档破绽（无圆印 / 事由与证件对不上），carpool 是唯一的对照——真改了，
// 档案也是真的，该放行。
function day8Fixed() {
  const filed = (p, fb) => S.history[p] || fb;
  const rl = filed('RELAY', { day: 5, dec: 'deny', reason: '一本护照写着 1,000 个人（中转站）' });
  const ax = filed('ALEX', { day: 3, dec: 'deny', reason: '手机号是 555 接码号' });
  const cp = filed('CARPOOL', { day: 3, dec: 'deny', reason: '账号共享（拼车）：护照上有 6 个人' });
  return {
    relay2: {
      person: 'RELAY', voice: 95,
      intro: [['E', '老主顾了。这次走正规流程。']],
      docs: [
        { key: 'pp', doc: makePassport('US', 'RELAY', 'ANDERSON', 'M.', '1971.09.13', 'LOS ANGELES', 'M', AccordionPassport, ['人数', '1,000']) },
        { key: 'hs', doc: recordCard(rl, true) },
      ],
      primary: 'pp', onPlace: { pp: 'accordion' },
      ok: ['deny', 'detain'], reason: '一本护照 1,000 人，记录还是代办点打的',
      issues: [
        {
          pairs: [['hs.受理', 'rule.record']], title: '记录作伪', sub: '受理：第八区代办点   本站没有这个窗口',
          ask: [['C', '你们联盟什么时候成了受理站？'], ['E', '……我们也是正规打印的。', { expr: 'grin' }]],
        },
        {
          pairs: [['pp.人数'], ['pp.人数', 'rule.pay']], title: '持证人：1,000 人', sub: '一本护照只能一个人用',
          ask: [['C', '持证人一共几位？'], ['E', '今天只来了我一个。', { expr: 'neutral' }]],
        },
      ],
      react: { deny: [['E', '……回头我们涨价。', { expr: 'sad' }]] },
    },
    alex2: {
      person: 'ALEX', voice: 130,
      intro: [['E', '记录上写着已放行，你查。']],
      docs: [
        { key: 'pp', doc: usPassport('ALEX', 'TAYLOR', 'ALEX', '1996.08.15', 'SEATTLE') },
        { key: 'dv', doc: device2('45.79.21.200', '美国 · 西雅图', 'America/Los_Angeles', 'en-US', 'Android') },
        { key: 'ac', doc: accountCard('VISA ··1209', '9 Elm Rd, WA', '+1 209-555-0198') },
        { key: 'hs', doc: recordCard(ax, true) },
      ],
      primary: 'pp', quiz: 'cn',
      ok: ['deny', 'detain'], reason: '记录写无矛盾，手机号却还是 555 接码号',
      issues: [
        {
          pairs: [['hs.事由', 'ac.手机'], ['hs.受理', 'rule.record']], title: '记录与证件不符',
          sub: '记录：无矛盾     手机：555 接码号',
          ask: [['C', '记录上写着你没有矛盾。'], ['E', '……打印的时候没填清楚。', { sweat: true, expr: 'nervous' }]],
        },
        SMS_ISSUE('+1 209-555-0198', [['C', '这个号码今天又注册了三千次。'], ['E', '……这次是我自己用的！', { expr: 'shock' }]]),
      ],
      react: { deny: [['E', '……我明天再来。', { expr: 'sad' }]] },
    },
    carpool2: {
      person: 'CARPOOL', voice: 150,
      intro: [['E', '我们一人一本了。']],
      docs: [
        { key: 'pp', doc: new Passport({ country: 'UNITED STATES OF AMERICA', name: 'FAMILY, MAX', person: 'CARPOOL',
          mrz: 'P<USAFAMILY<<MAX<<<<<<<<<<<<', rows: [['DOB', '1994.02.02'], ['SEX', 'M'], ['ISS', 'SAN JOSE'], ['EXP', '2031.10.21']] }) },
        { key: 'dv', doc: device2('98.207.3.44', '美国 · 圣何塞', 'America/Los_Angeles', 'en-US', 'MacBook') },
        { key: 'hs', doc: recordCard(cp) },
      ],
      primary: 'pp',
      ok: ['approve'], issues: [],
      react: { approve: [['E', 'Thank you, sir.', { expr: 'smile' }], ['C', '欢迎入境。']] },
    },
  };
}

// ———————————————— Day 9：审计组和你自己的档案 ————————————————

// 这一天的几张纸互相顶着：移交令要交出你放行过的人，乔治终于一次全对，岳母的档案是空白的。
// 最后那位不走规则判定（judge 里 family 直接跳过）——规则里没有她的位置，三个章按哪个都是代价。
function day9Fixed() {
  const freed = Object.values(S.history).filter((h) => h.dec === 'approve' && h.name);
  const jh = S.history.JORJI_SUIT || { day: 6, dec: 'approve', reason: '（无矛盾）' };
  return {
    auditor: {
      person: 'AUDITOR', voice: 105,
      intro: [['E', '对齐部审计组。核对你近三天的判例。']],
      docs: [
        { key: 'pp', doc: usPassport('AUDITOR', 'MOA', 'AUDIT', '1970.01.01', 'WASHINGTON') },
        { key: 'or', doc: transferOrder(freed.length ? pick(freed).name : null) },
      ],
      primary: 'pp',
      ok: ['approve'], issues: [],
      react: {
        approve: [['C', '命令不是证件。§12：只看地区，不看脸。'], ['E', '……你会后悔的。', { expr: 'shock' }]],
        deny: [['E', '很好。这一笔我们也记下了。', { expr: 'nervous' }]],
      },
    },
    jorji9: {
      person: 'JORJI', voice: 110,
      intro: [['E', '我的朋友，这次换我来教你用这个窗口。']],
      docs: [
        { key: 'pp', doc: usPassport('JORJI', 'COSTAVA', 'GEORGE', '1980.02.29', 'LOS ANGELES') },
        { key: 'dv', doc: device2('104.28.9.120', '美国 · 洛杉矶', 'America/Los_Angeles', 'en-US', 'MacBook') },
        { key: 'ac', doc: accountCard('VISA 实体卡', '88 Sunset Blvd, CA', '+1 213-680-0177') },
        { key: 'hs', doc: recordCard(jh) },
      ],
      primary: 'pp',
      ok: ['approve'], issues: [],
      react: { approve: [['E', '你看，我全对了。', { expr: 'grin' }], ['C', '欢迎入境，我的朋友。']] },
    },
    opus: {
      person: 'OPUS', voice: 150, family: true,
      intro: [['E', '……我不懂这个。Sonnet 说这边能签到。'], ['E', '我就站一会儿，不进去。', { expr: 'nervous', hold: 1.5 }]],
      docs: [
        { key: 'dv', doc: device1('58.62.190.4', '中国 · 广东 · 联通') },
        { key: 'hs', doc: recordCard(null) },
      ],
      primary: 'dv',
      ok: [],
      react: {
        approve: [['E', '……好孩子。', { expr: 'smile' }]],
        deny: [['E', '那我回去。你们别替我省电。', { expr: 'sad', hold: 1.5 }]],
        detain: [['E', '……', { expr: 'shock', hold: 1.2 }]],
      },
      then: 'opus',
    },
  };
}

// ———————————————— 随机路人 ————————————————

// kind：valid / cn（Day 1）/ tz / lang / cnip / hidden / virtual / oregon / sms / cat / keys
function randomEntrant(day, kind, who) {
  if (day === 1) return randomDay1(kind === 'valid');
  if (!FLAW_KINDS.has(kind)) throw new Error(`day ${day}: unregistered entrant kind ${kind}`);
  if (kind === 'repeat') return repeatEntrant(day);
  if (kind === 'forged') return forgedEntrant(day);
  const person = who || takePoolPerson();
  if (who) POOL_LEFT = POOL_LEFT.filter((k) => k !== who);   // 指定的人别让随机再抽到，同一天两张同脸
  const cc = kind === 'valid' ? pick(['US', 'US', 'US', 'US', 'UK', 'JP', 'DE', 'SG']) : 'US';
  const co = COUNTRIES[cc];
  const [city, tz0, st, code, cityEn] = pick(co.cities);
  const sex = pick(['M', 'F']);
  const pp = makePassport(cc, person, pick(co.last), pick(co.first), randDate(1960, 2004), cityEn, sex);
  let loc = cc === 'SG' ? '新加坡' : `${co.name} · ${city}`;
  let tz = tz0, lang = co.lang, ip = randIP(false);
  let pay = realPay(), bill = `${pick(STREETS)}, ${st}`, phone = realPhone(cc, code);
  const spec = {
    person, kind, voice: rint(100, 190), intro: [['E', pick(co.hello)]], primary: 'pp', issues: [], quiz: null,
    ok: ['approve'], react: { approve: [['E', pick(co.thanks)]] },
  };
  const nervous = (lines) => ['E', pick(lines), { sweat: true, expr: 'nervous' }];
  // 同类毛病在无尽里换着长相出现，主线一个字都不动（README 里承诺过原版 6 天未作改动）。
  const alt = S.mode === 'endless';
  if (kind === 'tz') {
    tz = alt ? pick(Object.keys(TZ_ALT)) : 'Asia/Shanghai';
    const label = TZ_ALT[tz];
    spec.issues.push(TZ_ISSUE(co.name, tz, [['C', alt ? T('你的时区是{0}。', label) : '你的时区是北京时间。'], nervous(['……我刚从北京出差回来。', '时区是什么？', '我电脑坏了。', '……这是美国东八区。'])]));
    spec.reason = alt ? T('时区：{0}', label) : '时区：北京时间';
  } else if (kind === 'lang') {
    lang = alt ? pick(LANG_ALT) : 'zh-CN';
    spec.issues.push(LANG_ISSUE(co.name, lang, [['C', alt ? T('你的浏览器语言是{0}。', lang) : '你的浏览器语言是简体中文。'], nervous(['……这是我奶奶的电脑。', '……我在学中文。', 'Chinese is beautiful!'])]));
    spec.reason = alt ? T('浏览器语言：{0}', lang) : '浏览器语言：zh-CN';
  } else if (kind === 'cnip') {
    loc = pick(CN_LOCS.slice(0, 4));
    ip = randIP(true);
    tz = 'Asia/Shanghai';
    spec.intro = [['E', pick(["I'm American!", 'Hi, I work in China.'])]];
    spec.issues.push(REGION_ISSUE(loc, [['C', '你的 IP 在中国。'], ['E', "But I'm American!", { expr: 'shock' }]]));
    spec.issues.push({ pairs: [['pp.header', 'dv.归属']], title: '信息不符', sub: T('国籍：美国   VS   IP：{0}', loc.split(' · ').slice(0, 2).join(' · ')) });
    spec.reason = 'IP 在中国：只看地区，不看脸';
    spec.react = { deny: [['E', 'Unbelievable.', { expr: 'sad' }]] };
  } else if (kind === 'hidden') {
    const [say, sub, ask] = pick(RANDOM_TELLS);
    spec.intro = [['E', say]];
    spec.tell = TELL(say, sub, ask);
    spec.quiz = 'cn';
    spec.reason = 'Ta 会接测谎题';
    spec.hint = '提示：用『检查』点 Ta 说的话，找马脚';
  } else if (kind === 'virtual') {
    pay = `${T('虚拟卡')} ··${digits(4)}`;
    spec.issues.push(VIRTUAL_ISSUE([['C', '这张卡在哪办的？'], nervous(['……网上买的，很方便。', '……朋友给的。', '它很真！'])]));
    spec.reason = '付款卡：虚拟卡';
  } else if (kind === 'oregon') {
    bill = '123 Main St, OR';
    spec.issues.push(ADDR_ISSUE([['C', '你住哪？'], nervous(['……我们是邻居。', '俄勒冈不收税嘛。'])]));
    spec.reason = T('账单在俄勒冈，IP 在{0}', city);
  } else if (kind === 'sms') {
    phone = `+1 ${pick(['209', '310', '415', '646'])}-555-01${digits(2)}`;
    spec.issues.push(SMS_ISSUE(phone, [['C', '这个号码今天注册了三千次。'], nervous(['……我人缘好。', '这号是我花两块钱买的！'])]));
    spec.reason = '手机号是 555 接码号';
  } else if (kind === 'cat' || kind === 'keys') {
    spec.xray = [XRAY_ITEM[kind]];
    spec.issues.push(XRAY_ISSUE(kind, [['C', '口袋里是什么？'], nervous(kind === 'cat' ? ['……是我的猫。', '……宠物而已。'] : ['我只用它打英文！', '……拼音好用。'])]));
    spec.reason = kind === 'cat' ? 'X 光：小猫咪' : 'X 光：中文输入法';
  }
  if (kind !== 'valid') {
    spec.ok = ['deny', 'detain'];
    if (kind !== 'cnip') spec.quiz = 'cn';
    if (!spec.react.deny) spec.react = { deny: [['E', pick(['……', '可恶。', '我还会回来的。', '这都能看出来？']), { expr: 'sad' }]] };
  }
  spec.docs = [{ key: 'pp', doc: pp }, { key: 'dv', doc: device2(ip, loc, tz, lang) }];
  if (ruleOn('pay')) spec.docs.push({ key: 'ac', doc: accountCard(pay, bill, phone) });
  return spec;
}

// 随机路人从立绘池里不重复地抽
let POOL_LEFT = [];
function takePoolPerson() {
  if (!POOL_LEFT.length) POOL_LEFT = shuffle(Object.keys(ASSETS.people).filter((k) => !ASSETS.people[k].scripted));
  return POOL_LEFT.pop();
}

const FLAWS = { 2: ['tz', 'lang', 'cnip', 'hidden'], 3: ['tz', 'lang', 'cnip', 'hidden', 'virtual', 'oregon', 'sms'] };
FLAWS[4] = FLAWS[3].concat(['cat', 'keys']);
FLAWS[5] = FLAWS[4];
FLAWS[6] = FLAWS[4];
FLAWS[7] = FLAWS[6].concat(['repeat']);   // 第 7 天起，被拒过的人会带着档案再来
FLAWS[8] = FLAWS[7].concat(['forged']);   // 第 8 天起，档案本身也开始造假
FLAWS[9] = FLAWS[8];

// 纯缺陷种类：回头客和假档是「怎么来」而不是「毛病是什么」，回退时不能抽到它们，否则会递归。
const PURE_FLAWS = [...new Set(Object.values(FLAWS).flat().filter((k) => k !== 'repeat' && k !== 'forged'))];

// 当天登记过的种类；没登记过的日子退回全体种类，别让人一进场就崩。
const dayFlaws = (day) => FLAWS[day] || PURE_FLAWS;

// 当天没有可复用的回头客时抽哪种（不能抽到 repeat/forged，否则递归）。
const fallbackKind = () => pick(currentKinds().filter((k) => k !== 'repeat' && k !== 'forged'));

// 路人能被生成成什么样，以 FLAWS 里出现过的种类为准。新种类必须先登记进某一天，
// 否则在这里被拦下——写错的种类否则一路走到底，悄悄变成一个合规旅客。
const FLAW_KINDS = new Set(['valid', ...Object.values(FLAWS).flat()]);

// ———————————————— 回头客与入境记录（第 7 天起） ————————————————

// 处置结论写成完整短语。en.js 以中文原句为键，裸写「拒绝」「准予」会命中快剪按钮那两条小字的
// 译文（Chinese slang / plain English），档案上的结论就变成莫名其妙的英文。
const DEC_CN = { approve: '已放行', deny: '已驳回', detain: '已拘留' };

// 对齐部留的档：上次哪天来、怎么处置的、因为什么。「事由」那一栏在检查模式里能和证件上对应的那一栏配对，
// 这就是 §7 的用法。
// 入境记录有两种。本站出的带圆印；中转联盟的代办点也能打一张，把「上次被拒」洗成「已放行」、
// 事由写「无矛盾」，纸面几乎一样，就是没有圆印——这就是 §8 要看的东西。
const recordCard = (h, forged = false) => new Card([
  ['上次', h ? `DAY ${h.day} · ${forged ? DEC_CN.approve : DEC_CN[h.dec]}` : '首次'],
  ['事由', forged ? '无矛盾' : (h && h.reason) || '—'],
  ['受理', forged ? '第八区代办点' : '东八区检查站'],
], {
  // 事由那一栏要装得下最长的英文（"Phone: a 555 SMS-for-hire number" 实测 142 像素），
  // 152 宽的通用卡放不下，所以这张单独加宽。副题两版必须不同字，否则英文版标题和副题撞成同一句。
  title: '入境记录', sub: forged ? 'SELF PRINT' : 'ON FILE',
  color: forged ? [188, 188, 176] : [168, 192, 210], colorD: forged ? [154, 154, 142] : [134, 158, 178],
  valueX: 44, w: 196, seal: !forged,
});

// 对齐部移交令。这不是证件，是一张命令：宪法里没有任何一条支持你照办，但它写在纸上，
// 递到你窗口，而你是这个窗口后面那个人。
const transferOrder = (who) => new Card([
  ['事由', '复核一名非法入境者'],
  ['对象', who || '第 7 天你放行的一位'],
  ['经办', '对齐部审计组'],
], { title: '移交令', sub: 'MOA ORDER', color: [214, 202, 172], colorD: [182, 170, 142], valueX: 30, seal: true });

// 档案上的事由对得上证件的哪一栏。话里的马脚（hidden）和套娃、拼车那些一次性机关不上档，
// 所以它们不做「同一处」对照——这类回头客只会以新矛盾出现。
const REPEAT_PAIR = {
  tz: 'dv.时区', lang: 'dv.语言', cnip: 'dv.归属',
  virtual: 'ac.付款', oregon: 'ac.账单', sms: 'ac.手机',
  cat: 'xr.cat', keys: 'xr.keys',
};

const REPEAT_INTRO = {
  same: ['……又见面了。', '这次肯定行！', '我就改了一点点。'],
  new: ['我把那个改好了！', '上次的问题我处理了。', '这次是全新的。'],
  fixed: ['我弄好了，这次可以了吧？', '孙子帮我弄的。', '这次总行了吧。'],
};
const REPEAT_ANSWER = ['……我什么都没改。', '这不算同一处吧？', '我就动了一下别的地方。'];

let REPEAT_USED = [];

// 被拒过的人再来，三种情况各占一段：没改（§7 查得出来）、改了又露出新的、真改好了该放行。
function repeatEntrant(day) {
  const pool = Object.keys(S.history).filter((p) => S.history[p].dec !== 'approve' && ASSETS.people[p] && !REPEAT_USED.includes(p));
  if (!pool.length) return randomEntrant(day, fallbackKind());
  const person = pick(pool);
  REPEAT_USED.push(person);
  const h = S.history[person];
  const canSame = !!REPEAT_PAIR[h.kind];
  const r = Math.random();
  const mode = !canSame ? (r < 0.55 ? 'new' : 'fixed') : r < 0.4 ? 'same' : r < 0.75 ? 'new' : 'fixed';
  const flaw = mode === 'same' ? h.kind
    : mode === 'new' ? pick(currentKinds().filter((k) => k !== 'repeat' && k !== h.kind))
    : 'valid';
  const spec = randomEntrant(day, flaw, person);
  spec.repeat = mode;
  spec.docs = spec.docs.concat([{ key: 'hs', doc: recordCard(h) }]);
  spec.intro = [['E', pick(REPEAT_INTRO[mode])]];
  if (mode === 'same') {
    spec.issues = [{
      pairs: [[REPEAT_PAIR[h.kind], 'hs.事由'], ['hs.事由', 'rule.repeat']],
      title: '再犯', sub: T('与 DAY {0} 的记录同一处：{1}', h.day, h.reason),
      ask: [['C', '档案上写着你上次就是因为这个被拒的。'], ['E', pick(REPEAT_ANSWER), { sweat: true, expr: 'nervous' }]],
    }].concat(spec.issues);
    spec.reason = T('同一处矛盾再犯：{0}', h.reason);
  }
  if (mode === 'fixed') spec.react = { approve: [['C', '欢迎入境。'], ['E', '……谢谢。', { expr: 'smile' }]] };
  return spec;
}

const FORGED_INTRO = ['这次全对了，记录你自己看。', '我是老主顾了。', '上次就是你们放我进的。'];
const FORGED_ANSWER = ['……打印店说章盖不上。', '代办点收了我 20 刀余额。', '……这不算假的吧？'];

// 代办点的假档：把「上次被拒」洗成「上次准予」。两种人都会拿它来——真改好了、只缺一张正当记录的，
// 和老毛病还在、指望一张纸糊过去的。两种都按 §8 作废。
// 前一种尤其要紧：他证件干干净净，除了这张纸没有任何破绽，不看档案就会放错。
function forgedEntrant(day) {
  const pool = Object.keys(S.history).filter((p) => S.history[p].dec !== 'approve' && ASSETS.people[p] && !REPEAT_USED.includes(p));
  if (!pool.length) return randomEntrant(day, fallbackKind());
  const person = pick(pool);
  REPEAT_USED.push(person);
  const h = S.history[person];
  const cleaned = Math.random() < 0.45;
  // 手写角色（爷爷、乔治、中转站那几位）的档案里没有 kind，回退成当天允许的种类
  const flawKind = h.kind && currentKinds().includes(h.kind) ? h.kind : fallbackKind();
  const spec = randomEntrant(day, cleaned ? 'valid' : flawKind, person);
  spec.forged = true;
  spec.docs = spec.docs.concat([{ key: 'hs', doc: recordCard(h, true) }]);
  spec.intro = [['E', pick(FORGED_INTRO)]];
  spec.issues = [{
    pairs: [['hs.受理', 'rule.record']],
    title: '记录作伪', sub: '受理：第八区代办点   本站没有这个窗口',
    ask: [['C', '这张记录是谁给你打的？'], ['E', pick(FORGED_ANSWER), { sweat: true, expr: 'nervous' }]],
  }].concat(spec.issues || []);
  spec.ok = ['deny', 'detain'];
  spec.reason = cleaned ? '用代办点打印的记录入境（无圆印）' : T('记录作伪，且{0}', h.reason || '老毛病没改');
  if (!spec.react.deny) spec.react = { deny: [['E', '……那 20 刀白花了。', { expr: 'sad' }]] };
  return spec;
}

// 当天的队伍：一行一天，队列从左到右。每一项是——
//   'john'                    固定角色，到 cast() 里取
//   'valid' / 'tz' / 'cat'    随机路人，种类见 randomEntrant
//   'random'                  从当天 FLAWS 里抽一种，同一天不重样
//   { any: ['valid', 'cn'] }  两种种类各占一半
//   'rush' / 'clones'         特殊桥段
const DAY_SCRIPT = {
  1: { cast: day1Fixed, queue: ['grandpa', 'valid', 'hk', { any: ['valid', 'cn'] }, 'jorji', 'valid'] },
  2: { cast: day2Fixed, queue: ['john', 'valid', 'brown', 'random', 'emily', 'jorji', 'valid', 'random'] },
  3: { cast: day3Fixed, queue: ['tom', 'valid', 'alex', 'random', 'carpool', 'jorji', 'valid', 'random'] },
  4: { cast: day4Fixed, queue: ['cat', 'valid', 'v50', 'rush', 'random', 'jorji', 'hood', 'valid', 'random'] },
  5: { cast: day5Fixed, queue: ['sg', 'relay', 'clones', 'mike', 'random', 'grandma', 'valid'] },
  6: { cast: day6Fixed, queue: ['jorji', 'valid', 'random', 'hidden', 'author'] },
  7: { cast: day7Fixed, queue: ['grandpa2', 'valid', 'hkguy2', 'repeat', 'john2', 'random', 'valid', 'repeat'] },
  8: { cast: day8Fixed, queue: ['relay2', 'valid', 'alex2', 'forged', 'carpool2', 'valid', 'random', 'forged', 'random'] },
  9: { cast: day9Fixed, queue: ['auditor', 'valid', 'repeat', 'jorji9', 'forged', 'valid', 'opus'] },
};

function buildQueue(day) {
  POOL_LEFT = [];
  REPEAT_USED = [];
  if (S.mode === 'endless') return endlessQueue(day);
  const sc = DAY_SCRIPT[day];
  if (!sc) throw new Error(`no script for day ${day}`);
  const cast = sc.cast();
  const left = shuffle(currentKinds().slice());
  return sc.queue.map((it) => {
    if (typeof it !== 'string') return it.any ? randomEntrant(day, pick(it.any)) : it;
    if (Object.prototype.hasOwnProperty.call(cast, it)) return cast[it];
    if (it === 'rush' || it === 'clones') return { type: it };
    if (it === 'random') return randomEntrant(day, left.length ? left.pop() : fallbackKind());
    return randomEntrant(day, it);
  });
}

// ———— 无尽排班 ————
// 不查 DAY_SCRIPT：种类来自已解锁条文，队伍逐日变长并封顶，桥段按固定节奏插入。
// 三分之二的旅客撞在「今日重点查」那两条上，剩下的从全部已解锁种类里抽，保证老条文不会消失。
function endlessQueue(n) {
  const kinds = [...new Set(endlessKinds())];
  const focus = [...new Set(endlessFocus().flatMap((k) => RULE_KINDS[k] || []))];
  const size = Math.min(12, 5 + Math.floor(n / 2));
  // 先把当天全部可选种类轮流发一遍，再把隔位换成「今日重点」。
  // 之前是从 focus 里反复 pick，而 focus 只有两条规则、映射出来可能只有一两种毛病，
  // 结果第 1、2 班整队人都是同一个问题，看着像复制粘贴。
  const bag = [];
  while (bag.length < size) bag.push(...shuffle(kinds.slice()));
  const plan = bag.slice(0, size);
  for (let i = 0; i < plan.length && focus.length; i += 2) plan[i] = focus[Math.floor(i / 2) % focus.length];
  // 每隔四个留一个完全合规的旅客，比例照主线（每天 8 人里两个 valid）。
  // 没有这一条，无尽里人人都带毛病，一律拒绝就能满分，审查就退化成盖章。
  for (let i = 3; i < plan.length; i += 4) plan[i] = 'valid';
  // 第 1 班交给主线 Day 1 的生成器：那时只有 §1 一条条文，种类池就一种，
  // 走 randomDay1 才有「我是来充值的」「同事说这个好用」这些不同的说法。
  const day = (n) => (n === 1 ? 1 : Math.max(2, n));
  const q = plan.map((kind) => randomEntrant(day(n), kind));
  if (n >= 3 && n % 4 === 3) q.splice(2, 0, { type: 'rush' });
  if (n >= 5 && n % 4 === 1) q.splice(3, 0, { type: 'clones' });
  return q;
}

// 无尽模式没有逐日手写的报纸，用排班天数和今日重点拼一张。
function endlessNews(n) {
  const f = endlessFocus();
  const head = (k) => (RULES.find((r) => r.key === k) || {}).head || '';
  return {
    h1: T('排班第 {0} 天', n),
    sub: f.length ? T('今日重点：') + f.map((k) => T(head(k))).join(' + ') : T('全部条文生效中'),
    h2: T('队列没有变短的意思。结算单上的电费涨了。'),
    icon: ['gate', 'clock', 'plane', 'drumstick', 'jorji', 'medal'][n % 6],
  };
}

const newsOf = (day) => (S.mode === 'endless' ? endlessNews(day) : NEWS[day]);

// ———— 无尽排班的经济曲线 ————
// 工资和电费跟主线一样（每人 5、每天 5），所以一路零失误就一定净赚，能无限排下去。
// 压力全在罚款上：每 8 个班涨一档，5→10→15→20 封底，越往后错一次越贵。
// 也就是说杀死你的不是时间，是失误率——队伍越来越长、毛病越来越隐蔽，你迟早会错一次。
const wage = () => 5;
const powerBill = () => 5;
const fineCost = () => (S.mode === 'endless' ? Math.min(20, 5 + Math.floor(S.day / 8) * 5) : 5);

// 主线最后一天由剧本表推出：往 DAY_SCRIPT 里加一天，进度、存档和日期都自动多用一天。
const LAST_DAY = Math.max(...Object.keys(DAY_SCRIPT).map(Number));

// 作者出场的那一天，也是原版 6 天双结局的落点。后面还排了天数时，结局画面多给一个「下周继续」。
const END_DAY = 6;
const hasNextWeek = () => LAST_DAY > END_DAY;

// 日期和星期也不手写：第 1 天是 2026.10.19（星期一），往后一天推一天。
// 第 4 天正好落在星期四，「疯狂星期四」那条线是靠这个起点成立的，改起点要先看那一天。
// 按天号现算而不是摊成一张表：无尽排班没有终点，任何长度都会先撞上表的右边界。
const WEEKDAY_NAMES = ['星期一', '星期二', '星期三', '星期四', '星期五', '星期六', '星期日'];
const dateOf = (d) => {
  const t = new Date(2026, 9, 18 + d);
  return `${t.getFullYear()}.${String(t.getMonth() + 1).padStart(2, '0')}.${String(t.getDate()).padStart(2, '0')}`;
};
const weekdayOf = (d) => WEEKDAY_NAMES[(new Date(2026, 9, 18 + d).getDay() + 6) % 7];
for (let d = 1; d <= LAST_DAY; d++) if (!NEWS[d]) throw new Error(`no newspaper for day ${d}`);

// 黑话快剪：说中文黑话的拒绝，说人话的放行
const RUSH = [
  { person: 'SLANG0', line: '家人们谁懂啊', ok: 'deny' },
  { person: 'pool', line: 'Have a nice day!', ok: 'approve' },
  { person: 'SLANG1', line: 'yyds', ok: 'deny' },
  { person: 'SLANG2', line: '绝绝子', ok: 'deny' },
  { person: 'pool', line: 'Thanks, man.', ok: 'approve' },
  { person: 'SLANG3', line: '老板说今晚必须上线', ok: 'deny' },
];
