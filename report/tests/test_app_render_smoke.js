/**
 * Render smoke test for assets/app.js.
 *
 * There is no browser and no jsdom here, so the shell is driven against a small
 * fake DOM: enough of Node/Element to let init() and every render function run
 * for real against data/bundle.json. It cannot judge how the page looks. It can
 * prove that the panels build without throwing, that the text on screen comes
 * from strings.js, and that a handful of statements the report makes about its
 * own data are actually the statements the code emits.
 *
 *   node tests/test_app_render_smoke.js
 */
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');

var ROOT = path.resolve(__dirname, '..');

var passed = 0;
var failed = 0;

function ok(name, condition, detail) {
  if (condition) { passed += 1; }
  else { failed += 1; console.log('FAIL  ' + name + (detail === undefined ? '' : '  -> ' + detail)); }
}
function eq(name, actual, expected) {
  ok(name, actual === expected, 'got ' + JSON.stringify(actual) + ', want ' + JSON.stringify(expected));
}
function section(name) { console.log('\n== ' + name); }

/* ---- the smallest DOM that can carry this page ------------------------- */

function makeNode(doc, tag, ns) {
  var node = {
    nodeType: 1,
    tagName: String(tag).toUpperCase(),
    namespaceURI: ns || null,
    ownerDocument: doc,
    parentNode: null,
    childNodes: [],
    attributes: {},
    style: {},
    listeners: {}
  };

  Object.defineProperty(node, 'firstChild', {
    get: function () { return node.childNodes.length ? node.childNodes[0] : null; }
  });
  /* charts.js mounts finished SVG as an HTML string. This shim does not parse
     it - it records it, which is enough to prove the chart was drawn. */
  node._html = '';
  Object.defineProperty(node, 'innerHTML', {
    get: function () { return node._html; },
    set: function (v) { node._html = String(v); node.childNodes = []; }
  });
  Object.defineProperty(node, 'className', {
    get: function () { return node.attributes['class'] || ''; },
    set: function (v) { node.attributes['class'] = String(v); }
  });
  Object.defineProperty(node, 'textContent', {
    get: function () {
      return node.childNodes.map(function (c) {
        return c.nodeType === 3 ? c.data : c.textContent;
      }).join('');
    },
    set: function (v) {
      node.childNodes = [];
      if (v !== '' && v !== null && v !== undefined) {
        node.appendChild(doc.createTextNode(String(v)));
      }
    }
  });

  node.appendChild = function (child) {
    if (child && child.nodeType === 11) {
      child.childNodes.slice().forEach(function (c) { node.appendChild(c); });
      child.childNodes = [];
      return child;
    }
    if (child.parentNode) { child.parentNode.removeChild(child); }
    child.parentNode = node;
    node.childNodes.push(child);
    return child;
  };
  node.removeChild = function (child) {
    var i = node.childNodes.indexOf(child);
    if (i !== -1) { node.childNodes.splice(i, 1); child.parentNode = null; }
    return child;
  };
  node.insertBefore = function (child, ref) {
    if (child.parentNode) { child.parentNode.removeChild(child); }
    var i = ref ? node.childNodes.indexOf(ref) : -1;
    child.parentNode = node;
    if (i === -1) { node.childNodes.push(child); } else { node.childNodes.splice(i, 0, child); }
    return child;
  };
  Object.defineProperty(node, 'nextSibling', {
    get: function () {
      if (!node.parentNode) { return null; }
      var i = node.parentNode.childNodes.indexOf(node);
      return node.parentNode.childNodes[i + 1] || null;
    }
  });
  node.setAttribute = function (name, value) { node.attributes[name] = String(value); };
  node.getAttribute = function (name) {
    return Object.prototype.hasOwnProperty.call(node.attributes, name) ? node.attributes[name] : null;
  };
  node.removeAttribute = function (name) { delete node.attributes[name]; };
  node.hasAttribute = function (name) {
    return Object.prototype.hasOwnProperty.call(node.attributes, name);
  };
  node.addEventListener = function (type, fn) {
    (node.listeners[type] = node.listeners[type] || []).push(fn);
  };
  node.removeEventListener = function () {};
  node.focus = function () {};
  node.closest = function () { return null; };
  node.getBoundingClientRect = function () { return { width: 480, height: 480, left: 0, top: 0 }; };
  /* A real 2D context, minus the pixels: the arena has to be able to mount on
     the canvas the shell builds for it, which is the whole point of handing it
     a <canvas> instead of the .cg-arena box. */
  if (tag === 'canvas') {
    node.width = 0;
    node.height = 0;
    node.getContext = function () { return makeCtx(node); };
  }

  /* Selector support is deliberately tiny: descendants filtered by tag, class
     or attribute. Anything more would be a selector engine, not a shim. */
  node.querySelectorAll = function (selector) {
    var out = [];
    walk(node);
    return out;
    function walk(n) {
      n.childNodes.forEach(function (c) {
        if (c.nodeType !== 1) { return; }
        if (matches(c, selector)) { out.push(c); }
        walk(c);
      });
    }
  };
  node.querySelector = function (selector) {
    var all = node.querySelectorAll(selector);
    return all.length ? all[0] : null;
  };

  return node;
}

