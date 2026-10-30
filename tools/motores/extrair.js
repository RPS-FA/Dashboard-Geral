// Extrai o fecho transitivo de declarações de topo (funções, const/let/var) usadas a partir de funções-raiz.
// uso: node extrair.js <ficheiro.html|js> raiz1,raiz2 [--excluir a,b]
const fs = require('fs'); const acorn = require('acorn'); const walk = require('acorn-walk');
const [,, ficheiro, raizesStr, ...resto] = process.argv;
const excluir = new Set((resto[resto.indexOf('--excluir') + 1] || '').split(',').filter(Boolean));
let src = fs.readFileSync(ficheiro, 'utf8').replace(/\r/g, '');
if (/\.html?$/.test(ficheiro)) { src = [...src.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]).join('\n;\n'); }
const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script', allowReturnOutsideFunction: true, allowAwaitOutsideFunction: true });
const decl = new Map(); // nome -> {node, tipo}
for (const n of ast.body) {
  if (n.type === 'FunctionDeclaration') decl.set(n.id.name, { node: n, tipo: 'function' });
  else if (n.type === 'VariableDeclaration') for (const d of n.declarations) { if (d.id.type === 'Identifier') decl.set(d.id.name, { node: n, decl: d, tipo: n.kind }); }
  else if (n.type === 'ClassDeclaration') decl.set(n.id.name, { node: n, tipo: 'class' });
}
function refs(node) { const s = new Set(); walk.full(node, x => { if (x.type === 'Identifier') s.add(x.name); }); return s; }
const raizes = raizesStr.split(',');
const usados = new Set(), fila = [...raizes];
while (fila.length) { const n = fila.pop(); if (usados.has(n) || excluir.has(n)) continue; const d = decl.get(n); if (!d) continue; usados.add(n); for (const r of refs(d.decl || d.node)) if (decl.has(r) && !usados.has(r)) fila.push(r); }
const ordem = [...decl.keys()].filter(n => usados.has(n));
const vistos = new Set(); const partes = [];
for (const n of ordem) { const d = decl.get(n); const node = d.node; if (vistos.has(node)) continue; vistos.add(node); partes.push(src.slice(node.start, node.end)); }
const livres = new Set(); for (const n of ordem) { const d = decl.get(n); for (const r of refs(d.decl || d.node)) if (!decl.has(r)) livres.add(r); }
const globaisJS = new Set(['Math', 'Date', 'Number', 'String', 'Object', 'Array', 'JSON', 'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'Infinity', 'NaN', 'undefined', 'console', 'Set', 'Map', 'RegExp', 'Boolean', 'Error', 'Symbol', 'Promise', 'encodeURIComponent', 'arguments']);
if (process.env.LISTAR) { console.error('usados:', ordem.join(', ')); console.error('tamanho:', partes.join('\n').length); }
fs.writeFileSync(process.env.OUT || '/dev/stdout', partes.join('\n\n'));
