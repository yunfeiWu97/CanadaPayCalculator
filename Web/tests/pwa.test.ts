import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

type StubRequest = { url: string; mode: string; method: string };
type WorkerEvent = {
  request?: StubRequest;
  data?: { type: string };
  waitUntil?: (promise: Promise<unknown>) => void;
  respondWith?: (promise: Promise<Response>) => void;
};

const scope = 'https://example.github.io/CanadaPayCalculator/';
const prefix = 'canada-pay-%2FCanadaPayCalculator%2F-';
const resources = ['./index.html', './assets/app-abcdef12.js', './manifest.webmanifest'];

/** Exercise the shipped worker template using browser-like cache/event APIs. */
function workerHarness() {
  const handlers = new Map<string, (event: WorkerEvent) => void>();
  const store = new Map<string, Response>();
  const added: string[] = [];
  const deleted: string[] = [];
  let skipCalls = 0;
  let networkCalls = 0;
  let offline = false;
  const requestKey = (request: StubRequest | string): string => typeof request === 'string' ? request : request.url;
  const cache = {
    async addAll(urls: string[]): Promise<void> {
      for (const url of urls) {
        added.push(url);
        store.set(url, new Response('precached app'));
      }
    },
    async match(request: StubRequest | string): Promise<Response | undefined> {
      return store.get(requestKey(request))?.clone();
    },
    async put(request: StubRequest | string, response: Response): Promise<void> {
      store.set(requestKey(request), response.clone());
    },
  };
  const context = createContext({
    URL, Response, Promise, Set,
    self: {
      registration: { scope },
      addEventListener(type: string, handler: (event: WorkerEvent) => void): void { handlers.set(type, handler); },
      async skipWaiting(): Promise<void> { skipCalls++; },
      clients: { async claim(): Promise<void> {} },
    },
    caches: {
      async open() { return cache; },
      async keys(): Promise<string[]> {
        return [prefix + 'old-version', prefix + 'test-version', 'canada-pay-%2FAnotherApp%2F-v1', 'unrelated-app-cache'];
      },
      async delete(name: string): Promise<boolean> { deleted.push(name); return true; },
    },
    async fetch(): Promise<Response> {
      networkCalls++;
      if (offline) throw new TypeError('Network unavailable');
      return new Response('<main>fresh app</main>', { headers: { 'Content-Type': 'text/html' } });
    },
  });
  const source = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8')
    .replace('__APP_VERSION__', 'test-version')
    .replace('__PRECACHE_ASSETS__', JSON.stringify(resources));
  runInContext(source, context);

  async function lifecycle(type: 'install' | 'activate'): Promise<void> {
    let pending = Promise.resolve<unknown>(undefined);
    handlers.get(type)!({ waitUntil(promise) { pending = promise; } });
    await pending;
  }
  function request(url: string, mode = 'cors'): Promise<Response> | undefined {
    let pending: Promise<Response> | undefined;
    handlers.get('fetch')!({
      request: { url, mode, method: 'GET' },
      respondWith(promise) { pending = promise; },
    });
    return pending;
  }
  async function message(type: string): Promise<void> {
    let pending = Promise.resolve<unknown>(undefined);
    handlers.get('message')!({ data: { type }, waitUntil(promise) { pending = promise; } });
    await pending;
  }
  return {
    lifecycle, request, message, added, deleted,
    setOffline(value: boolean): void { offline = value; },
    get skipCalls(): number { return skipCalls; },
    get networkCalls(): number { return networkCalls; },
  };
}

test('the install manifest remains inside a GitHub Pages project scope', () => {
  const manifest = JSON.parse(readFileSync(new URL('../public/manifest.webmanifest', import.meta.url), 'utf8').replace(/^\uFEFF/, ''));
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.scope, './');
  assert.equal(manifest.id, './');
  assert.equal(manifest.display, 'standalone');
  assert.ok(manifest.icons.some((icon: { purpose: string }) => icon.purpose === 'maskable'));
});

test('installation precaches all scoped assets and activation waits for an explicit message', async () => {
  const worker = workerHarness();
  await worker.lifecycle('install');
  assert.deepEqual(worker.added, resources.map(resource => new URL(resource, scope).href));
  assert.equal(worker.skipCalls, 0);
  await worker.message('UNRELATED_MESSAGE');
  assert.equal(worker.skipCalls, 0);
  await worker.message('SKIP_WAITING');
  assert.equal(worker.skipCalls, 1);
});

test('activation removes only older caches for this project, not another app on the same origin', async () => {
  const worker = workerHarness();
  await worker.lifecycle('activate');
  assert.deepEqual(worker.deleted, [prefix + 'old-version']);
});

test('offline navigation falls back to the cached app, while online navigation refreshes it', async () => {
  const worker = workerHarness();
  await worker.lifecycle('install');
  worker.setOffline(true);
  const offlineResponse = await worker.request(scope, 'navigate');
  assert.equal(await offlineResponse?.text(), 'precached app');
  worker.setOffline(false);
  const onlineResponse = await worker.request(scope, 'navigate');
  assert.equal(await onlineResponse?.text(), '<main>fresh app</main>');
  worker.setOffline(true);
  const refreshedOffline = await worker.request(scope, 'navigate');
  assert.equal(await refreshedOffline?.text(), '<main>fresh app</main>');
});

test('bundled hashed assets are cache-first and unrelated requests are left to the browser', async () => {
  const worker = workerHarness();
  await worker.lifecycle('install');
  const asset = await worker.request(new URL('./assets/app-abcdef12.js', scope).href);
  assert.equal(await asset?.text(), 'precached app');
  assert.equal(worker.networkCalls, 0);
  assert.equal(worker.request('https://www.canada.ca/en.html'), undefined);
  assert.equal(worker.request('https://example.github.io/AnotherApp/index.html', 'navigate'), undefined);
  assert.equal(worker.request(new URL('./unrelated-file.txt', scope).href), undefined);
});