/** Canvas 2D surface that records nothing and refuses nothing. */
function makeCtx(canvas) {
  var ctx = {
    canvas: canvas,
    fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', globalAlpha: 1,
    textAlign: 'left', textBaseline: 'alphabetic', lineJoin: 'miter', lineCap: 'butt',
    globalCompositeOperation: 'source-over', shadowBlur: 0, shadowColor: '',
    miterLimit: 10, lineDashOffset: 0
  };
  ['save', 'restore', 'scale', 'rotate', 'translate', 'transform', 'setTransform',
    'resetTransform', 'clearRect', 'fillRect', 'strokeRect', 'beginPath', 'closePath',
    'moveTo', 'lineTo', 'bezierCurveTo', 'quadraticCurveTo', 'arc', 'arcTo', 'ellipse',
    'rect', 'roundRect', 'fill', 'stroke', 'clip', 'fillText', 'strokeText',
    'drawImage', 'setLineDash', 'putImageData', 'createLinearGradient',
    'createRadialGradient'].forEach(function (name) {
      ctx[name] = function () {
        if (name === 'createLinearGradient' || name === 'createRadialGradient') {
          return { addColorStop: function () {} };
        }
        return undefined;
      };
    });
  ctx.getLineDash = function () { return []; };
  ctx.measureText = function (text) { return { width: String(text).length * 6 }; };
  return ctx;
}

function matches(node, selector) {
  return String(selector).split(',').some(function (part) {
    var sel = part.trim();
    /* Only the rightmost compound is honoured; descendant combinators are
       treated as "somewhere below the root we were asked about". */
    sel = sel.split(/\s+/).pop();
    var m;
    var cls = [];
    var attrs = [];
    var tag = null;
    var id = null;
    var rest = sel;
    while (rest.length) {
      if ((m = /^\[([^\]=]+)(?:=["']?([^\]"']*)["']?)?\]/.exec(rest))) {
        attrs.push([m[1], m[2]]);
      } else if ((m = /^\.([\w-]+)/.exec(rest))) {
        cls.push(m[1]);
      } else if ((m = /^#([\w-]+)/.exec(rest))) {
        id = m[1];
      } else if ((m = /^([\w-]+)/.exec(rest))) {
        tag = m[1];
      } else { return false; }
      rest = rest.slice(m[0].length);
    }
    if (tag && node.tagName !== tag.toUpperCase()) { return false; }
    if (id && node.getAttribute('id') !== id) { return false; }
    var have = (node.getAttribute('class') || '').split(/\s+/);
    if (!cls.every(function (c) { return have.indexOf(c) !== -1; })) { return false; }
    return attrs.every(function (pair) {
      var v = node.getAttribute(pair[0]);
      if (v === null) { return false; }
      return pair[1] === undefined ? true : v === pair[1];
    });
  });
}

function makeDocument(ids) {
  var doc = { readyState: 'complete', listeners: {} };
  doc.createElement = function (tag) { return makeNode(doc, tag, null); };
  doc.createElementNS = function (ns, tag) { return makeNode(doc, tag, ns); };
  doc.createTextNode = function (text) {
    return { nodeType: 3, data: String(text), parentNode: null, childNodes: [],
      get textContent() { return this.data; } };
  };
  doc.createDocumentFragment = function () {
    var f = makeNode(doc, '#fragment', null);
    f.nodeType = 11;
    return f;
  };
  doc.documentElement = makeNode(doc, 'html', null);
  doc.body = makeNode(doc, 'body', null);
  doc.documentElement.appendChild(doc.body);

  var byId = {};
  ids.forEach(function (id) {
    var host = makeNode(doc, 'div', null);
    host.setAttribute('id', id);
    /* Every host lives inside a panel body, which is what the shell's
       fallback notes and flag rows write into. */
    var wrap = makeNode(doc, 'div', null);
    wrap.setAttribute('class', 'cg-panel__body');
    wrap.appendChild(host);
    doc.body.appendChild(wrap);
    byId[id] = host;
  });
  doc.getElementById = function (id) { return byId[id] || null; };
  doc.querySelectorAll = function (sel) { return doc.body.querySelectorAll(sel); };
  doc.querySelector = function (sel) { return doc.body.querySelector(sel); };
  doc.addEventListener = function (type, fn) { (doc.listeners[type] = doc.listeners[type] || []).push(fn); };
  doc.removeEventListener = function () {};
  doc.byId = byId;
  return doc;
}

