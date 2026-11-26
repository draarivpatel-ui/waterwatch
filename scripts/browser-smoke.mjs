// Headless-Chrome smoke run for WaterWatch. No dependencies: a tiny static
// server plus raw CDP over the built-in WebSocket (Node 22+).
// Run: node scripts/browser-smoke.mjs
import { spawn, execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdtemp, mkdir, rm, readdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

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

const execFileAsync = promisify(execFile);
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` :: ${detail}` : ''}`);
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function freshDir(path) {
  const target = resolve(path);
  const allowedTmp = resolve(tmpdir());
  const allowedAgentWork = resolve('/private/tmp/agent-work');
  if (!target.startsWith(`${allowedTmp}/`) && !target.startsWith(`${allowedAgentWork}/`)) {
    throw new Error(`refusing to reset a directory outside temporary scratch space: ${target}`);
  }
  await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });
  return target;
}

async function workDir(prefix, override) {
  return override ? freshDir(override) : mkdtemp(join(tmpdir(), prefix));
}

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
  profile = await workDir('ww-chrome-', process.env.WW_CHROME_USER_DATA_DIR);
  dlDir = await workDir('ww-dl-', process.env.WW_DOWNLOAD_DIR);
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

  function ppmEdgeInk(buf) {
    const head = buf.subarray(0, 120).toString('latin1').match(/^P6\s+(\d+)\s+(\d+)\s+(\d+)\s/);
    if (!head) return { error: 'unreadable raster' };
    const width = Number(head[1]);
    const height = Number(head[2]);
    const maxval = Number(head[3]);
    const offset = head[0].length;
    if (maxval !== 255 || buf.length < offset + width * height * 3) return { error: 'bad raster shape' };
    const band = 6;
    let ink = 0;
    const marked = (x, y) => {
      const at = offset + (y * width + x) * 3;
      return buf[at] < 250 || buf[at + 1] < 250 || buf[at + 2] < 250;
    };
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (x < band || x >= width - band || y < band || y >= height - band) {
          if (marked(x, y)) ink += 1;
        }
      }
    }
    return { ink, width, height, band };
  }

  async function inspectPdf(buf, label) {
    const safe = label.replace(/[^a-z0-9-]+/gi, '-');
    const pdfPath = join(dlDir, `${safe}.pdf`);
    const rasterPrefix = join(dlDir, `${safe}-page`);
    await writeFile(pdfPath, buf);
    const out = { pages: pdfPages(buf), text: '', edge: { error: 'not run' } };
    try {
      const textRun = await execFileAsync('pdftotext', ['-layout', pdfPath, '-'], { maxBuffer: 8 * 1024 * 1024 });
      out.text = textRun.stdout;
    } catch (error) {
      out.textError = error.message;
    }
    try {
      await execFileAsync('pdftoppm', ['-f', '1', '-singlefile', '-r', '72', pdfPath, rasterPrefix], { maxBuffer: 1024 * 1024 });
      out.edge = ppmEdgeInk(await readFile(`${rasterPrefix}.ppm`));
    } catch (error) {
      out.edge = { error: error.message };
    }
    return out;
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
    const pdfInfo = await inspectPdf(pdfBuf, 'tap-sheet');
    check('tap sheet prints to exactly one page', pdfInfo.pages === 1, `pages=${pdfInfo.pages}`);
    check('tap sheet PDF has zero edge ink', pdfInfo.edge.ink === 0, JSON.stringify(pdfInfo.edge));

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
    if (process.env.WW_AUDIT_DIR) await writeFile(join(process.env.WW_AUDIT_DIR, 'waterwatch-stress-en.pdf'), stressPdfEn);
    const stressInfoEn = await inspectPdf(stressPdfEn, 'stress-en');
    check('100-character tap stress sheet prints one page in English', stressInfoEn.pages === 1, `pages=${stressInfoEn.pages}`);
    check('English stress PDF has zero edge ink', stressInfoEn.edge.ink === 0, JSON.stringify(stressInfoEn.edge));
    await click('#lab-lang-es');
    await waitFor(`document.querySelector('#diagnostic h3')?.getAttribute('lang') === 'es'`);
    const stressPdfEs = Buffer.from((await cmd('Page.printToPDF', { printBackground: true })).data, 'base64');
    if (process.env.WW_AUDIT_DIR) await writeFile(join(process.env.WW_AUDIT_DIR, 'waterwatch-stress-es.pdf'), stressPdfEs);
    const stressInfoEs = await inspectPdf(stressPdfEs, 'stress-es');
    check('100-character tap stress sheet prints one page in Spanish', stressInfoEs.pages === 1, `pages=${stressInfoEs.pages}`);
    check('Spanish stress PDF has zero edge ink', stressInfoEs.edge.ink === 0, JSON.stringify(stressInfoEs.edge));
    await click('#lab-lang-en');


    // PFAS classification regression: one shared class reaches panel, diagnostic, and print.
    for (const item of [
      {
        name: 'below-quantitation', values: '2.99,3.99,4.99,0', raw: '1.197',
        en: 'below-quantitation screening signal', es: 'señal de evaluación por debajo del nivel de cuantificación',
      },
      {
        name: 'combined', values: '3.00,3.99,4.99,0', raw: '1.198',
        en: 'combined screening signal (one quantified constituent plus below-quantitation terms)',
        es: 'señal de evaluación combinada (un constituyente cuantificado más términos por debajo del nivel de cuantificación)',
      },
    ]) {
      await setCsv(`tap,pfhxs_ppt,pfna_ppt,genx_ppt,pfbs_ppt\nPFAS ${item.name},${item.values}`);
      await click('#apply');
      check(`PFAS ${item.name} sample applies`, await waitFor(
        `document.querySelector('#results-caption')?.textContent.includes('PFAS ${item.name}')`));
      check(`PFAS ${item.name} English panel card and print agree`, await evaluate(`(() => {
        const panel = document.querySelector('#mixture-body')?.textContent ?? '';
        const diag = document.querySelector('#diagnostic [data-diag="pfas-mixture"]')?.textContent ?? '';
        const print = document.querySelector('#print-sheet .ps-math')?.textContent ?? '';
        return panel.includes(${JSON.stringify(item.en)}) && diag.includes(${JSON.stringify(item.en)})
          && print.includes(${JSON.stringify(item.en)}) && print.includes(${JSON.stringify(item.raw)});
      })()`));
      await click('#lab-lang-es');
      check(`PFAS ${item.name} Spanish panel card and print agree`, await waitFor(`(() => {
        const panel = document.querySelector('#mixture-body')?.textContent ?? '';
        const diag = document.querySelector('#diagnostic [data-diag="pfas-mixture"]')?.textContent ?? '';
        const print = document.querySelector('#print-sheet .ps-math')?.textContent ?? '';
        return panel.includes(${JSON.stringify(item.es)}) && diag.includes(${JSON.stringify(item.es)})
          && print.includes(${JSON.stringify(item.es)}) && !panel.includes('single-compound screening signal');
      })()`));
      await click('#lab-lang-en');
    }

    // PFHxS at its quantitation level with every other mixture term blank is lone evidence, not a combined sum.
    await setCsv('tap,pfhxs_ppt,pfna_ppt,genx_ppt,pfbs_ppt\nPFAS lone reported,3,,,');
    await click('#apply');
    check('PFAS lone-reported sample applies', await waitFor(
      `document.querySelector('#results-caption')?.textContent.includes('PFAS lone reported')`));
    check('PFAS lone-reported English screen and print never claim combined terms', await evaluate(`(() => {
      const panel = document.querySelector('#mixture-body')?.textContent ?? '';
      const diag = document.querySelector('#diagnostic')?.textContent ?? '';
      const print = document.querySelector('#print-sheet')?.textContent ?? '';
      const all = [panel, diag, print].join(' ');
      return panel.includes('single-compound screening sum')
        && print.includes('single-compound screening sum')
        && document.querySelector('#diagnostic [data-diag="pfas-mixture"]') === null
        && !/combined screening|below-quantitation terms|señal de evaluación combinada|términos por debajo del nivel de cuantificación/i.test(all);
    })()`));
    await click('#lab-lang-es');
    check('PFAS lone-reported Spanish screen and print never claim combined terms', await waitFor(`(() => {
      const panel = document.querySelector('#mixture-body')?.textContent ?? '';
      const diag = document.querySelector('#diagnostic')?.textContent ?? '';
      const print = document.querySelector('#print-sheet')?.textContent ?? '';
      const all = [panel, diag, print].join(' ');
      return panel.includes('suma de evaluación de un solo compuesto')
        && print.includes('suma de evaluación de un solo compuesto')
        && document.querySelector('#diagnostic [data-diag="pfas-mixture"]') === null
        && !/combined screening|below-quantitation terms|señal de evaluación combinada|términos por debajo del nivel de cuantificación/i.test(all);
    })()`));
    const lonePfasPdf = Buffer.from((await cmd('Page.printToPDF', { printBackground: true })).data, 'base64');
    const lonePfasInfo = await inspectPdf(lonePfasPdf, 'pfas-lone-reported');
    const lonePfasText = lonePfasInfo.text.replace(/\s+/g, ' ');
    check('PFAS lone-reported bilingual PDF stays one page with zero edge ink', lonePfasInfo.pages === 1 && lonePfasInfo.edge.ink === 0,
      `pages=${lonePfasInfo.pages} edge=${JSON.stringify(lonePfasInfo.edge)}`);
    check('PFAS lone-reported PDF never says combined or below-quantitation contribution', !/combined screening|below-quantitation terms|señal de evaluación combinada|términos por debajo del nivel de cuantificación/i.test(lonePfasText)
      && lonePfasText.includes('single-compound screening sum'),
      lonePfasText.slice(0, 120));
    await click('#lab-lang-en');

    // Paired lead regression: each pair keeps one interpretation on both draws in EN and ES.
    const pairCsv = `tap,lead_ppb,pair_id,draw_type
