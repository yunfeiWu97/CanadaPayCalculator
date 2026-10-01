import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
async function listFiles(directory, prefix = '') {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relative = prefix + entry.name;
    if (entry.isDirectory()) files.push(...await listFiles(path.join(directory, entry.name), relative + '/'));
    else if (entry.isFile() && relative !== 'sw.js') files.push(relative);
  }
  return files.sort();
}

const files = await listFiles(dist);
for (const required of ['index.html', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png']) {
  if (!files.includes(required)) throw new Error(`Missing PWA asset: ${required}`);
}
const hash = createHash('sha256');
for (const file of files) hash.update(file).update('\0').update(await readFile(path.join(dist, file)));
const version = hash.digest('hex').slice(0, 16);
const workerPath = path.join(dist, 'sw.js');
const template = await readFile(workerPath, 'utf8');
if (!template.includes('"__APP_VERSION__"') || !template.includes('__PRECACHE_ASSETS__')) {
  throw new Error('Service worker build placeholders are missing');
}
const worker = template.replace('"__APP_VERSION__"', JSON.stringify(version))
  .replace('__PRECACHE_ASSETS__', JSON.stringify(files.filter(file => file !== '.nojekyll').map(file => './' + file)));
if (/__APP_VERSION__|__PRECACHE_ASSETS__/.test(worker)) throw new Error('Unresolved service worker placeholders');
await writeFile(workerPath, worker, 'utf8');
console.log(`PWA ${version}: ${files.length - 1} app assets ready for offline use`);