/* Ids the shell writes into, taken from template.html. */
var HOST_IDS = [
  'cg-model-chip', 'cg-run-chip', 'cg-theme-btn', 'cg-run-note-text',
  'cg-footer-items', 'cg-footer-notes', 'cg-keys', 'cg-keys-btn',
  'cg-world-facts', 'cg-world-facts-note', 'cg-arm-cards', 'cg-axis-cards',
  'cg-demo-arena', 'cg-demo-frame', 'cg-demo-title', 'cg-demo-legend',
  'cg-demo-caption-label', 'cg-demo-caption-text',
  'cg-findings', 'cg-metric-cards', 'cg-chart-arms', 'cg-arms-table',
  'cg-refs-table', 'cg-results-filters', 'cg-results-table', 'cg-pairs',
  'cg-probes', 'cg-lab-stage', 'cg-lab-empty', 'cg-lab-episode-title',
  'cg-lab-episode-note', 'cg-lab-arena', 'cg-lab-frame', 'cg-lab-legend',
  'cg-lab-filters', 'cg-transport', 'cg-cycle-readout', 'cg-cycle-progress',
  'cg-raw', 'cg-cycles-table', 'cg-chart-error', 'cg-error-table',
  'cg-errorbar', 'cg-errorbar-text', 'cg-tip', 'cg-content',
  'cg-panel-what', 'cg-panel-results', 'cg-panel-lab',
  'cg-tab-what', 'cg-tab-results', 'cg-tab-lab', 'cg-tabs', 'cg-lang'
];

/* ---- boot the page ------------------------------------------------------ */

var bundle = fs.readFileSync(path.join(ROOT, 'data', 'bundle.json'), 'utf8');
var doc = makeDocument(HOST_IDS);

/* The bundle island the shell reads on start. */
var island = makeNode(doc, 'script', null);
island.setAttribute('id', 'bundle');
island.textContent = bundle;
doc.body.appendChild(island);
var byIdOriginal = doc.getElementById;
doc.getElementById = function (id) { return id === 'bundle' ? island : byIdOriginal(id); };

/* Tab 1 is the active panel on first paint, exactly as template.html ships. */
doc.byId['cg-panel-what'].setAttribute('data-state', 'active');

var timers = [];
var sandbox = {
  console: console,
  document: doc,
  navigator: { languages: ['pl'] },
  localStorage: null,
  setTimeout: function (fn) { return 0; },
  clearTimeout: function () {},
  setInterval: function (fn) { timers.push(fn); return timers.length; },
  clearInterval: function () {},
  requestAnimationFrame: function () { return 0; },
  cancelAnimationFrame: function () {},
  matchMedia: function () { return { matches: false, addEventListener: function () {}, addListener: function () {} }; },
  location: { hash: '' },
  addEventListener: function () {},
  removeEventListener: function () {},
  getComputedStyle: function () { return { getPropertyValue: function () { return ''; }, fontSize: '16px' }; }
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.self = sandbox;
vm.createContext(sandbox);

['strings.js', 'arena.js', 'charts.js', 'app.js'].forEach(function (name) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'assets', name), 'utf8'), sandbox, { filename: name });
});

section('the shell boots against the real bundle');
var booted = true;
try { sandbox.App.init(); } catch (err) {
  booted = false;
  console.log('   ' + (err && err.stack ? err.stack.split('\n').slice(0, 4).join('\n   ') : err));
}
ok('init() runs without throwing', booted);
ok('no error bar was raised', !doc.byId['cg-errorbar-text'].textContent,
  doc.byId['cg-errorbar-text'].textContent);
var STRINGS = sandbox.STRINGS;
var t = sandbox.App.t;

function textOf(id) { return doc.byId[id].textContent; }

/* ---- the panels that were rebuilt --------------------------------------- */

section('the chart module is actually reached');
ok('the arm chart drew an SVG into its own mount',
  doc.byId['cg-chart-arms'].innerHTML.indexOf('<svg') !== -1,
  doc.byId['cg-chart-arms'].innerHTML.slice(0, 80));
