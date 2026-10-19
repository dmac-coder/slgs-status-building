// Full-page screenshot via the installed Chrome over the DevTools Protocol.
// Usage: node screenshot.mjs <url> [label] [viewportWidth]
// Saves to ./temporary screenshots/screenshot-N[-label].png (auto-incremented).
import { spawn } from 'node:child_process';
import { mkdirSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import net from 'node:net';
import http from 'node:http';

const url = process.argv[2] || 'http://localhost:3000';
const label = process.argv[3] || '';
const width = parseInt(process.argv[4] || '1440', 10);

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find(p => existsSync(p));
if (!CHROME) { console.error('No Chrome/Edge found'); process.exit(1); }

const outDir = join(process.cwd(), 'temporary screenshots');
mkdirSync(outDir, { recursive: true });

function nextName() {
  const nums = readdirSync(outDir)
    .map(f => (f.match(/^screenshot-(\d+)/) || [])[1])
    .filter(Boolean).map(Number);
  const n = (nums.length ? Math.max(...nums) : 0) + 1;
  return `screenshot-${n}${label ? '-' + label : ''}.png`;
}

const freePort = () => new Promise(res => {
  const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => res(p)); });
});
const getJSON = u => new Promise((res, rej) => {
  http.get(u, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d))); }).on('error', rej);
});
const waitPort = async (port) => {
  for (let i = 0; i < 100; i++) {
    try { await getJSON(`http://127.0.0.1:${port}/json/version`); return; }
    catch { await new Promise(r => setTimeout(r, 100)); }
  }
  throw new Error('Chrome DevTools did not come up');
};

const port = await freePort();
const userDir = join(process.env.TEMP || '.', `slgs-chrome-${port}`);
const chrome = spawn(CHROME, [
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${userDir}`,
  '--headless=new', '--disable-gpu', '--hide-scrollbars',
  `--window-size=${width},1000`, '--no-first-run', '--no-default-browser-check',
  'about:blank',
], { stdio: 'ignore' });

try {
  await waitPort(port);
  const targets = await getJSON(`http://127.0.0.1:${port}/json/list`);
  const pageTarget = targets.find(t => t.type === 'page') || targets[0];
  const webSocketDebuggerUrl = pageTarget.webSocketDebuggerUrl;
  // Minimal CDP client over the built-in global WebSocket (Node 22+)
  const ws = new WebSocket(webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const mid = ++id; pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  const asText = async d => (typeof d === 'string') ? d : (d.text ? await d.text() : Buffer.from(d).toString());
  await new Promise(r => ws.addEventListener('open', r, { once: true }));
  ws.addEventListener('message', async ev => {
    const m = JSON.parse(await asText(ev.data));
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id); pending.delete(m.id);
      m.error ? reject(new Error(m.error.message)) : resolve(m.result);
    }
  });

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 2, mobile: false });
  await send('Page.navigate', { url });
  await new Promise(r => setTimeout(r, 2200)); // fonts, layout

  // Scroll through the page so scroll-triggered reveals fire, then return to top.
  await send('Runtime.evaluate', {
    awaitPromise: true,
    expression: `(async () => {
      const h = document.body.scrollHeight;
      for (let y = 0; y < h; y += 500) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 55)); }
      document.querySelectorAll('.reveal').forEach(e => e.classList.add('in'));
      window.scrollTo(0, 0);
      await new Promise(r => setTimeout(r, 500));
    })()`,
  });

  const evalRes = await send('Runtime.evaluate', {
    expression: 'Math.ceil(Math.max(document.body.scrollHeight, document.documentElement.scrollHeight))',
    returnByValue: true,
  });
  const h = (evalRes && evalRes.result && evalRes.result.value) || 3000;
  // Keep the viewport height fixed (so vh units stay correct) and capture beyond it via clip.
  const { data } = await send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
    clip: { x: 0, y: 0, width, height: h, scale: 1 },
  });
  const file = join(outDir, nextName());
  writeFileSync(file, Buffer.from(data, 'base64'));
  console.log('Saved: ' + file);
  ws.close();
} finally {
  chrome.kill();
}
