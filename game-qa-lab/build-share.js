// Builds a single self-contained HTML file (CSS + JS inlined) for sharing as a hosted page.
// Usage: node build-share.js [outFile]   (default dist/game-qa-lab.html)
const fs = require('fs');
const path = require('path');

const root = __dirname;
const out = path.resolve(process.argv[2] || path.join(root, 'dist', 'game-qa-lab.html'));
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
const js = scripts.map((s) => `/* ${s} */\n` + fs.readFileSync(path.join(root, s), 'utf8')).join('\n');
const css = fs.readFileSync(path.join(root, 'css/styles.css'), 'utf8');
if (/<\/script/i.test(js) || /<\/style/i.test(css)) throw new Error('Inlined code contains a closing tag');

const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>')).replace(/\s*<script src="[^"]+"><\/script>/g, '');
const page = `<title>Game QA Lab</title>\n<style>\n${css}\n</style>\n${body.trim()}\n<script>\n${js}\n</script>\n`;

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, page);
console.log(`Wrote ${out} (${Math.round(page.length / 1024)} KB, ${scripts.length} scripts inlined)`);