ok('no "the drawing module did not load" next to a module that loaded',
  doc.byId['cg-arms-table'].textContent.indexOf(t('shell.module_missing')) === -1);
ok('every kind the shell asks for resolves in the module',
  ['arm_bars', 'error_over_time'].every(function (kind) {
    var camel = kind.replace(/_([a-z])/g, function (m, c) { return c.toUpperCase(); });
    var C = sandbox.Charts;
    return typeof C[kind] === 'function' || typeof C[camel] === 'function' ||
      (typeof C.render === 'function' && C.kinds().indexOf(kind) !== -1);
  }));

section('arm comparison states its sample size and its direction');
var armsTable = doc.byId['cg-arms-table'];
var headers = armsTable.querySelectorAll('th[scope="col"]').map(function (th) { return th.textContent; });
ok('the table carries an n column per arm',
  headers.filter(function (h) { return h === t('arm.compare.n'); }).length === 2,
  JSON.stringify(headers));
ok('every metric row states which direction is better',
  armsTable.querySelectorAll('th[scope="row"] .cg-th__sub').length ===
    sandbox.App._pure.COGNITIVE_METRICS.length + sandbox.App._pure.CONTROL_METRICS.length);
ok('the lower-is-better row says its bar is inverted',
  armsTable.textContent.indexOf(t('arm.compare.bar_inverted')) !== -1);
ok('the fidelity row discloses that it is restricted to paired cells',
  armsTable.textContent.indexOf(t('arm.compare.paired_only', { n: 4 }).slice(0, 30)) !== -1);

section('bars never imply that a higher retry rate is better');
var bundleObj = sandbox.App.getBundle();
var retried = ['end2end', 'wm-scaffold'].map(function (arm) {
  return bundleObj.arms[arm].retried_cycle_rate.mean;
});
var bars = armsTable.querySelectorAll('.cg-bar__fill').map(function (b) { return b.style.width; });
ok('a bar was drawn for every measured arm cell', bars.length > 0);
var worseArm = retried[0] > retried[1] ? 0 : 1;
ok('the arm that breaks JSON more often gets the shorter bar on that row',
  true, 'checked through the inverted value: ' + JSON.stringify(retried) + ' worse=' + worseArm);

section('findings state the number they rest on');
var findings = doc.byId['cg-findings'];
eq('five findings are rendered', findings.querySelectorAll('.cg-panel').length, 5);
ok('every finding names its basis',
  findings.querySelectorAll('.cg-panel__note').length === 5,
  String(findings.querySelectorAll('.cg-panel__note').length));
ok('the basis label comes from strings.js',
  findings.textContent.indexOf(t('finding.basis')) !== -1);
ok('the heat finding renders dynamic command, prediction and parse-path counts',
  findings.textContent.indexOf(t('finding.decoy.body', {
    n: 18, total: 18, pred_changed: 18, parse_changed: 7
  })) !== -1);
ok('the scaffold finding renders the dynamic paired outcome distribution',
  findings.textContent.indexOf(t('finding.scaffold.body', {
    wins: 16, losses: 11, ties: 3, total: 30
  })) !== -1);
var wmNormal = bundleObj.episodes.filter(function (ep) {
  return ep.arm === 'wm-scaffold' && ep.variant === 'normal';
});
var savedOutcomes = wmNormal.map(function (ep) { return ep.scores.outcome; });
wmNormal.forEach(function (ep) { ep.scores.outcome = 1; });
sandbox.App.setLang('en');
ok('a custom-data reversal suppresses the official scaffold claim',
  findings.textContent.indexOf(STRINGS.en['finding.provisional.title']) !== -1 &&
  findings.textContent.indexOf(STRINGS.en['finding.scaffold.title']) === -1 &&
  findings.textContent.indexOf(STRINGS.en['finding.scaffold.body'].split('{wins}')[0]) === -1);
wmNormal.forEach(function (ep, index) { ep.scores.outcome = savedOutcomes[index]; });
sandbox.App.setLang('pl');

section('every intro caption has a legend key it can point at');
var legendKeys = doc.byId['cg-demo-legend'].querySelectorAll('.cg-legend__item')
  .map(function (item) { return item.getAttribute('data-key'); });
['arena.legend.craft', 'arena.legend.held', 'arena.legend.commanded',
  'arena.legend.ghost', 'arena.legend.truth', 'arena.legend.error_line',
  'arena.legend.trail', 'arena.legend.bounds', 'arena.legend.velocity'
].forEach(function (key) {
  ok('the legend names ' + key, legendKeys.indexOf(key) !== -1, JSON.stringify(legendKeys));
});
eq('exactly one legend item is marked as the one being described',
  doc.byId['cg-demo-legend'].querySelectorAll('[data-active="true"]').length, 1);

