'use strict';
// 本分支的身份。存储键由 id 派生：改了 id 就等于换一批存档，玩家在本分支和原版之间不会互相顶掉进度。
// 下载后双击 index.html 玩时，部分浏览器让所有本地网页共用一份存储，所以 mod 必须有自己的键。
// subtitle 和 author 显示在标题画面那行小字上，改名时和 index.html 的 <title>、og:* 一起改。

const MOD = Object.freeze({ id: 'ip-please-week-two', subtitle: '第二周', author: 'KujouShiori' });

const STORAGE_KEYS = Object.freeze({
  save: `${MOD.id}-save-v1`,
  endless: `${MOD.id}-endless-v1`,
  endlessBest: `${MOD.id}-endless-best-v1`,
  endings: `${MOD.id}-endings-v1`,
  lang: `${MOD.id}-lang`,
});
