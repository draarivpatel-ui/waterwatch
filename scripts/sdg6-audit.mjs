// Headless-Chrome CDP audit for the SDG 6 clean-water equity lab.
// Real pointer clicks (Input.dispatchMouseEvent) on chips and SVG markers,
// real key events on a focused marker, reload-restore of the ww= hash, one
// audited JSON download routed into a throwaway /tmp directory.
// Run: node scripts/sdg6-audit.mjs
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, rm, readdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { join, extname, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createScratchDir, isCreatedScratchDir } from './scratch-dir.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
};

if (typeof WebSocket !== 'function') {
  console.error('This script needs the built-in WebSocket client (Node 22 or newer).');
  process.exit(2);
}

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` :: ${detail}` : ''}`);
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function removeCreatedScratchDir(target) {
  if (!isCreatedScratchDir(target)) return;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await rm(target, { recursive: true, force: true }).catch(() => {});
    if (!existsSync(target)) return;
    await sleep(100);
  }
}

const server = createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = join(ROOT, path === '/' ? 'index.html' : path);
    if (![`${ROOT}/index.html`, `${ROOT}/styles.css`].includes(file)
      && !file.startsWith(`${ROOT}/src/`)) throw new Error('path');
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404); res.end('not found');
  }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;

let chrome;
let ws;
let profile;
let dlDir;

try {
  profile = createScratchDir('waterwatch-smoke-sdg6-profile-', process.env.WW_CHROME_USER_DATA_DIR);
  dlDir = createScratchDir('waterwatch-smoke-sdg6-download-', process.env.WW_DOWNLOAD_DIR);
  chrome = spawn(CHROME, [
    '--headless=new', '--mute-audio', '--disable-gpu', '--no-first-run',
    '--no-default-browser-check', '--hide-crash-restore-bubble',
    `--user-data-dir=${profile}`, '--remote-debugging-port=0', 'about:blank',
  ], { stdio: 'ignore' });

  const portFile = join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 100 && !existsSync(portFile); i += 1) await sleep(150);
  if (!existsSync(portFile)) throw new Error('Chrome did not open DevTools');
  const [wsPort, wsPath] = readFileSync(portFile, 'utf8').trim().split('\n');
  const version = await (await fetch(`http://127.0.0.1:${wsPort}/json/version`)).json();
  ws = new WebSocket(version.webSocketDebuggerUrl ?? `ws://127.0.0.1:${wsPort}${wsPath}`);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  let msgId = 0;
  const pending = new Map();
  const consoleErrors = [];
  const pageErrors = [];
  const offOrigin = [];
  const loadWaiters = [];
  ws.onmessage = e => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
    if (msg.method === 'Page.loadEventFired') loadWaiters.splice(0).forEach(fn => fn());
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      consoleErrors.push(msg.params.args?.map(a => a.value ?? a.description).join(' '));
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      pageErrors.push(msg.params.exceptionDetails?.exception?.description ?? msg.params.exceptionDetails?.text);
    }
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
      consoleErrors.push(msg.params.entry.text);
    }
    if (msg.method === 'Network.requestWillBeSent') {
      const url = msg.params.request.url;
      if (/^(about:|devtools:|blob:|data:|chrome:)/.test(url)) return;
      try {
        if (new URL(url).origin !== ORIGIN) offOrigin.push(url);
      } catch { offOrigin.push(url); }
    }
  };

  const send = (method, params = {}, sessionId) => {
    const id = ++msgId;
    return new Promise((res, rej) => {
      pending.set(id, msg => (msg.error ? rej(new Error(`${method}: ${msg.error.message}`)) : res(msg.result)));
      ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  };

  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const cmd = (m, p) => send(m, p, sessionId);

  const evaluate = async expression => {
    const { result, exceptionDetails } = await cmd('Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise: true,
    });
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
    return result.value;
  };

  const waitFor = async (expression, timeout = 15000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      try {
        if (await evaluate(expression)) return true;
      } catch { /* navigation may destroy the context mid-poll */ }
      await sleep(120);
    }
    return false;
  };

  const click = async selector => {
    const box = await evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      el.scrollIntoView({ block: 'center', inline: 'center' });
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      const hit = document.elementFromPoint(x, y);
      return hit && el.contains(hit) ? { x, y } : null;
    })()`);
    if (!box) throw new Error(`no clickable element ${selector}`);
    await cmd('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 });
    await cmd('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 });
  };

  const pressKey = async (key, text = '') => {
    const code = key.length === 1 ? `Key${key.toUpperCase()}` : key;
    const windowsVirtualKeyCode = key === 'Enter' ? 13 : key === ' ' ? 32 : key.toUpperCase().charCodeAt(0);
    await cmd('Input.dispatchKeyEvent', { type: 'keyDown', key, code, text, windowsVirtualKeyCode });
    await cmd('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode });
  };

  const waitLoad = () => new Promise(res => {
    loadWaiters.push(res);
    setTimeout(res, 10000);
  });

  for (const domain of ['Page.enable', 'Runtime.enable', 'Network.enable', 'Log.enable', 'DOM.enable']) {
    await cmd(domain);
  }
  await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dlDir });
  await cmd('Page.navigate', { url: `${ORIGIN}/index.html` });
  check('app and SDG 6 lab render', await waitFor(
    `document.readyState === 'complete' && !document.getElementById('sdg6').hidden && document.querySelectorAll('#sdg6 .sdg6-card').length === 3`));

  for (const [width, height] of [[1440, 900], [390, 844]]) {
    const tag = `${width}x${height}`;
    await cmd('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 700 });

    for (const lang of ['en', 'es']) {
      await click(`#lab-lang-${lang}`);
      const isEs = lang === 'es';
      check(`${tag} ${lang}: heading localized`, await waitFor(
        `document.getElementById('sdg6-h').textContent === '${isEs ? 'Laboratorio de equidad de agua potable ODS 6' : 'SDG 6 clean-water equity lab'}'`));
      check(`${tag} ${lang}: three indicator cards, five markers`, await evaluate(
        `document.querySelectorAll('#sdg6 .sdg6-card').length === 3 && document.querySelectorAll('#sdg6 .sdg6-marker').length === 5 && document.querySelectorAll('#sdg6 .sdg6-plan tbody tr').length === 5`));

      // Real pointer click on the piped source chip.
      const piped = `[data-sdg6-value="piped"]`;
      await click(piped);
      check(`${tag} ${lang}: real click presses the source chip`, await waitFor(
        `document.querySelector('${piped}').getAttribute('aria-pressed') === 'true'`));
      check(`${tag} ${lang}: hash encodes state`, await evaluate(`location.hash.startsWith('#ww=')`));

      // Real pointer click on the $2,500 budget chip.
      const budgetIdx = await evaluate(`[...document.querySelectorAll('[data-sdg6-budget]')].findIndex(b => b.getAttribute('data-sdg6-budget') === '2500')`);
      await click(`[data-sdg6-budget="2500"]`);
      check(`${tag} ${lang}: real click on the budget chip`, budgetIdx >= 0 && await waitFor(
        `document.querySelector('[data-sdg6-budget="2500"]').getAttribute('aria-pressed') === 'true'`));

      // Real pointer click on an SVG marker (hits the adaptive hit circle).
      await evaluate(`document.querySelector('[data-sdg6-marker="biosand"]').scrollIntoView({ block: 'center' })`);
      await click(`[data-sdg6-marker="biosand"] .sdg6-dot`);
      check(`${tag} ${lang}: marker click shows focus detail`, await waitFor(
        `document.querySelector('#sdg6 [data-sdg6-focus="biosand"]') !== null`));

      // Real key events on a focused marker activate it.
      await evaluate(`document.querySelector('[data-sdg6-marker="sodis"]').focus()`);
      check(`${tag} ${lang}: marker is keyboard focusable`, await evaluate(
        `document.activeElement === document.querySelector('[data-sdg6-marker="sodis"]') && document.querySelector('[data-sdg6-marker="sodis"]').getAttribute('tabindex') === '0'`));
      await pressKey('Enter', '\r');
      check(`${tag} ${lang}: Enter on a marker focuses its row`, await waitFor(
        `document.querySelector('#sdg6 [data-sdg6-focus="sodis"]') !== null`));

      check(`${tag} ${lang}: hit radii are adaptive and generous`, await evaluate(
        `[...document.querySelectorAll('#sdg6 .sdg6-hit')].every(c => Number(c.getAttribute('r')) >= 12)`));

      check(`${tag} ${lang}: no horizontal overflow`, await evaluate(
        `document.documentElement.scrollWidth <= ${width}`),
        await evaluate(`String(document.documentElement.scrollWidth)`));
      check(`${tag} ${lang}: chart fits the viewport`, await evaluate(
        `document.querySelector('#sdg6 .sdg6-chart').getBoundingClientRect().width <= ${width}`));

      // ES copy coverage inside the module.
      if (isEs) {
        check(`${tag} es: interventions localized`, await evaluate(
          `document.querySelector('#sdg6').textContent.includes('Ósmosis inversa y carbón') && document.querySelector('#sdg6').textContent.includes('persona-años')`));
      }
    }

    // Reload-restore: hash state survives a real reload (checked once per viewport, in ES).
    await waitFor(`location.hash.startsWith('#ww=')`);
    const reloaded = waitLoad();
    await cmd('Page.reload');
    await reloaded;
    check(`${tag}: state restores after reload`, await waitFor(
      `document.getElementById('sdg6-h') && document.getElementById('sdg6-h').textContent === 'Laboratorio de equidad de agua potable ODS 6' && document.querySelector('#sdg6 [data-sdg6-focus="sodis"]') !== null && document.querySelector('[data-sdg6-budget="2500"]').getAttribute('aria-pressed') === 'true'`, 20000));
  }

  // Audited JSON brief download into the throwaway directory.
  const jsonTagged = await evaluate(`(() => {
    const b = [...document.querySelectorAll('#lab button')].find(x => x.textContent.trim() === 'JSON');
    if (!b) return false;
    b.setAttribute('data-audit-pick', 'json');
    return true;
  })()`);
  check('JSON brief button exists', jsonTagged);
  await click(`#lab [data-audit-pick="json"]`);
  let briefFile = null;
  for (let i = 0; i < 50 && !briefFile; i += 1) {
    const names = await readdir(dlDir);
    briefFile = names.find(n => n.endsWith('.json')) ?? null;
    if (!briefFile) await sleep(150);
  }
  let briefOk = false;
  if (briefFile) {
    const parsed = JSON.parse(await readFile(join(dlDir, briefFile), 'utf8'));
    briefOk = /^[0-9a-f]{64}$/.test(parsed.fingerprint)
      && parsed.payload?.sdg6?.schema === 'waterwatch-sdg6/v1'
      && parsed.payload.sdg6.plan.rows.length === 5
      && parsed.payload.state.sdg?.budget === 2500;
  }
  check('JSON brief download carries the sdg6 block and fingerprint', briefOk, briefFile ?? 'no file');

  // In-page self-tests include and pass the sdg6 block.
  const testsTagged = await evaluate(`(() => {
    const b = [...document.querySelectorAll('#lab button')].find(x => /self-tests|autopruebas/i.test(x.textContent));
    if (!b) return false;
    b.setAttribute('data-audit-pick', 'tests');
    return true;
  })()`);
  check('self-tests button exists', testsTagged);
  await click(`#lab [data-audit-pick="tests"]`);
  check('in-page self-tests pass including sdg6', await waitFor(
    `document.querySelector('#lab .lab-tests') && document.querySelector('#lab .lab-tests').textContent.includes('sdg6-planner-micro-grant') && document.querySelectorAll('#lab .lab-tests .lab-test-bad').length === 0`, 20000));

  check('zero console errors', consoleErrors.length === 0, consoleErrors.join(' | '));
  check('zero page exceptions', pageErrors.length === 0, pageErrors.join(' | '));
  check('zero off-origin requests', offOrigin.length === 0, offOrigin.join(' | '));
} catch (error) {
  check('sdg6 audit completed', false, error.message);
} finally {
  try { ws?.close(); } catch { /* already closed */ }
  if (chrome) {
    chrome.kill('SIGTERM');
    await Promise.race([new Promise(r => chrome.once('exit', r)), sleep(5000)]);
  }
  try { server.close(); } catch { /* not listening */ }
  await removeCreatedScratchDir(profile);
  await removeCreatedScratchDir(dlDir);
}

const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
