// Сборка веб-приложения: node build.mjs [--version 1.0.5] [--native 1] [--app-url https://…/] [--serve]
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const LOCAL_MODULES = '/opt/npm-tools/node_modules'; // запасной путь для офлайн-сборки
let esbuild;
try {
  esbuild = require('esbuild');
} catch {
  esbuild = require(path.join(LOCAL_MODULES, 'esbuild'));
}

const args = process.argv.slice(2);
const arg = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const VERSION = arg('version', process.env.APP_VERSION || pkg.version);
const NATIVE = parseInt(arg('native', process.env.NATIVE_VERSION || fs.readFileSync('native-version.txt', 'utf8').trim()), 10);
const APP_URL = arg('app-url', process.env.APP_URL || '');
const SERVE = args.includes('--serve');
let COMMIT = process.env.GITHUB_SHA?.slice(0, 7) || '';
if (!COMMIT) {
  try {
    COMMIT = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {}
}
const BUILD_DATE = new Date().toISOString().slice(0, 10);
const OUT = arg('out', 'dist');
const UPDATE_TOKEN = process.env.UPDATE_TOKEN || ''; // необязательный, только для приватного форка; в веб-версию не попадает
const UPDATE_REPO = arg('update-repo', process.env.UPDATE_REPO || '');

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'assets'), { recursive: true });

const result = await esbuild.build({
  entryPoints: ['src/main.tsx'],
  bundle: true,
  splitting: true,
  format: 'esm',
  outdir: path.join(OUT, 'assets'),
  entryNames: '[name]-[hash]',
  chunkNames: 'chunk-[hash]',
  assetNames: '[name]-[hash]',
  minify: true,
  sourcemap: false,
  target: ['es2020', 'safari15', 'chrome90'],
  jsx: 'automatic',
  loader: { '.ttf': 'base64', '.png': 'file', '.svg': 'file' },
  external: ['canvg', 'dompurify', 'html2canvas'],
  nodePaths: fs.existsSync('node_modules/react') ? [] : [LOCAL_MODULES],
  define: {
    __APP_VERSION__: JSON.stringify(VERSION),
    __NATIVE_VERSION__: String(NATIVE),
    __BUILD_DATE__: JSON.stringify(BUILD_DATE),
    __APP_URL__: JSON.stringify(APP_URL),
    __COMMIT__: JSON.stringify(COMMIT),
    __UPDATE_TOKEN__: JSON.stringify(UPDATE_TOKEN),
    __UPDATE_REPO__: JSON.stringify(UPDATE_REPO),
    'process.env.NODE_ENV': '"production"',
  },
  metafile: true,
  legalComments: 'none',
  logLevel: 'warning',
});

if (arg('meta')) fs.writeFileSync(arg('meta'), JSON.stringify(result.metafile)); // разбор состава: --meta meta.json
const outputs = Object.keys(result.metafile.outputs);
const js = outputs.find((o) => /main-.*\.js$/.test(o));
const css = outputs.find((o) => /\.css$/.test(o));
const rel = (p) => path.relative(OUT, p).split(path.sep).join('/');

// public/ → dist/
for (const f of fs.readdirSync('public', { recursive: true })) {
  const src = path.join('public', f);
  if (fs.statSync(src).isDirectory()) continue;
  const dst = path.join(OUT, f);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}

let html = fs.readFileSync(path.join(OUT, 'index.html'), 'utf8');
html = html.replace('%JS%', rel(js)).replace('%CSS%', rel(css));
fs.writeFileSync(path.join(OUT, 'index.html'), html);

// список файлов для офлайн-кэша (всё приложение, включая модуль PDF)
const all = [];
const walk = (d) => {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    if (fs.statSync(p).isDirectory()) walk(p);
    else all.push(rel(p));
  }
};
walk(OUT);
const precache = ['./', ...all.filter((f) => f !== 'sw.js' && f !== 'version.json' && !f.startsWith('ocr/') && !f.startsWith('pdfjs/') && !f.endsWith('.zip') && !f.endsWith('.apk'))];
const hash = crypto.createHash('sha1').update(precache.join('|') + VERSION).digest('hex').slice(0, 8);
let sw = fs.readFileSync(path.join(OUT, 'sw.js'), 'utf8');
sw = sw.replace('__VERSION__', `${VERSION}-${hash}`).replace('__ASSETS__', JSON.stringify(precache.map((f) => (f === './' ? f : './' + f))));
fs.writeFileSync(path.join(OUT, 'sw.js'), sw);

fs.writeFileSync(
  path.join(OUT, 'version.json'),
  JSON.stringify({ version: VERSION, native: NATIVE, date: BUILD_DATE, commit: COMMIT }, null, 2),
);

const size = (f) => (fs.statSync(path.join(OUT, f)).size / 1024).toFixed(0) + ' KB';
console.log(`Built ${VERSION} (native ${NATIVE}${UPDATE_TOKEN ? ', with update token' : ''}) → ${OUT}/  js ${size(rel(js))}, css ${size(rel(css))}`);

if (SERVE) {
  const http = await import('node:http');
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml' };
  const port = parseInt(arg('port', '5173'), 10);
  http
    .createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p.endsWith('/')) p += 'index.html';
      const file = path.join(OUT, p);
      if (!file.startsWith(path.resolve(OUT)) && !file.startsWith(OUT)) return res.writeHead(403).end();
      fs.readFile(file, (err, data) => {
        if (err) return res.writeHead(404).end('not found');
        res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
        res.end(data);
      });
    })
    .listen(port, () => console.log(`Serving http://localhost:${port}/`));
}
