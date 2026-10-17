#!/usr/bin/env node
/**
 * StayOS Connector — lets the StayOS agent work a hotel's existing PMS.
 *
 *   Desktop (on a front-desk computer; logins never leave it):
 *     node stayos-connector.mjs pair ABC234 --server https://your-stayos.app --name "Front desk PC"
 *     node stayos-connector.mjs run
 *
 *   Cloud worker (StayOS infrastructure; types sealed logins, never shows them to the model):
 *     STAYOS_SERVER=https://your-stayos.app BRIDGE_WORKER_SECRET=… node stayos-connector.mjs worker
 *
 * The connector only executes browser actions (click, type, scroll…) that the
 * StayOS server sends back for each screenshot. No API keys live here.
 * Requires Node 20+ and Playwright (`npm i playwright && npx playwright install chromium`).
 */
import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
import { homedir, hostname } from 'node:os';
import { join } from 'node:path';

const DIR = join(homedir(), '.stayos');
const CONFIG = join(DIR, 'connector.json');
const PROFILE = join(DIR, 'browser-profile');

const args = process.argv.slice(2);
const cmd = args[0];
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const has = (name) => args.includes(`--${name}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...m) => console.log(new Date().toLocaleTimeString(), '·', ...m);

async function loadConfig() {
  try {
    return JSON.parse(await readFile(CONFIG, 'utf8'));
  } catch {
    return null;
  }
}

async function api(server, token, path, body) {
  const res = await fetch(new URL(path, server), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

async function pair() {
  const code = args[1];
  const server = flag('server', process.env.STAYOS_SERVER);
  if (!code || !server) {
    console.error('Usage: stayos-connector pair <CODE> --server https://your-stayos.app [--name "Front desk PC"]');
    process.exit(1);
  }
  const res = await fetch(new URL('/api/bridge/pair', server), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, deviceName: flag('name', hostname()) }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error('Pairing failed:', data.error || res.status);
    process.exit(1);
  }
  await mkdir(DIR, { recursive: true });
  await writeFile(CONFIG, JSON.stringify({ server, token: data.token, system: data.system, loginUrl: data.loginUrl, property: data.property }, null, 2));
  await chmod(CONFIG, 0o600);
  console.log(`✓ Paired with ${data.property} (${data.system}).`);
  console.log('Next: run `node stayos-connector.mjs run`, sign in to your PMS in the window that opens, and leave it running.');
}

// ---------------------------------------------------------------------------
// Browser actions
// ---------------------------------------------------------------------------

const KEYS = { CTRL: 'Control', CONTROL: 'Control', CMD: 'Meta', META: 'Meta', ALT: 'Alt', OPTION: 'Alt', SHIFT: 'Shift', ENTER: 'Enter', RETURN: 'Enter', ESC: 'Escape', ESCAPE: 'Escape', TAB: 'Tab', SPACE: 'Space', BACKSPACE: 'Backspace', DELETE: 'Delete', UP: 'ArrowUp', DOWN: 'ArrowDown', LEFT: 'ArrowLeft', RIGHT: 'ArrowRight', ARROWUP: 'ArrowUp', ARROWDOWN: 'ArrowDown', ARROWLEFT: 'ArrowLeft', ARROWRIGHT: 'ArrowRight', HOME: 'Home', END: 'End', PAGEUP: 'PageUp', PAGEDOWN: 'PageDown' };
const key = (k) => KEYS[String(k).toUpperCase()] ?? (String(k).length === 1 ? String(k) : String(k));
const button = (b) => (b === 'right' ? 'right' : b === 'wheel' || b === 'middle' ? 'middle' : 'left');

async function perform(page, a) {
  switch (a.type) {
    case 'click':
      return page.mouse.click(a.x, a.y, { button: button(a.button) });
    case 'double_click':
      return page.mouse.dblclick(a.x, a.y);
    case 'move':
      return page.mouse.move(a.x, a.y);
    case 'drag': {
      const [first, ...rest] = a.path ?? [];
      if (!first) return;
      await page.mouse.move(first.x, first.y);
      await page.mouse.down();
      for (const p of rest) await page.mouse.move(p.x, p.y, { steps: 4 });
      return page.mouse.up();
    }
    case 'scroll':
      await page.mouse.move(a.x ?? 640, a.y ?? 400);
      return page.mouse.wheel(a.scroll_x ?? 0, a.scroll_y ?? 0);
    case 'type':
      return page.keyboard.type(String(a.text ?? ''), { delay: 15 });
    case 'keypress':
      return page.keyboard.press((a.keys ?? []).map(key).join('+'));
    case 'wait':
      return sleep(1500);
    case 'screenshot':
    default:
      return;
  }
}

async function screenshot(page) {
  const buf = await page.screenshot({ type: 'jpeg', quality: 70 });
  return `data:image/jpeg;base64,${buf.toString('base64')}`;
}

async function runTask({ server, token, claim, page }) {
  const { task, connection, maxSteps = 60 } = claim;
  log(`▶ ${connection.system}: ${task.instruction}`);
  let previousResponseId = null;
  let pending = null;
  const finish = (status, summary, error) => api(server, token, `/api/bridge/tasks/${task.id}/finish`, { status, summary, error }).catch((e) => log('could not report result:', e.message));
  try {
    if (claim.fresh && connection.loginUrl && !/^https:\/\//i.test(connection.loginUrl)) throw new Error('The cloud browser only opens https:// sign-in pages.');
    if (connection.loginUrl && (page.url() === 'about:blank' || claim.fresh)) await page.goto(connection.loginUrl, { waitUntil: 'domcontentloaded' });
    for (let i = 0; i < maxSteps; i++) {
      await page.waitForLoadState('domcontentloaded').catch(() => undefined);
      await sleep(500);
      let res;
      for (let attempt = 0; ; attempt++) {
        try {
          res = await api(server, token, `/api/bridge/tasks/${task.id}/step`, { screenshot: await screenshot(page), currentUrl: page.url(), previousResponseId, pending });
          break;
        } catch (e) {
          if (e.status === 502 && attempt < 2) {
            await sleep(2000 * (attempt + 1));
            continue;
          }
          throw e;
        }
      }
      const next = res.next;
      if (next.kind === 'done') {
        log(`${next.status === 'DONE' ? '✓' : '!'} ${next.summary}`);
        return finish(next.status, next.summary);
      }
      previousResponseId = next.responseId;
      if (next.kind === 'actions') {
        for (const a of next.actions) await perform(page, a);
        pending = { callId: next.callId, type: 'computer' };
      } else if (next.kind === 'credential') {
        // Cloud worker only: type the sealed value into the focused field. Never logged.
        await page.keyboard.type(next.value, { delay: 20 });
        pending = { callId: next.callId, type: 'credential' };
      }
    }
    return finish('NEEDS_HELP', `Stopped after ${maxSteps} steps without finishing.`);
  } catch (e) {
    log('✗', e.message);
    return finish('FAILED', undefined, e.message);
  }
}

async function loop({ server, token, worker }) {
  let playwright;
  try {
    playwright = await import('playwright');
  } catch {
    console.error('Playwright is required: npm i playwright && npx playwright install chromium');
    process.exit(1);
  }
  const viewport = { width: 1280, height: 800 };
  let desktopContext = null;
  let browser = null;
  if (worker) {
    browser = await playwright.chromium.launch({ headless: true });
  } else {
    await mkdir(PROFILE, { recursive: true });
    desktopContext = await playwright.chromium.launchPersistentContext(PROFILE, { headless: has('headless'), viewport });
    const cfg = await loadConfig();
    const page = desktopContext.pages()[0] ?? (await desktopContext.newPage());
    if (cfg?.loginUrl && page.url() === 'about:blank') await page.goto(cfg.loginUrl).catch(() => undefined);
    log(`Connected as ${cfg?.property ?? 'your hotel'} — keep this window signed in to ${cfg?.system ?? 'your PMS'}.`);
  }
  log(worker ? 'Cloud worker ready.' : 'Waiting for work from StayOS…');
  for (;;) {
    let claim;
    try {
      claim = await api(server, token, '/api/bridge/claim');
    } catch (e) {
      log('server unreachable:', e.message);
      if (e.status === 403) process.exit(1);
      await sleep(10_000);
      continue;
    }
    if (!claim.task) {
      await sleep(claim.paused ? 15_000 : 4_000);
      continue;
    }
    if (worker) {
      // A fresh, isolated browser per task: nothing leaks between hotels.
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      await runTask({ server, token, claim: { ...claim, fresh: true }, page });
      await context.close();
    } else {
      const page = desktopContext.pages()[0] ?? (await desktopContext.newPage());
      await page.setViewportSize(viewport);
      await runTask({ server, token, claim, page });
    }
  }
}

async function main() {
  if (cmd === 'pair') return pair();
  if (cmd === 'run') {
    const cfg = await loadConfig();
    if (!cfg) {
      console.error('Not paired yet. In StayOS open Your PMS → Desktop connector → Create pairing code, then run `pair <CODE> --server <url>`.');
      process.exit(1);
    }
    return loop({ server: cfg.server, token: cfg.token, worker: false });
  }
  if (cmd === 'worker') {
    const server = process.env.STAYOS_SERVER;
    const secret = process.env.BRIDGE_WORKER_SECRET;
    if (!server || !secret) {
      console.error('Set STAYOS_SERVER and BRIDGE_WORKER_SECRET to run the cloud worker.');
      process.exit(1);
    }
    return loop({ server, token: `worker:${secret}`, worker: true });
  }
  console.log('StayOS Connector\n  pair <CODE> --server <url> [--name <device>]\n  run [--headless]\n  worker   (cloud; needs STAYOS_SERVER and BRIDGE_WORKER_SECRET)');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
