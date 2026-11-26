// Headless-Chrome smoke run for WaterWatch. No dependencies: a tiny static
// server plus raw CDP over the built-in WebSocket (Node 22+).
// Run: node scripts/browser-smoke.mjs
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdtemp, rm, readdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

if (typeof WebSocket !== 'function') {
  console.error('This script needs the built-in WebSocket client (Node 22 or newer).');
  process.exit(2);
}

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` :: ${detail}` : ''}`);
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- static server ---------- */

const server = createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = join(ROOT, path === '/' ? 'index.html' : path);
    if (![`${ROOT}/index.html`, `${ROOT}/styles.css`].includes(file)
      && !file.startsWith(`${ROOT}/src/`)) throw new Error('path');
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404); res.end('not found');
  }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;

/* ---------- chrome ---------- */

let chrome;
let ws;
let profile;
let dlDir;
let exitCode = 0;

try {
  profile = await mkdtemp(join(tmpdir(), 'ww-chrome-'));
  dlDir = await mkdtemp(join(tmpdir(), 'ww-dl-'));
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
  ws.onmessage = e => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
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
      } catch {
        offOrigin.push(url);
      }
    }
  };

  function send(method, params = {}, sessionId) {
    const id = ++msgId;
    return new Promise((res, rej) => {
      pending.set(id, msg => (msg.error ? rej(new Error(`${method}: ${msg.error.message}`)) : res(msg.result)));
      ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }

  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const cmd = (m, p) => send(m, p, sessionId);

  async function evaluate(expression) {
    const { result, exceptionDetails } = await cmd('Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise: true,
    });
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
    return result.value;
  }

  async function waitFor(expression, timeout = 15000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (await evaluate(expression)) return true;
      await sleep(120);
    }
    return false;
  }

  async function click(selector) {
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
  }

  async function key(name, text) {
    const code = name.length === 1 ? `Key${name.toUpperCase()}` : name;
    const windowsVirtualKeyCode = name === 'ArrowRight' ? 39 : name.toUpperCase().charCodeAt(0);
    await cmd('Input.dispatchKeyEvent', { type: 'keyDown', key: name, code, text, windowsVirtualKeyCode });
    await cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: name, code, windowsVirtualKeyCode });
  }

  function pngSize(buf) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }

  function pdfPages(buf) {
    const text = buf.toString('latin1');
    const direct = (text.match(/\/Type\s*\/Page(?!s)/g) ?? []).length;
    if (direct) return direct;
    const counts = [...text.matchAll(/\/Count\s+(\d+)/g)].map(m => Number(m[1]));
    return counts.length ? Math.max(...counts) : 0;
  }

  const setCsv = text => evaluate(`(() => {
    const ta = document.querySelector('#csv-input');
    ta.value = ${JSON.stringify(text)};
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);

  try {
    for (const domain of ['Page.enable', 'Runtime.enable', 'Network.enable', 'Log.enable', 'DOM.enable']) {
      await cmd(domain);
    }
    await cmd('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await cmd('Page.navigate', { url: `${ORIGIN}/index.html` });
    check('app renders the school preset', await waitFor(
      `document.readyState === 'complete' && document.querySelectorAll('#results-body tr').length === 10`));

    check('action banner present', await evaluate(`document.querySelector('#action h3')?.textContent.length > 0`));
    check('masthead has no tagline', await evaluate(
      `document.querySelector('.masthead h1').nextElementSibling === null || document.querySelector('.masthead h1').nextElementSibling.classList.contains('masthead-side')`));
    check('ten source links rendered', await evaluate(`document.querySelectorAll('#source-list a').length === 10`));
    check('scenario cards state their screened result', await evaluate(
      `[...document.querySelectorAll('#preset-strip .scenario-status')].map(n => n.textContent).join('|') === 'Lead above in 1 of 3 taps|PFAS mixture above benchmark|Boil notice, E. coli present|Within screened benchmarks'`));
    check('readout shows four instrument cells', await evaluate(
      `document.querySelectorAll('#readout .readout-cell').length === 4 && document.querySelector('#readout .readout-n').textContent === '2.46\u00d7'`));
    check('lead row shows ratio gauge and WHO reference', await evaluate(
      `document.querySelector('#results-body tr .ratio-n').textContent === '2.46\u00d7' && document.querySelector('#results-body tr .gauge') !== null && document.querySelector('#results-body tr .ref-who').textContent.includes('WHO 10 ppb')`));
    check('diagnostic pairs the first-draw and flushed taps', await evaluate(
      `document.querySelector('#diagnostic [data-diag="lead-local"]')?.textContent.includes('87% lower') === true`));
    check('row headers use th scope=row', await evaluate(
      `document.querySelectorAll('#results-body th[scope="row"]').length === 10`));
    check('no horizontal overflow at 1280', await evaluate(`document.documentElement.scrollWidth <= 1280`));

    // Preset switch via a real pointer click.
    const stormIndex = await evaluate(`[...document.querySelectorAll('#preset-strip button')].findIndex(b => b.textContent.includes('storm'))`);
    check('storm preset button exists', stormIndex >= 0);
    await click(`#preset-strip button:nth-of-type(${stormIndex + 1})`);
    check('storm preset applies', await waitFor(
      `document.querySelector('#results-caption').textContent.includes('North block kitchen')`));
    check('storm diagnostic orders advisory, fecal, nitrate', await evaluate(
      `[...document.querySelectorAll('#diagnostic [data-diag]')].map(n => n.dataset.diag).join(',') === 'advisory,fecal,nitrate'`));
    check('storm nitrate is above EPA and WHO', await evaluate(
      `[...document.querySelectorAll('#results-body tr')][2].querySelector('.who-status').textContent.trim() === 'above'`));
    check('co-occurrence urgent banner', await evaluate(
      `document.querySelector('#action').className.includes('urgent') && document.querySelector('#action h3').textContent === 'Do not boil this tap water for drinking or infant formula'`));
    check('storm advisory card qualifies boiling with nitrate on screen and print', await evaluate(
      `document.querySelector('#diagnostic [data-diag="advisory"]')?.textContent.includes('boiling does not make this tap water safe for infant formula') && document.querySelector('#print-sheet .ps-diag')?.textContent.includes('boiling does not make this tap water safe for infant formula') && document.querySelector('#print-sheet .ps-diag')?.textContent.includes('hervir no hace que esta agua del grifo sea segura para preparar fórmula infantil')`));

    // Failed import via real click on Apply after editing the textarea.
    await setCsv('tap,advisory,lead_ppb\nBad tap,none,ND');
    await click('#apply');
    check('ND import is refused with row detail', await waitFor(
      `!document.querySelector('#import-errors').hidden && document.querySelector('#import-errors').textContent.includes('Row 2')`));
    check('failed import clears stale results', await evaluate(
      `document.querySelector('#results-caption').textContent === 'No sample loaded.'`));

    // Recover with a real click back to the school preset.
    await click('#preset-strip button:nth-of-type(1)');
    check('recovers after failed import', await waitFor(
      `document.querySelectorAll('#results-body tr').length === 10`));

    // Model modules render for the loaded sample.
    check('hazard index terms render', await evaluate(`document.querySelectorAll('#mixture-body .hi-terms span').length >= 4`));
    check('flush chart has axes and a curve', await evaluate(
      `document.querySelector('.flush-chart polyline.curve') !== null && document.querySelectorAll('.flush-chart .axis').length === 2`));
    check('treatment table has both filters', await evaluate(`document.querySelectorAll('#treatment-body tbody tr').length === 2`));
    check('modeled reductions use assumed-percent suffix', await evaluate(
      `document.querySelector('#treatment-body tbody').textContent.includes('% assumed)')`));

    // Keyboard: move the flush slider with real key events after real focus.
    await click('#flush-minutes');
    const before = await evaluate(`document.querySelector('#flush-body .model-value').textContent`);
    await key('ArrowRight', '');
    const after = await evaluate(`document.querySelector('#flush-body .model-value').textContent`);
    check('flush slider responds to arrow keys', before !== after, `${before} -> ${after}`);

    // Shortcut: a real click enables, then a real 'i' keydown hits a counted
    // click hook on the file input instead of opening a picker.
    await click('#shortcut-toggle');
    await evaluate(`(() => {
      const input = document.querySelector('#file-input');
      window.__wwClicks = 0;
      input.addEventListener('click', e => { e.preventDefault(); window.__wwClicks += 1; });
      document.activeElement?.blur();
      return true;
    })()`);
    await key('i', 'i');
    check('i shortcut triggers file input click', await evaluate(`window.__wwClicks === 1`));
    check('shortcut keydown causes no errors', pageErrors.length === 0 && consoleErrors.length === 0);

    // Editing the textarea invalidates the applied report.
    await setCsv('tap,lead_ppb\nHill tower,5');
    check('edit marks report stale', await waitFor(
      `!document.querySelector('#stale-note').hidden && document.querySelector('#action h3').textContent === 'No applied report'`));
    check('stale report withholds the table', await evaluate(
      `document.querySelector('#results-caption').textContent === 'Report withheld: the applied data changed.' && document.querySelectorAll('#results-body tr').length === 0`));

    // Long lead value keeps the chart grid bounded.
    await setCsv('tap,lead_ppb\nHill tower,999999999.999999999999');
    await click('#apply');
    check('max-width lead reading applies', await waitFor(
      `document.querySelector('#results-body').textContent.includes('999999999.999999999999')`));
    check('flush grid lines stay bounded', await evaluate(
      `document.querySelectorAll('.flush-chart .grid-line').length <= 14`),
      await evaluate(`String(document.querySelectorAll('.flush-chart .grid-line').length)`));

    // UTF-16LE upload through the real file input.
    const fixture = join(profile, 'upload-utf16.csv');
    await writeFile(fixture, Buffer.concat([
      Buffer.from([0xFF, 0xFE]),
      Buffer.from('tap,advisory,lead_ppb\nCistern,boil,12.5', 'utf16le'),
    ]));
    const { root } = await cmd('DOM.getDocument');
    const { nodeId } = await cmd('DOM.querySelector', { nodeId: root.nodeId, selector: '#file-input' });
    await cmd('DOM.setFileInputFiles', { nodeId, files: [fixture] });
    check('utf-16 upload applies', await waitFor(
      `document.querySelector('#results-caption').textContent.includes('Cistern')`));

    // A corrupt upload fails closed and clears the report.
    await writeFile(fixture, Buffer.from([0xFF, 0xFE, 0x61]));
    await cmd('DOM.setFileInputFiles', { nodeId, files: [fixture] });
    check('invalid encoded upload clears report', await waitFor(
      `!document.querySelector('#import-errors').hidden && document.querySelector('#results-body').children.length === 0`));

    // Back to school for the export check.
    await click('#preset-strip button:nth-of-type(1)');
    await waitFor(`document.querySelectorAll('#results-body tr').length === 10`);
    await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dlDir });
    await click('#download-bundle');
    let bundleFile = null;
    for (let i = 0; i < 50 && !bundleFile; i += 1) {
      const names = await readdir(dlDir);
      bundleFile = names.find(n => n.endsWith('.json')) ?? null;
      if (!bundleFile) await sleep(150);
    }
    let bundleOk = false;
    if (bundleFile) {
      const parsed = JSON.parse(await readFile(join(dlDir, bundleFile), 'utf8'));
      bundleOk = /^[0-9a-f]{64}$/.test(parsed.fingerprint) && parsed.payload?.source === 'synthetic';
    }
    check('bundle download contains fingerprint', bundleOk, bundleFile ?? 'no file');
    check('fingerprint shown with SHA-256 prefix', await evaluate(
      `!document.querySelector('#fingerprint').hidden && document.querySelector('#fingerprint').textContent.startsWith('SHA-256 of the canonical payload')`));

    // Print sheet content and scroll-top before screenshots.
    check('print sheet has EN and ES blocks', await evaluate(
      `document.querySelector('#print-sheet [lang="en"] p.ps-headline')?.textContent.length > 0 && document.querySelector('#print-sheet [lang="es"] p.ps-headline')?.textContent.length > 0`));
    check('print sheet is a field audit with readings, sources, and record', await evaluate(
      `document.querySelector('#print-sheet h1').textContent.includes('Community Water Field Audit Sheet') && document.querySelector('#print-sheet h1 [lang="es"]')?.textContent.includes('Hoja comunitaria') && document.querySelectorAll('#print-sheet .ps-table tbody tr').length === 10 && document.querySelectorAll('#print-sheet .ps-diag li').length >= 1 && document.querySelectorAll('#print-sheet .ps-field').length === 4`));
    check('print sheet WHO cells carry units', await evaluate(
      `document.querySelector('#print-sheet .ps-table tbody tr td:last-child').textContent.includes('ppb') && [...document.querySelectorAll('#print-sheet .ps-table tbody tr')][2].querySelector('td:last-child').textContent.includes('mg/L as nitrate')`));
    check('print sheet marks synthetic preset', await evaluate(
      `document.querySelector('#print-sheet').textContent.includes('Synthetic example / Ejemplo sintético')`));

    // Keyboard activation keeps focus on the activated SVG chart row.
    await evaluate(`document.querySelector('[data-focus-control="ratio-lead"]').focus()`);
    await cmd('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 32 });
    await cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 32 });
    check('keyboard Space keeps focus on the activated Lead chart row', await evaluate(
      `document.activeElement?.getAttribute('data-focus-control') === 'ratio-lead' && document.activeElement?.getAttribute('aria-pressed') === 'true' && document.activeElement?.getAttribute('role') === 'button'`),
      await evaluate(`document.activeElement?.getAttribute('data-focus-control') ?? document.activeElement?.tagName`));
    check('Copper is the next chart row after Lead', await evaluate(
      `document.querySelector('[data-focus-control="ratio-lead"]').nextElementSibling?.getAttribute('data-focus-control') === 'ratio-copper'`));

    // Spanish mode localizes the diagnostic instead of silently falling back to English.
    await click('#lab-lang-es');
    check('Spanish diagnostic heading and cards carry lang=es', await waitFor(
      `document.querySelector('#diagnostic h3')?.getAttribute('lang') === 'es' && document.querySelector('#diagnostic h3')?.textContent === 'Fuentes probables y pasos de campo' && [...document.querySelectorAll('#diagnostic .diag')].every(node => node.getAttribute('lang') === 'es')`));
    check('Spanish diagnostic has zero English fallback strings', await evaluate(
      `!/(Likely sources and field steps|Lead points to plumbing near this tap|Share the pair with the water system|Common sources)/.test(document.querySelector('#diagnostic').textContent)`));
    check('lab and SDG headings carry lang=es', await evaluate(
      `document.querySelector('#lab-h')?.getAttribute('lang') === 'es' && document.querySelector('#sdg6-h')?.getAttribute('lang') === 'es'`));
    await click('#lab-lang-en');

    await evaluate('window.scrollTo(0,0)');
    const shot = await cmd('Page.captureScreenshot', { format: 'png' });
    const png = Buffer.from(shot.data, 'base64');
    await writeFile(join(ROOT, 'docs', 'desktop.png'), png);
    const ds = pngSize(png);
    check('desktop screenshot 1280x800', ds.width === 1280 && ds.height === 800, `${ds.width}x${ds.height}`);

    // Mobile viewport on the storm preset.
    await cmd('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await click(`#preset-strip button:nth-of-type(${stormIndex + 1})`);
    check('mobile: storm applied', await waitFor(
      `document.querySelector('#results-caption').textContent.includes('North block kitchen')`));
    await sleep(250);
    check('mobile key action is prominent', await evaluate(
      `!document.querySelector('#mobile-action').hidden && document.querySelector('#mobile-action strong')?.textContent === 'Do not boil this tap water for drinking or infant formula'`));
    check('mobile CTA first action mentions bottled', await evaluate(
      `document.querySelector('#mobile-action p')?.textContent.includes('bottled')`));
    check('no horizontal overflow at 390', await evaluate(`document.documentElement.scrollWidth <= 390`),
      await evaluate(`String(document.documentElement.scrollWidth)`));

    // Print the storm sheet: exact EN and ES co-occurrence copy, one page.
    check('print sheet EN/ES co-occurrence copy', await evaluate(
      `document.querySelector('#print-sheet [lang="en"] p.ps-headline')?.textContent === 'Do not boil this tap water for drinking or infant formula' && document.querySelector('#print-sheet [lang="es"] p.ps-headline')?.textContent === 'No hierva esta agua del grifo para beber ni para preparar fórmula infantil'`));
    await evaluate('window.scrollTo(0,0)');
    const pdf = await cmd('Page.printToPDF', { printBackground: true });
    const pdfBuf = Buffer.from(pdf.data, 'base64');
    check('tap sheet prints to exactly one page', pdfPages(pdfBuf) === 1, `pages=${pdfPages(pdfBuf)}`);

    await evaluate('window.scrollTo(0,0)');
    const mshot = await cmd('Page.captureScreenshot', { format: 'png' });
    const mpng = Buffer.from(mshot.data, 'base64');
    await writeFile(join(ROOT, 'docs', 'advisory.png'), mpng);
    const ms = pngSize(mpng);
    check('mobile screenshot 390x844', ms.width === 390 && ms.height === 844, `${ms.width}x${ms.height}`);

    // Third viewport: tablet width stays inside its layout box.
    await cmd('Emulation.setDeviceMetricsOverride', { width: 768, height: 1024, deviceScaleFactor: 1, mobile: true });
    await sleep(250);
    check('no horizontal overflow at 768', await evaluate(`document.documentElement.scrollWidth <= 768`),
      await evaluate(`String(document.documentElement.scrollWidth)`));

    // Stress case: a valid 100-character tap name and long decimal readings.
    const stressCsv = `tap,advisory,ecoli,lead_ppb,copper_ppb,nitrate_mg_l_as_n,arsenic_ppb,pfoa_ppt,pfos_ppt,pfhxs_ppt,pfna_ppt,genx_ppt,pfbs_ppt,pair_id,draw_type\n${'A'.repeat(100)},none,absent,12.345678901234,1300.000000000001,9.999999999999,10.000000000001,4.000000000001,4.000000000001,10.000000000001,10.000000000001,10.000000000001,2000.000000000001,stress,first-draw`;
    await evaluate(`document.querySelector('#csv-input').value = ${JSON.stringify(stressCsv)}; document.querySelector('#apply').click()`);
    check('100-character stress report applies', await waitFor(
      `document.querySelector('#results-caption')?.textContent.includes('${'A'.repeat(40)}') && document.querySelectorAll('#print-sheet .ps-table tbody tr').length === 10`));
    const stressPdfEn = Buffer.from((await cmd('Page.printToPDF', { printBackground: true })).data, 'base64');
    check('100-character tap stress sheet prints one page in English', pdfPages(stressPdfEn) === 1, `pages=${pdfPages(stressPdfEn)}`);
    await click('#lab-lang-es');
    await waitFor(`document.querySelector('#diagnostic h3')?.getAttribute('lang') === 'es'`);
    const stressPdfEs = Buffer.from((await cmd('Page.printToPDF', { printBackground: true })).data, 'base64');
    check('100-character tap stress sheet prints one page in Spanish', pdfPages(stressPdfEs) === 1, `pages=${pdfPages(stressPdfEs)}`);
    await click('#lab-lang-en');

    // Sparse Spanish audit: exact statuses, EPA/WHO references, print tags, and chart shorthand.
    const localeCsv = 'tap,advisory,ecoli,lead_ppb,copper_ppb,nitrate_mg_l_as_n,arsenic_ppb,pfoa_ppt,pfos_ppt,pfhxs_ppt,pfna_ppt,genx_ppt,pfbs_ppt\nLocalization tap,none,absent,12,1300,10,5,,,2.99,3.99,4.99,0';
    await setCsv(localeCsv);
    await click('#apply');
    check('localization audit sample applies', await waitFor(
      `document.querySelector('#results-caption')?.textContent.includes('Localization tap') && document.querySelectorAll('#results-body tr').length === 10`));
    await click('#lab-lang-es');
    check('Spanish report has zero leftover English benchmark or status labels', await waitFor(`(() => {
      const table = document.querySelector('#results-table');
      const text = [table, document.querySelector('#readout'), document.querySelector('#action'), document.querySelector('#report-notes')]
        .map(node => node?.textContent ?? '').join(' ');
      const required = table?.getAttribute('lang') === 'es'
        && table.textContent.includes('OMS 10 ppb (provisional)')
        && table.textContent.includes('Por encima del nivel de referencia')
        && table.textContent.includes('En el nivel de referencia')
        && table.textContent.includes('Por debajo del nivel de referencia')
        && table.textContent.includes('Sin reportar')
        && table.textContent.includes('Redondeo de la regla')
        && table.textContent.includes('Contado en el Índice de Peligro');
      const forbidden = /(Above benchmark|At benchmark|Below benchmark|Not reported|Mixture screen only|Rule rounding|Counted in the Hazard Index|No individual EPA benchmark|\bWHO\b|\bHI = 1\b|\babove\b|\bbelow\b|\bat\b)/;
      return Boolean(required && !forbidden.test(text) && !text.includes('n/r'));
    })()`));
    check('Spanish screen and print preserve both provisional WHO tags', await evaluate(
      `[...document.querySelectorAll('#results-body .ref-who')].filter(node => node.textContent.includes('(provisional)')).length === 2 && (document.querySelector('#print-sheet .ps-table').textContent.match(/\(provisional\)/g) ?? []).length === 4`));
    check('Spanish lab charts replace HI and n/r shorthand', await evaluate(`(() => {
      const charts = [...document.querySelectorAll('.lab-chart')].map(node => node.textContent).join(' ');
      const lab = document.querySelector('#lab-body')?.textContent ?? '';
      return charts.includes('IP = 1') && charts.includes('n/d') && !charts.includes('HI = 1') && !charts.includes('n/r') && !lab.includes('n/r');
    })()`));
    await click('#lab-lang-en');

    check('zero console errors', consoleErrors.length === 0, consoleErrors.join(' | '));
    check('zero page errors', pageErrors.length === 0, pageErrors.join(' | '));
    check('zero off-origin requests', offOrigin.length === 0, offOrigin.join(' | '));
  } catch (error) {
    check('smoke run completed', false, error.message);
  }
} catch (error) {
  check('smoke run initialized', false, error.message);
} finally {
  try { ws?.close(); } catch { /* already closed */ }
  if (chrome) {
    chrome.kill('SIGTERM');
    await Promise.race([
      new Promise(r => chrome.once('exit', r)),
      sleep(5000),
    ]);
  }
  try { server.close(); } catch { /* not listening */ }
  if (profile) await rm(profile, { recursive: true, force: true }).catch(() => {});
  if (dlDir) await rm(dlDir, { recursive: true, force: true }).catch(() => {});
}

const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
exitCode = failed.length ? 1 : 0;
process.exit(exitCode);
