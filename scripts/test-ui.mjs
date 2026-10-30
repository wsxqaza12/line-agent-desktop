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
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('http://127.0.0.1:5187/?demo');
  await page.getByRole('button', { name: '開啟工作：整理首頁改版的需求清單', exact: true }).waitFor();
  await page.screenshot({ path: 'test-results/overview.png', fullPage: true });
  await page.getByRole('button', { name: '開啟工作：整理首頁改版的需求清單', exact: true }).click();
  await page.getByLabel('工作期限', { exact: true }).fill('2026-12-15');
  await page.getByLabel('工作進度', { exact: true }).selectOption('doing');
  await page.getByLabel('修正原因', { exact: true }).fill('已和客戶確認日期');
  await page.getByRole('button', { name: '儲存變更', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.waitForFunction(
    () => document.querySelector('select[aria-label="狀態：整理首頁改版的需求清單"]')?.value === 'doing',
  );
  await page.getByRole('button', { name: '開啟工作：整理首頁改版的需求清單', exact: true }).click();
  assert.equal(await page.getByLabel('工作期限', { exact: true }).inputValue(), '2026-12-15');
  await page.getByRole('tab', { name: '變更紀錄', exact: true }).click();
  await page.getByText('已和客戶確認日期', { exact: true }).waitFor();
  await page.screenshot({ path: 'test-results/task.png', fullPage: true });
  await page.getByRole('button', { name: '關閉視窗', exact: true }).click();
  const dragCard = page
    .locator('article')
    .filter({ has: page.getByRole('button', { name: '開啟工作：確認下週訪談的時間', exact: true }) });
  await dragCard.dragTo(page.getByRole('region', { name: '進行中', exact: true }));
  await page.waitForFunction(
    () => document.querySelector('select[aria-label="狀態：確認下週訪談的時間"]')?.value === 'doing',
  );
  await page.getByRole('tab', { name: /待確認/ }).click();
  await page.getByLabel('狀態：評估加入深色模式', { exact: true }).selectOption('todo');
  await page
    .getByRole('button', { name: '開啟工作：評估加入深色模式', exact: true })
    .waitFor({ state: 'hidden' });
  await page.getByLabel('狀態：下次聚會聊聊社群合作', { exact: true }).selectOption('dismissed');
  await page.getByText('目前沒有需要確認的工作。', { exact: true }).waitFor();
  await page.getByRole('button', { name: '已排除 1 件', exact: true }).click();
  await page.getByRole('button', { name: '開啟工作：下次聚會聊聊社群合作', exact: true }).waitFor();
  await page.getByRole('tab', { name: '日期', exact: true }).click();
  await page.getByText('未排日期', { exact: false }).first().waitFor();
  await page.screenshot({ path: 'test-results/dates.png', fullPage: true });
  await page.getByRole('button', { name: '下一個月', exact: true }).click();
  await page.getByRole('button', { name: '本月', exact: true }).click();
  await page.getByRole('button', { name: '請 Agent 整理', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: '開始整理', exact: true }).isDisabled(), true);
  await page.getByRole('button', { name: '選擇 AI 助理', exact: true }).click();
  await page.getByRole('button', { name: '使用這個 AI', exact: true }).click();
  await page.getByRole('button', { name: '已選用', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: '需要登入', exact: true }).isDisabled(), true);
  await page.getByRole('button', { name: '指定 Claude Code 位置', exact: true }).click();
  await page.getByText('D:\\AI Tools\\claude.exe', { exact: true }).waitFor();
  await page.getByRole('button', { name: '移除手動設定', exact: true }).click();
  await page.getByText('D:\\AI Tools\\claude.exe', { exact: true }).waitFor({ state: 'hidden' });
  await page.screenshot({ path: 'test-results/assistant.png', fullPage: true });
  await page.getByRole('button', { name: '工作看板', exact: true }).click();
  await page.getByRole('button', { name: '請 Agent 整理', exact: true }).click();
  await page.getByRole('button', { name: '開始整理', exact: true }).click();
  await page.getByRole('button', { name: '停止整理', exact: true }).waitFor();
  await page.screenshot({ path: 'test-results/organizing.png', fullPage: true });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '整理中 · 查看進度', exact: true }).click();
  await page.getByText('整理完成', { exact: true }).waitFor();
  await page.getByRole('button', { name: '開始整理', exact: true }).click();
  await page.getByRole('button', { name: '停止整理', exact: true }).click();
  await page.getByText('已停止整理', { exact: true }).waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '整理偏好', exact: true }).click();
  await page.getByLabel('我的整理規則', { exact: true }).fill('只有我答應的工作才列為待辦。產品建議先確認。');
  await page.getByRole('button', { name: '儲存規則', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.rules-editor button')?.disabled === true);
  await page.getByRole('button', { name: '工作看板', exact: true }).click();
  await page.getByRole('button', { name: '整理偏好', exact: true }).click();
  assert.match(await page.getByLabel('我的整理規則', { exact: true }).inputValue(), /產品建議先確認/);
  await page.getByRole('button', { name: '工作看板', exact: true }).click();
  await page.getByLabel('搜尋工作', { exact: true }).fill('寄出第二階段');
  await page.getByRole('button', { name: '開啟工作：寄出第二階段的報價', exact: true }).waitFor();
  assert.equal(await page.locator('article.work-card').count(), 1);
  await page.getByLabel('搜尋工作', { exact: true }).fill('');
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: 'test-results/mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1360, height: 1000 });
  await page.goto('http://127.0.0.1:5187/?demo&fresh');
  await page.getByRole('button', { name: '狀態與說明', exact: true }).click();
  await page.getByRole('button', { name: '重新檢查', exact: true }).click();
  await page.getByText('已執行 · 26.5.0.3975', { exact: true }).waitFor();
  await page.waitForFunction(() => !document.querySelector('.spin'));
  await page.screenshot({ path: 'test-results/settings.png', fullPage: true });
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
  await page.getByRole('button', { name: 'AI 助理', exact: true }).click();
  await page.getByRole('button', { name: '進階設定 · 外部 Agent／MCP', exact: true }).click();
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
  await page.getByRole('button', { name: '工作看板', exact: true }).click();
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
    'no horizontal overflow on mobile',
  );
  await page.screenshot({ path: 'test-results/fresh-mobile.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log(
    'UI passed: work board, human edits, evidence history, drag/drop, review/dismissal, dates, shared rules, AI selection/start/progress/cancel, filters, permissions, MCP settings, pause, mobile; 0 page errors.',
  );
} finally {
  await browser?.close();
  child.kill();
  if (child.exitCode === null) await new Promise((resolve) => child.once('exit', resolve));
}
