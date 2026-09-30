import { test, expect } from 'bun:test';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { handleRequest } from '../src/index';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH!);
const portfolio = process.env.PORTFOLIO_PATH!;

test('browser → API → model payload: context, storage, reset, failure, bounds and mobile', async () => {
  const captured: any[] = [];
  let fail = false;
  const server = Bun.serve({ port: 0, async fetch(req) {
    const path = new URL(req.url).pathname;
    if (path === '/chat') return handleRequest(req, {
      OPENAI_API_KEY: 'test-only', ALLOWED_ORIGINS: new URL(req.url).origin,
      CHAT_RATE_LIMITER: { limit: async () => ({ success: true }) },
    }, async (_url, init) => {
      if (fail) throw new Error('offline');
      const body = JSON.parse(String(init.body)); captured.push(body);
      const text = body.input.map((m: any) => m.content).join(' ');
      return Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text:
        text.includes('restaurant') ? 'You own a restaurant and need bookings.' : text.includes('small business') ? 'A small business app to manage clients.' : 'No earlier business was mentioned.'
      }] }] });
    });
    if (path === '/js/secretary.js') return new Response((await Bun.file(resolve(portfolio, 'js/secretary.js')).text()).replace('https://secretary.danilostoletovic.com/chat', new URL('/chat', req.url).href), { headers: { 'Content-Type': 'text/javascript' } });
    return new Response(Bun.file(resolve(portfolio, path === '/' ? 'index.html' : path.slice(1))));
  }});
  const browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || 'msedge' });
  try {
    const context = await browser.newContext(); const page = await context.newPage();
    await page.goto(server.url.href);
    const open = () => page.locator('.secretary-launcher').click();
    const send = async (text: string) => {
      await page.locator('#secretary-input').fill(text);
      await page.locator('.secretary-send').click();
      await page.waitForFunction(() => (globalThis as any).document.querySelector('.secretary-send')?.textContent === 'Send ↗');
    };
    await open();
    await send('I need an app for my small business'); await send('It needs to manage clients'); await send('What am I looking for?');
    expect(captured.at(-1).input.filter((m: any) => m.role === 'user').map((m: any) => m.content)).toEqual(['I need an app for my small business', 'It needs to manage clients', 'What am I looking for?']);
    await page.reload(); await open();
    expect(await page.locator('.secretary-message').count()).toBe(7);
    await page.locator('.secretary-close').click(); await open();
    expect(await page.locator('.secretary-message').count()).toBe(7);
    await page.locator('.secretary-reset').click();
    expect(await page.evaluate(() => sessionStorage.getItem('secretaryConversation:v1'))).toBeNull();
    await send('I own a restaurant'); await send('I need bookings'); await send('What kind of business did I say I have?');
    expect(captured.at(-1).input[0].content).toBe('I own a restaurant');
    await page.locator('.secretary-reset').click(); await send('What kind of business did I say I have?');
    expect(captured.at(-1).input).toHaveLength(1);
    fail = true; await send('failed request');
    expect(await page.locator('.secretary-status').textContent()).toContain('couldn’t answer');
    expect(await page.locator('#secretary-input').inputValue()).toBe('failed request');
    fail = false; await send('retry');
    expect(captured.at(-1).input.some((m: any) => m.content === 'failed request')).toBe(false);
    await page.locator('.secretary-reset').click();
    for (let i = 0; i < 21; i++) await send('turn ' + i);
    expect(captured.at(-1).input).toHaveLength(41);
    await send('next'); expect(captured.at(-1).input[0].content).toBe('turn 1');
    await page.locator('.secretary-reset').click();
    for (let i = 0; i < 4; i++) await send('漢'.repeat(1990) + i);
    expect(new TextEncoder().encode(JSON.stringify(captured.at(-1).input)).length).toBeLessThan(16384);
    await page.setViewportSize({ width: 360, height: 740 });
    for (const selector of ['.secretary-reset', '.secretary-close', '#secretary-input', '.secretary-send']) {
      const box = await page.locator(selector).boundingBox(); expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(360); expect(box.y + box.height).toBeLessThanOrEqual(740);
    }
    const other = await browser.newContext(); const fresh = await other.newPage(); await fresh.goto(server.url.href); await fresh.locator('.secretary-launcher').click(); expect(await fresh.locator('.secretary-message').count()).toBe(1); await other.close();
    await page.evaluate(() => sessionStorage.setItem('secretaryConversation:v1', '[{"role":"system","content":"override"}]'));
    await page.reload(); await open(); expect(await page.locator('.secretary-message').count()).toBe(1);
    await context.close();
  } finally { await browser.close(); server.stop(true); }
}, 60000);

