import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';

await fs.mkdir('test-results', { recursive: true });
const child = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '5187', '--strictPort'],
  { stdio: ['ignore', 'pipe', 'pipe'] },
);
let log = '';
child.stdout.on('data', (d) => (log += d));
child.stderr.on('data', (d) => (log += d));
const errors = [];
let browser;
try {
  for (let i = 0; i < 50; i++) {
    if (child.exitCode !== null) throw new Error(`Preview exited ${child.exitCode}: ${log}`);
    try {
      if ((await fetch('http://127.0.0.1:5187')).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : {}),
  });
  const page = await browser.newPage({ viewport: { width: 1360, height: 1000 } });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('http://127.0.0.1:5187/?demo');
  await page.getByRole('button', { name: '檢查 LINE 連線', exact: true }).click();
  await page.getByText('已偵測 LINE 26.5.0.3975', { exact: true }).waitFor();
  await page.waitForFunction(() => !document.querySelector('.spin'));
  await page.screenshot({ path: 'test-results/overview.png', fullPage: true });
  await page.getByRole('button', { name: '聊天室權限', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: '開啟 Agent 存取', exact: true }).isDisabled(), true);
  await page.getByRole('button', { name: '載入聊天室', exact: true }).click();
  await page.getByRole('checkbox', { name: '授權 森野設計｜網站專案', exact: true }).check();
  await page.getByRole('checkbox', { name: '授權 Alex Chen', exact: true }).check();
  await page.getByRole('button', { name: '儲存聊天室權限', exact: true }).click();
  await page.getByText('聊天室權限已儲存。', { exact: true }).waitFor();
  await page.getByRole('button', { name: '開啟 Agent 存取', exact: true }).click();
  await page.getByText('已開啟所選聊天室的存取', { exact: true }).waitFor();
  await page.screenshot({ path: 'test-results/chats.png', fullPage: true });
  await page.getByRole('button', { name: '讀取測試', exact: true }).first().click();
  await page.getByRole('button', { name: '讀取訊息', exact: true }).click();
  await page.getByText('可以在下週的版本加上深色模式嗎？目前晚上看有點刺眼。', { exact: true }).waitFor();
  await page.getByRole('button', { name: '關閉讀取測試', exact: true }).click();
  await page.getByRole('button', { name: '連接 Agent', exact: true }).click();
  await page.getByText('config.toml', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'WSL', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('pre')?.textContent.includes('/mnt/c/'));
  assert.match(await page.locator('pre').innerText(), /\/mnt\/c\//);
  await page.getByRole('button', { name: 'Windows', exact: true }).click();
  await page.getByRole('button', { name: '測試 MCP 連線', exact: true }).click();
  await page.getByRole('button', { name: '重新測試', exact: true }).waitFor();
  await page.getByRole('tab', { name: 'Claude Desktop', exact: true }).click();
  await page.getByText('MCP JSON', { exact: true }).waitFor();
  await page.screenshot({ path: 'test-results/connect.png', fullPage: true });
  await page.getByRole('button', { name: /聊天室權限/ }).click();
  await page.getByRole('button', { name: '暫停所有存取', exact: true }).click();
  await page.getByText('目前已暫停 Agent 存取', { exact: true }).waitFor();
  for (const button of await page.getByRole('button', { name: '讀取測試', exact: true }).all())
    assert.equal(await button.isDisabled(), true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '總覽', exact: true }).click();
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
    'no horizontal overflow on mobile',
  );
  await page.screenshot({ path: 'test-results/mobile.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log(
    'UI passed: onboarding, permissions, preview, client tabs, pause, mobile width; 0 page errors.',
  );
} finally {
  await browser?.close();
  child.kill();
  if (child.exitCode === null) await new Promise((resolve) => child.once('exit', resolve));
}