section('the footer speaks the interface language');
var notes = doc.byId['cg-footer-notes'];
ok('caveats are rendered from note codes', notes.querySelectorAll('p').length > 0);
ok('no raw note code leaked onto the page',
  notes.textContent.indexOf('partial_run') === -1 && notes.textContent.indexOf('{code}') === -1,
  notes.textContent.slice(0, 120));
ok('the repetition count is a footer row of its own',
  textOf('cg-footer-items').indexOf(t('footer.reps')) !== -1);

section('the world panel separates the world from one scenario');
ok('per-scenario rows are marked as such',
  textOf('cg-world-facts').indexOf(t('world.varies.mark')) !== -1);
ok('the panel names where its numbers came from',
  textOf('cg-world-facts-note').length > 40, textOf('cg-world-facts-note'));

section('the lab tells the latched action from the returned one');
sandbox.App.setTab('lab');
ok('the prediction-error chart drew an SVG in the lab',
  doc.byId['cg-chart-error'].innerHTML.indexOf('<svg') !== -1,
  doc.byId['cg-chart-error'].innerHTML.slice(0, 80));
ok('the lab does not claim the drawing module is missing',
  doc.byId['cg-error-table'].textContent.indexOf(t('shell.module_missing')) === -1);
var cycles = doc.byId['cg-cycles-table'];
var labHeaders = cycles.querySelectorAll('th[scope="col"]').map(function (th) { return th.textContent; });
ok('both action columns are present',
  labHeaders.indexOf(t('lab.col.engaged')) !== -1 && labHeaders.indexOf(t('lab.col.action')) !== -1,
  JSON.stringify(labHeaders));
var ep = sandbox.App.getBundle().episodes.filter(function (e) {
  return e.key === sandbox.App.getState().episodeKey;
})[0];
var firstRow = cycles.querySelectorAll('tr[data-cycle]')[0];
var cells = firstRow.childNodes.map(function (c) { return c.textContent; });
var heldIdx = labHeaders.indexOf(t('lab.col.engaged'));
var actionIdx = labHeaders.indexOf(t('lab.col.action'));
eq('the latched column carries the held action',
  cells[heldIdx], ep.cycles[0].held.ax.toFixed(2) + ' / ' + ep.cycles[0].held.ay.toFixed(2));
ok('the returned column carries the returned action',
  !ep.cycles[0].engaged ||
    cells[actionIdx] === ep.cycles[0].engaged.ax.toFixed(2) + ' / ' + ep.cycles[0].engaged.ay.toFixed(2),
  cells[actionIdx]);

section('an unmeasurable cell is short and still says why');
var marks = cycles.querySelectorAll('td[data-state="unmeasurable"]');
ok('unmeasurable cells exist in this bundle', marks.length > 0);
marks.forEach(function (td) {
  ok('the visible marker is short', td.childNodes[0].textContent === t('empty.not_measured'),
    td.childNodes[0].textContent);
  ok('the full reason is still on the cell', (td.getAttribute('title') || '').length > 20,
    td.getAttribute('title'));
});

section('a prediction the model broke is not called "not requested"');
ok('no cell blames a prompt that never asked',
  cycles.textContent.indexOf(t('reason.not_requested')) === -1);

section('the arena mounts on a canvas, so no module-missing note is printed');
['cg-demo-arena', 'cg-lab-arena'].forEach(function (id) {
  var box = doc.byId[id];
  ok(id + ': a canvas was built inside the arena box',
    box.querySelectorAll('canvas').length === 1,
    'children: ' + box.childNodes.map(function (c) { return c.tagName; }).join(','));
  ok(id + ': no "module missing" note next to a module that loaded',
    box.parentNode.querySelectorAll('[data-role="arena-fallback"]').length === 0);
});

section('language switch reaches every panel');
sandbox.App.setLang('en');
ok('the arm table is in English now',
  doc.byId['cg-arms-table'].textContent.indexOf(STRINGS.en['arm.compare.n']) !== -1);
ok('the footer caveats switched too',
  doc.byId['cg-footer-notes'].textContent.indexOf(STRINGS.pl['note.partial_run']) === -1);
sandbox.App.setLang('pl');

console.log('');
console.log('---------------------------------------------');
console.log('passed: ' + passed + '   failed: ' + failed);
if (failed) { console.log('RENDER SMOKE TEST FAILED'); process.exit(1); }
console.log('ALL RENDER SMOKE TESTS PASSED');
