import { mkdir, copyFile, readFile, writeFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'dist');
await mkdir(output, { recursive: true });
const allowed = new Set(['index.html', '_headers', 'styles.css', 'icon.svg', 'app.js', 'cloud.js', 'rename-template.ps1']);
for (const name of await readdir(output)) {
  if (!allowed.has(name)) throw new Error(`Unexpected file in dist: ${name}. Remove it before publishing.`);
}
// Explicit allowlist: never publish the repository, Python server, runtime, or credentials.
for (const name of ['styles.css', 'icon.svg', 'app.js', 'cloud.js', 'rename-template.ps1']) {
  await copyFile(path.join(root, 'web', name), path.join(output, name));
}
let html = await readFile(path.join(root, 'web/index.html'), 'utf8');
html = html.replace('<meta name="rename-token" content="__RENAME_TOKEN__">', '<meta name="rename-token" content="">\n  <meta name="rename-mode" content="cloud">');
html = html.replace('<script src="/app.js" defer></script>', '<script src="/cloud.js" defer></script>\n  <script src="/app.js" defer></script>');
await writeFile(path.join(output, 'index.html'), html);
await writeFile(path.join(output, '_headers'), `/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n  X-Frame-Options: DENY\n  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'\n`);
console.log('Cloudflare static build ready: dist/ (7 public files only)');
