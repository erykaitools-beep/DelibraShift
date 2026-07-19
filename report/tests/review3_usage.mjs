import fs from 'fs';
const src = fs.readFileSync('assets/strings.js','utf8');
const mod={}; new Function('module','exports', src+'\n;module.exports=STRINGS;')(mod,{});
const keys = Object.keys(mod.exports.pl);
const code = ['assets/app.js','assets/arena.js','assets/charts.js','template.html'].map(f=>fs.readFileSync(f,'utf8')).join('\n');
const unused = keys.filter(k=>!code.includes(k));
console.log('unused keys:', unused.length);
unused.forEach(k=>console.log('  ', k));
