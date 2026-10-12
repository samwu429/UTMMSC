import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const siteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.resolve(siteRoot, '../web/dist');
const target = path.join(siteRoot, 'public', 'UTMMSC');

if (!fs.existsSync(path.join(dist, 'index.html'))) {
  console.error('Build apps/web first. apps/web/dist/index.html is missing.');
  process.exit(1);
}

fs.rmSync(path.join(siteRoot, 'public'), { recursive: true, force: true });
fs.mkdirSync(target, { recursive: true });
fs.cpSync(dist, target, { recursive: true });