Drop first,30,pair-drop,first-draw
Drop flushed,12,pair-drop,flushed
Rise first,2,pair-rise,first-draw
Rise flushed,24,pair-rise,flushed
Below first,10,pair-below,first-draw
Below flushed,6,pair-below,flushed`;
    await setCsv(pairCsv);
    await click('#apply');
    check('three paired-lead cases apply', await waitFor(`document.querySelectorAll('#tap-list li').length === 6`));
    for (const spec of [
      { rows: [0, 1], id: 'lead-local-shared', en: 'near the tap or fixture', es: 'plomería cercana al grifo o al accesorio', name: '30 to 12' },
      { rows: [2, 3], id: 'lead-rises', en: 'flushed draw rose above the first draw', es: 'extracción de purga aumentó por encima de la primera extracción', name: '2 to 24' },
      { rows: [4, 5], id: 'lead-drops-below', en: 'flushed sample dropped below the benchmark', es: 'muestra de purga bajó por debajo del nivel de referencia', name: '10 to 6' },
    ]) {
      for (const lang of ['en', 'es']) {
        await click(`#lab-lang-${lang}`);
        const texts = [];
        for (const row of spec.rows) {
          await click(`#tap-list li:nth-of-type(${row + 1}) button`);
          const text = await evaluate(`document.querySelector('#diagnostic [data-diag="${spec.id}"]')?.textContent ?? ''`);
          check(`${spec.name} pair present on row ${row + 1} in ${lang}`, text.includes(lang === 'es' ? spec.es : spec.en), text.slice(0, 90));
          texts.push(text);
          const print = await evaluate(`document.querySelector('#print-sheet .ps-diag')?.textContent ?? ''`);
          check(`${spec.name} bilingual print agrees on row ${row + 1}`, print.includes(spec.en) && print.includes(spec.es));
        }
        check(`${spec.name} pair interpretation identical across draws in ${lang}`, texts[0] === texts[1] && texts[0].length > 0);
      }
      await click('#lab-lang-en');
    }

    // Repeated flushed draws use one conservative pair reading on every row.
    const repeatedPairCsv = `tap,lead_ppb,pair_id,draw_type
Repeat first,30,pair-repeat,first-draw
Repeat low flush,3,pair-repeat,flushed
Repeat high flush,12,pair-repeat,flushed`;
    await setCsv(repeatedPairCsv);
    await click('#apply');
    check('repeated-draw pair applies', await waitFor(`document.querySelectorAll('#tap-list li').length === 3`));
    for (const lang of ['en', 'es']) {
      await click(`#lab-lang-${lang}`);
      const screenTexts = [];
      const printTexts = [];
      for (const row of [0, 1, 2]) {
        await click(`#tap-list li:nth-of-type(${row + 1}) button`);
        const screenText = await evaluate(`document.querySelector('#diagnostic [data-diag="lead-local-shared"]')?.textContent ?? ''`);
        const printText = await evaluate(`document.querySelector('#print-sheet .ps-diag')?.textContent ?? ''`);
        check(`repeated-draw pair row ${row + 1} uses the high flush in ${lang}`, screenText.includes(lang === 'es'
          ? 'a 12 ppb en la extracción de purga en Repeat high flush'
          : 'to 12 ppb in the flushed draw at Repeat high flush'), screenText.slice(0, 100));
        check(`repeated-draw pair row ${row + 1} notes the repeated group in ${lang}`, screenText.includes(lang === 'es'
          ? '1 fila de primera extracción y 2 filas de purga'
          : '1 first-draw row and 2 flushed rows'));
        check(`repeated-draw bilingual print row ${row + 1} matches`, printText.includes('to 12 ppb in the flushed draw at Repeat high flush')
          && printText.includes('a 12 ppb en la extracción de purga en Repeat high flush')
          && printText.includes('1 first-draw row and 2 flushed rows')
          && printText.includes('1 fila de primera extracción y 2 filas de purga'));
        screenTexts.push(screenText);
        printTexts.push(printText);
      }
      check(`repeated-draw screen interpretation identical on all three rows in ${lang}`, screenTexts[0] === screenTexts[1] && screenTexts[0] === screenTexts[2] && screenTexts[0].length > 0);
      check(`repeated-draw print interpretation identical on all three rows in ${lang}`, printTexts[0] === printTexts[1] && printTexts[0] === printTexts[2] && printTexts[0].length > 0);
    }
    await click('#lab-lang-en');

    // Three urgent findings cannot push the paired-lead guidance off either draw's one-page PDF.
    const crowdedCsv = `tap,advisory,ecoli,lead_ppb,nitrate_mg_l_as_n,pair_id,draw_type
Crowded first,boil,present,30,20,crowded,first-draw
Crowded flushed,boil,present,12,20,crowded,flushed`;
    await setCsv(crowdedCsv);
    await click('#apply');
    check('crowded urgent paired-lead case applies', await waitFor(`document.querySelectorAll('#tap-list li').length === 2`));
    for (const lang of ['en', 'es']) {
      await click(`#lab-lang-${lang}`);
      for (const row of [0, 1]) {
        await click(`#tap-list li:nth-of-type(${row + 1}) button`);
        check(`crowded case diagnostic order row ${row + 1} in ${lang}`, await evaluate(
          `[...document.querySelectorAll('#diagnostic [data-diag]')].map(n => n.dataset.diag).join(',') === 'advisory,fecal,nitrate,lead-local-shared'`));
        check(`crowded case print keeps three urgent findings plus compact pair note row ${row + 1} in ${lang}`, await evaluate(`(() => {
          const diag = document.querySelector('#print-sheet .ps-diag')?.textContent ?? '';
          const note = document.querySelector('#print-sheet .ps-pair-note')?.textContent ?? '';
          return document.querySelectorAll('#print-sheet .ps-diag li').length === 3
            && diag.includes('A reported advisory comes first')
            && diag.includes('E. coli points to fecal contamination')
            && diag.includes('Nitrate at or above the 10 mg/L as N MCL')
            && !diag.includes('Lead points near the tap and beyond it')
            && note.includes('Paired lead 30 -> 12 ppb: check fixture plus upstream/shared plumbing; resample.')
            && note.includes('Plomo pareado 30 -> 12 ppb: revise grifo y plomería aguas arriba/compartida; repita.');
        })()`));
        const crowdedPdf = Buffer.from((await cmd('Page.printToPDF', { printBackground: true })).data, 'base64');
        const crowdedInfo = await inspectPdf(crowdedPdf, `crowded-${lang}-row-${row + 1}`);
        const crowdedText = crowdedInfo.text.replace(/\s+/g, ' ');
        const pairLines = crowdedInfo.text.split('\n').filter(line => line.includes('Paired lead') || line.includes('Plomo pareado'));
        check(`crowded paired-lead PDF row ${row + 1} in ${lang} stays one page with zero edge ink`, crowdedInfo.pages === 1 && crowdedInfo.edge.ink === 0,
          `pages=${crowdedInfo.pages} edge=${JSON.stringify(crowdedInfo.edge)}`);
        check(`crowded paired-lead PDF row ${row + 1} in ${lang} keeps urgent findings and both pair languages`, crowdedText.includes('A reported advisory comes first')
          && crowdedText.includes('E. coli points to fecal contamination')
          && crowdedText.includes('Nitrate at or above the 10 mg/L as N MCL')
          && crowdedText.includes('Paired lead 30 -> 12 ppb')
          && crowdedText.includes('Plomo pareado 30 -> 12 ppb'));
        check(`crowded paired-lead note is one PDF line row ${row + 1} in ${lang}`, pairLines.length === 1, `lines=${pairLines.length}`);
      }
    }
    await click('#lab-lang-en');

    // Spanish nitrate units in the measured table and highest-ratio readout.
    await setCsv('tap,advisory,ecoli,lead_ppb,copper_ppb,nitrate_mg_l_as_n,arsenic_ppb,pfoa_ppt,pfos_ppt,pfhxs_ppt,pfna_ppt,genx_ppt,pfbs_ppt\nNitrate tap,none,absent,1,10,20,1,1,1,0,0,0,0');
    await click('#apply');
    await click('#lab-lang-es');
    check('Spanish nitrate units localize in measured table and highest-ratio readout', await waitFor(`(() => {
      const table = document.querySelector('#results-table')?.textContent ?? '';
      const readout = document.querySelector('#readout')?.textContent ?? '';
      return table.includes('mg/L como N') && readout.includes('mg/L como N') && !table.includes('mg/L as N') && !readout.includes('mg/L as N') && !table.includes('mCL');
    })()`));
    check('Spanish mobile report link localizes', await evaluate(
      `document.querySelector('#mobile-action a')?.textContent === 'Leer el informe del grifo'`));
    await click('#lab-lang-en');

    // Sparse Spanish audit: exact statuses, EPA/WHO references, print tags, and chart shorthand.
    const localeCsv = 'tap,advisory,ecoli,lead_ppb,copper_ppb,nitrate_mg_l_as_n,arsenic_ppb,pfoa_ppt,pfos_ppt,pfhxs_ppt,pfna_ppt,genx_ppt,pfbs_ppt\nLocalization tap,none,absent,12,1300,10,5,,,,3.99,,0';
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
    check('Spanish table keeps MCL capitalized and nitrate units localized on screen', await evaluate(`(() => {
      const table = document.querySelector('#results-table')?.textContent ?? '';
      return table.includes('MCL') && !table.includes('mCL') && table.includes('mg/L como N') && !table.includes('mg/L as N');
    })()`));
    check('bilingual print localizes ratio shorthand and nitrate units', await evaluate(`(() => {
      const print = document.querySelector('#print-sheet')?.textContent ?? '';
      const math = document.querySelector('#print-sheet .ps-math')?.textContent ?? '';
      return print.includes('Ratio / Relación') && print.includes('mg/L as N / mg/L como N') && math.includes('n/r / n/d');
    })()`));
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
