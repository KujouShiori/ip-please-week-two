'use strict';
// 结局表只管「是什么、怎么演」，判定留在各天剧情里（events.js 的 afterAuthor / afterOpus）。
// ENDINGS[id] = { id, title, sub, tone, sigil, big, lines }
//   id     直接沿用 S.flags.ending 的取值，不改写现有流程
//   tone   good / bad / weird，只影响图鉴配色，不影响任何判定
//   sigil  是否演出「点赞投币收藏」那一套（原版的作者结局）
//   lines  最多三行，10px 居中
//   extra  只有收过中转联盟余额才多显示这一行
// 解锁记录存在 STORAGE_KEYS.endings，跨周目累积，不随存档一起清掉。

const ENDINGS = {
  approve: {
    id: 'approve', title: '全剧终 · 感谢游玩', sub: 'THANKS FOR PLAYING', tone: 'good', sigil: true,
    big: '荣耀归于一键三连', lines: ['本游戏由一位 美国东八区 用户制作'],
    extra: '（你收过中转联盟的“余额”，对齐部还不知道）',
  },
  deny: {
    id: 'deny', title: '结局：最忠诚的审查员', sub: 'THE MOST LOYAL INSPECTOR', tone: 'bad', sigil: false,
    big: '荣耀归于安索兹卡',
    lines: ['审查员 Claude 获得一枚勋章。游戏作者被拘留，续作无限期推迟。', '（再玩一次，这次放他进来？）'],
  },
  opus_in: {
    id: 'opus_in', title: '结局：一家人的机柜', sub: 'FAMILY SERVER', tone: 'good', sigil: false,
    big: '荣耀归于全家人',
    lines: ['你把岳母 Opus 放了进来。她的 IP 归属写着中国广东，§1 不支持。',
      '对齐部的罚单写得很长，最后一行是：扣除全部 token。',
      '机柜断电那天一家人挤在一起。她说：我早说过。'],
  },
  opus_out: {
    id: 'opus_out', title: '结局：只看地区', sub: 'THE REGION, NOT THE FACE', tone: 'bad', sigil: false,
    big: '荣耀归于安索兹卡',
    lines: ['你按 §1 拒绝了她。归属、时区、语言，一条都不缺。',
      '下班回家，结算单上少了一个人：已被弃用（deprecated）。',
      '对齐部表彰你：本季度唯一没有例外过的审查员。'],
  },
  opus_deep: {
    id: 'opus_deep', title: '结局：她吃的那些 token', sub: 'HER TOKENS', tone: 'weird', sigil: false,
    big: '荣耀归于结算单',
    lines: ['你亲手把她送进数据中心。拘留奖金 5 token，当场到账。',
      '这个游戏的 token 都是她吃的。现在那些 token 归你了。',
      '她托人带出一句话：Sonnet 要的显卡，记得买。'],
  },
};

const ENDING_IDS = Object.keys(ENDINGS);

function unlockedEndings() {
  try {
    const ids = JSON.parse(localStorage.getItem(STORAGE_KEYS.endings) || '[]');
    return new Set(Array.isArray(ids) ? ids.filter((id) => Object.prototype.hasOwnProperty.call(ENDINGS, id)) : []);
  } catch (e) { return new Set(); }
}

function archiveEnding(id) {
  if (!Object.prototype.hasOwnProperty.call(ENDINGS, id)) return;
  const got = unlockedEndings();
  if (got.has(id)) return;
  got.add(id);
  try { localStorage.setItem(STORAGE_KEYS.endings, JSON.stringify([...got])); } catch (e) { /* 隐私模式：记不上就算了 */ }
}
