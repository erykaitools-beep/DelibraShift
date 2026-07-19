import fs from 'fs';
const src = fs.readFileSync(new URL('../assets/strings.js', import.meta.url), 'utf8');
const mod = {};
new Function('module','exports','globalThis', src + '\n;module.exports=STRINGS;')(mod,{},globalThis);
const S = mod.exports;
const pl = Object.keys(S.pl), en = Object.keys(S.en);
console.log('PL keys', pl.length, 'EN keys', en.length);
const setEn = new Set(en), setPl = new Set(pl);
const missEn = pl.filter(k=>!setEn.has(k));
const missPl = en.filter(k=>!setPl.has(k));
console.log('missing in EN:', JSON.stringify(missEn));
console.log('missing in PL:', JSON.stringify(missPl));
// order
let orderMismatch = [];
for (let i=0;i<Math.min(pl.length,en.length);i++) if (pl[i]!==en[i]) orderMismatch.push([i,pl[i],en[i]]);
console.log('order mismatches:', orderMismatch.length, JSON.stringify(orderMismatch.slice(0,5)));
// placeholders
const toks = s => (String(s).match(/\{[a-z_]+\}/g)||[]).sort().join(',');
let tokDiff=[];
for (const k of pl) if (setEn.has(k) && toks(S.pl[k])!==toks(S.en[k])) tokDiff.push([k,toks(S.pl[k]),toks(S.en[k])]);
console.log('token diffs:', tokDiff.length, JSON.stringify(tokDiff));
// identical strings (untranslated)
let same=[];
for (const k of pl) if (setEn.has(k) && S.pl[k]===S.en[k] && String(S.pl[k]).length>3) same.push(k);
console.log('identical pl==en (len>3):', same.length, JSON.stringify(same));
// emoji
const emo = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/u;
let e=[]; for (const L of ['pl','en']) for (const k of Object.keys(S[L])) if (emo.test(S[L][k])) e.push(L+':'+k+' :: '+S[L][k]);
console.log('emoji-ish:', JSON.stringify(e));
// long sentences PL
let long=[];
for (const k of pl){ const v=String(S.pl[k]); for (const sent of v.split(/(?<=[.:;?!])\s+/)) { const w=sent.trim().split(/\s+/).filter(Boolean).length; if (w>25) long.push([k,w,sent.trim().slice(0,140)]); } }
console.log('PL sentences >25 words:', long.length);
for (const l of long) console.log('  ', l[0], l[1], '|', l[2]);
