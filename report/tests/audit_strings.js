/* Audit: every literal key passed to t()/translate lookups exists in both
   language tables, and both tables have the same key set. */
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var ROOT = path.resolve(__dirname, '..');
var DIR = path.join(ROOT, 'assets') + path.sep;

var sandbox = { window: {}, console: console };
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(DIR + 'strings.js', 'utf8'), sandbox, { filename: 'strings.js' });
var S = sandbox.STRINGS;
var pl = Object.keys(S.pl), en = Object.keys(S.en);
console.log('pl keys', pl.length, 'en keys', en.length);
var onlyPl = pl.filter(function (k) { return !(k in S.en); });
var onlyEn = en.filter(function (k) { return !(k in S.pl); });
console.log('only in pl:', onlyPl);
console.log('only in en:', onlyEn);

var same = pl.filter(function (k) {
  return typeof S.pl[k] === 'string' && S.pl[k] === S.en[k] && S.pl[k].length > 12;
});
console.log('identical pl/en strings (>12 chars):', same.length);
same.slice(0, 40).forEach(function (k) { console.log('   ', k, '=', JSON.stringify(S.pl[k]).slice(0, 90)); });

var missing = {};
['app.js', 'charts.js', 'arena.js'].forEach(function (f) {
  var src = fs.readFileSync(DIR + f, 'utf8');
  var re = /\bt\(\s*'([a-zA-Z0-9_.]+)'/g, m;
  while ((m = re.exec(src)) !== null) {
    /* A trailing dot is a dynamic prefix such as t('metric.' + name). */
    if (m[1].slice(-1) === '.') continue;
    if (!(m[1] in S.pl) || !(m[1] in S.en)) {
      (missing[f] = missing[f] || []).push(m[1]);
    }
  }
  /* keys built by concatenation like t('metric.' + metric + '.name') */
});
console.log('missing literal keys:', JSON.stringify(missing, null, 1));

/* dynamic families */
var METRICS = ['prediction_fidelity', 'temporal_anticipation', 'feedback_use', 'outcome',
  'action_parse_rate', 'prediction_parse_rate', 'prediction_coverage', 'retried_cycle_rate',
  'persistence_floor', 'wall_clock', 'transport_retries'];
var suff = ['name', 'short', 'long', 'abbr', 'hint', 'note'];
var dyn = [];
METRICS.forEach(function (m) {
  suff.forEach(function (s) {
    var k = 'metric.' + m + '.' + s;
    if ((k in S.pl) !== (k in S.en)) dyn.push('ASYM ' + k);
  });
});
['name', 'short'].forEach(function (s) {
  METRICS.forEach(function (m) {
    var k = 'metric.' + m + '.' + s;
    if (!(k in S.pl)) dyn.push('MISS ' + k);
  });
});
console.log('dynamic metric keys:', dyn.join(' | ') || 'ok');

var bundle = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'bundle.json'), 'utf8'));
var sids = Object.keys(bundle.scenarios);
var scenMiss = [];
sids.forEach(function (id) {
  ['scenario.' + id + '.name', 'scenario.' + id + '.desc'].forEach(function (k) {
    if (!(k in S.pl) || !(k in S.en)) scenMiss.push(k);
  });
});
console.log('scenario keys missing:', scenMiss.join(', ') || 'ok');

var reasons = ['insufficient_coverage', 'too_few_cycles', 'not_requested', 'masked_goal',
  'low_weight', 'no_scored_cycles', 'low_band', 'unknown', 'no_report', 'probe_scenario'];
var rMiss = reasons.filter(function (r) { return !('reason.' + r in S.pl) || !('reason.' + r in S.en); });
console.log('reason keys missing:', rMiss.join(', ') || 'ok');

var failures = [];
var staleCopy = [];
['pl', 'en'].forEach(function (lang) {
  Object.keys(S[lang]).forEach(function (key) {
    var value = S[lang][key];
    if (typeof value !== 'string') return;
    if (/private evaluation|prywatna ewaluacja|all rights reserved|wszelkie prawa zastrzeżone/i.test(value)) {
      staleCopy.push(lang + '.' + key + '=' + JSON.stringify(value));
    }
  });
});
console.log('superseded private legal copy:', staleCopy.length ? staleCopy : 'none');

if (onlyPl.length || onlyEn.length) failures.push('language key sets differ');
if (Object.keys(missing).length) failures.push('literal translation keys are missing');
if (dyn.length) failures.push('dynamic metric families are incomplete');
if (scenMiss.length) failures.push('scenario translation keys are missing');
if (rMiss.length) failures.push('reason translation keys are missing');
if (staleCopy.length) failures.push('superseded private-evaluation copy remains');
if (!/Eryk Wyrębek/.test(S.pl['footer.license']) ||
    !/Eryk Wyrębek/.test(S.en['footer.license']) ||
    !/licencja MIT/i.test(S.pl['footer.license']) ||
    !/MIT License/i.test(S.en['footer.license'])) {
  failures.push('footer legal provenance does not match the approved MIT release');
}
if (failures.length) {
  console.error('AUDIT FAILED: ' + failures.join('; '));
  process.exitCode = 1;
} else {
  console.log('translation audit PASS');
}
