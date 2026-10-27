// Gera scripts por separador (tab) para validar cada adaptador no browser contra os dados reais.
// Uso: node tools/harness.js <adaptador> [fonteId]
'use strict';
const fs = require('fs');
const path = require('path');
const raiz = path.join(__dirname, '..', 'src');
const [adaptador] = process.argv.slice(2);
if (!adaptador) { console.error('adaptador?'); process.exit(1); }
function src(f) {
  return fs.readFileSync(path.join(raiz, f), 'utf8')
    .split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l) && l.trim() !== '' && !/^'use strict';/.test(l))
    .map(l => l.replace(/^\s+/, '')).join('\n');
}
const mods = { './util': 'util.js', '../util': 'util.js', './estados': 'estados.js', '../estados': 'estados.js', './indicadores': 'indicadores.js', './adaptador': `adaptadores/${adaptador}.js` };
let out = '(function(){const __d={},__c={},process={env:{}},__m=' + JSON.stringify(mods) + ';function require(n){const f=__m[n];if(__c[f])return __c[f].exports;const m={exports:{}};__c[f]=m;__d[f](m,m.exports,require);return m.exports;}\n';
for (const f of [...new Set(Object.values(mods))]) out += `__d[${JSON.stringify(f)}]=function(module,exports,require){\n${src(f)}\n};\n`;
out += 'window.__DOPS={util:require("./util"),estados:require("./estados"),indicadores:require("./indicadores"),adaptador:require("./adaptador")};})();';
process.stdout.write(out);
