// Minimal Chrome DevTools Protocol client with no dependencies, shared by the target
// compiler and the end-to-end test. It drives the Chrome or Edge already installed.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);

export function findBrowser() {
  return CANDIDATES.find((path) => existsSync(path));
}

export const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

// Rejects if `promise` takes longer than `ms`. The timer is cleared either way, so a
// finished run never sits idle waiting for it.
export function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, fail) => {
    timer = setTimeout(() => fail(new Error(`Timed out ${label}`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Polls `fn` until it returns something other than undefined. Errors from `fn` propagate.
export async function waitFor(fn, { timeout = 30000, interval = 100, label = 'condition' } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = await fn();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
    await sleep(interval);
  }
}

async function removeDir(dir) {
  // Chrome releases its profile files a moment after it exits.
  for (let attempt = 0; ; attempt++) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return;
    } catch {
      // A leftover temp folder is not worth failing the run over.
      if (attempt >= 10) return;
      await sleep(300);
    }
  }
}

export function connect(webSocketUrl) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(webSocketUrl);
    const pending = new Map();
    const listeners = new Map();
    let nextId = 0;

    socket.onopen = () => resolve({
      send(method, params = {}) {
        return new Promise((done, fail) => {
          const id = ++nextId;
          pending.set(id, { done, fail });
          socket.send(JSON.stringify({ id, method, params }));
        });
      },
      on(method, handler) {
        if (!listeners.has(method)) listeners.set(method, new Set());
        listeners.get(method).add(handler);
        return () => listeners.get(method).delete(handler);
      },
      close: () => socket.close(),
    });
    socket.onerror = () => reject(new Error(`Cannot connect to ${webSocketUrl}`));
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      const waiting = pending.get(message.id);
      if (waiting) {
        pending.delete(message.id);
        if (message.error) waiting.fail(new Error(message.error.message));
        else waiting.done(message.result);
      } else {
        for (const handler of listeners.get(message.method) || []) handler(message.params);
      }
    };
  });
}

// Runs `expression` in the page and returns its JSON value; awaits promises it returns.
export async function evaluate(client, expression) {
  const { result, exceptionDetails } = await client.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (exceptionDetails) {
    throw new Error(exceptionDetails.exception?.description || exceptionDetails.text);
  }
  return result.value;
}

// Waits until the page itself reports that it is the new document and fully loaded. The
// load event alone is not enough: the blank page opened first can fire it late.
export async function navigate(client, url) {
  await client.send('Page.navigate', { url });
  await waitFor(
    () => evaluate(client, `location.href === ${JSON.stringify(url)} && document.readyState === 'complete' ? true : undefined`),
    { timeout: 60000, label: `loading ${url}` },
  );
}

export async function setViewport(client, width, height) {
  await client.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
}

// Launches a browser with a throwaway profile and returns a client for a fresh page.
// `messages` collects console output and uncaught exceptions from the page.
export async function launchBrowser({ url, headless = true, args = [], width = 1280, height = 720 } = {}) {
  const executable = findBrowser();
  if (!executable) throw new Error('Chrome or Edge not found. Set CHROME_PATH to the browser executable.');

  const profileDir = mkdtempSync(join(tmpdir(), 'quadro-ar-chrome-'));
  const proc = spawn(executable, [
    '--remote-debugging-port=0',
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-sync',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    `--window-size=${width},${height}`,
    ...(headless ? ['--headless=new'] : []),
    ...args,
    'about:blank',
  ], { stdio: 'ignore' });

  const portFile = join(profileDir, 'DevToolsActivePort');
  const port = await waitFor(() => {
    if (proc.exitCode !== null) throw new Error(`Browser exited with code ${proc.exitCode}`);
    return existsSync(portFile) ? Number(readFileSync(portFile, 'utf8').split('\n')[0]) || undefined : undefined;
  }, { label: 'the browser DevTools port' });

  const origin = `http://127.0.0.1:${port}`;
  const target = await waitFor(async () => {
    const response = await fetch(`${origin}/json/new?about:blank`, { method: 'PUT' }).catch(() => null);
    return response?.ok ? response.json() : undefined;
  }, { label: 'a browser page' });

  const client = await connect(target.webSocketDebuggerUrl);
  await client.send('Page.enable');
  await client.send('Runtime.enable');
  await setViewport(client, width, height);

  const messages = [];
  const text = (args) => args.map((arg) => arg.value ?? arg.description ?? '').join(' ');
  client.on('Runtime.consoleAPICalled', ({ type, args }) => messages.push({ type, text: text(args) }));
  client.on('Runtime.exceptionThrown', ({ exceptionDetails }) => {
    messages.push({ type: 'exception', text: exceptionDetails.exception?.description || exceptionDetails.text });
  });

  const close = async () => {
    client.close();
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      proc.kill('SIGTERM');
    }
    await removeDir(profileDir);
  };

  if (url) await navigate(client, url);
  return { client, messages, close };
}
