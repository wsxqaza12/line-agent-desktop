import { app, BrowserWindow, ipcMain, clipboard, shell, session, dialog, systemPreferences } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import { watch } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SettingsStore } from '../core/settings.mjs';
import { createBackend, nodeExecutable } from '../core/backend.mjs';
import { startMacBridge } from '../core/mac-ipc.mjs';
import { LineService } from '../core/service.mjs';
import { connectionConfig } from '../core/connection.mjs';
import { AppError, safeError } from '../core/errors.mjs';
import { WorkService } from '../core/work-service.mjs';
import { MCP_TOOL_NAMES } from '../core/mcp.mjs';
import { AgentRunner } from '../core/agent-runner.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(here);
const runtimeRoot =
  process.env.LINE_AGENT_RUNTIME ?? path.join(app.isPackaged ? process.resourcesPath : root, 'runtime');
const bridgePath = path.join(
  app.isPackaged ? process.resourcesPath : root,
  app.isPackaged ? 'bridge' : 'build',
  'mcp-server.cjs',
);
const store = new SettingsStore();
const service = new LineService(store, createBackend(runtimeRoot, { desktop: true, home: store.home }));
const work = new WorkService(service);
let mainWindow;
let quitting = false;
let closeAfterRead = false;
let workWatcher, workTimer, closeMacBridge;
const assistant = new AgentRunner(service, work, nodeExecutable(runtimeRoot), {
  onChange: (state) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('assistant-changed', state);
      if (state.job && ['completed', 'cancelled', 'failed'].includes(state.job.state))
        mainWindow.webContents.send('work-changed');
    }
  },
});
const smokeIndex = process.argv.indexOf('--smoke-test');
const smokeDir = smokeIndex >= 0 ? process.argv[smokeIndex + 1] : null;
if (smokeDir && path.isAbsolute(smokeDir)) {
  // Keep bounded packaging checks separate from an already-open user window.
  app.setPath('userData', path.join(smokeDir, 'electron-profile'));
}
if (!app.requestSingleInstanceLock()) app.quit();
else
  app
    .whenReady()
    .then(async () => {
      app.on('second-instance', () => {
        if (mainWindow) {
          mainWindow.restore();
          mainWindow.focus();
        }
      });
      session.defaultSession.setPermissionRequestHandler((_w, _p, cb) => cb(false));
      session.defaultSession.setPermissionCheckHandler(() => false);
      const uiFile = path.join(root, 'dist', 'index.html');
      mainWindow = new BrowserWindow({
        width: 1250,
        height: 880,
        minWidth: 900,
        minHeight: 680,
        title: 'LINE Agent Desktop',
        backgroundColor: '#f7f9f5',
        autoHideMenuBar: true,
        icon: path.join(root, 'dist', 'icon.png'),
        show: false,
        webPreferences: {
          preload: path.join(here, 'preload.cjs'),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          webSecurity: true,
        },
      });
      mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      await fs.mkdir(store.home, { recursive: true, mode: 0o700 });
      if (process.platform === 'darwin')
        closeMacBridge = await startMacBridge(store.home, service, () => {
          if (closeAfterRead && !service.busy && !assistant.busy && !assistant.scanning) {
            setTimeout(() => {
              if (!mainWindow.isDestroyed()) {
                quitting = true;
                mainWindow.close();
              }
            }, 100);
          }
        });
      app.on('will-quit', () => {
        closeMacBridge?.().catch(() => {});
      });
      await assistant.initialize();
      workWatcher = watch(store.home, (_event, file) => {
        if (String(file) !== 'work.sqlite') return;
        clearTimeout(workTimer);
        workTimer = setTimeout(() => {
          if (!mainWindow.isDestroyed()) mainWindow.webContents.send('work-changed');
        }, 200);
      });
      workWatcher.on('error', () => {}); // Focus/manual refresh remains available.
      mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
      const trusted = (event) =>
        event.sender === mainWindow.webContents &&
        event.senderFrame === mainWindow.webContents.mainFrame &&
        event.senderFrame.url.split('?')[0] === pathToFileURL(uiFile).href;
      ipcMain.handle('line-agent', async (event, method, args) => {
        if (!trusted(event))
          return { ok: false, error: { code: 'UNTRUSTED_CALL', message: '不支援這個來源。' } };
        try {
          let data;
          switch (method) {
            case 'assistant':
              data = assistant.snapshot();
              break;
            case 'scanAssistants':
              data = await assistant.scan();
              break;
            case 'stopAssistantScan':
              data = await assistant.cancelScan();
              break;
            case 'chooseAssistantFile': {
              if (!['codex', 'claude'].includes(args)) throw new AppError('INVALID_ARGUMENT');
              if (assistant.busy || assistant.scanning) throw new AppError('BUSY');
              const selected = await dialog.showOpenDialog(mainWindow, {
                title: `選擇 ${args === 'codex' ? 'Codex' : 'Claude Code'} CLI 程式`,
                properties: ['openFile'],
                filters: [
                  { name: 'CLI 程式', extensions: ['exe', 'js', 'cjs', 'mjs'] },
                  { name: '所有檔案（含 WSL）', extensions: ['*'] },
                ],
              });
              data =
                selected.canceled || !selected.filePaths[0]
                  ? assistant.snapshot()
                  : await assistant.addManual(args, selected.filePaths[0]);
              break;
            }
            case 'removeManualAssistant':
              if (typeof args !== 'string') throw new AppError('INVALID_ARGUMENT');
              data = await assistant.removeManual(args);
              break;
            case 'selectAssistant':
              data = await assistant.select(args);
              break;
            case 'startOrganizing':
              data = await assistant.start(args);
              break;
            case 'stopOrganizing':
              data = await assistant.cancel();
              break;
            case 'state':
              data = await service.state();
              break;
            case 'status':
              data = await service.status();
              break;
            case 'recent':
              data = await service.recent(args);
              break;
            case 'saveChats':
              data = await service.saveChats(args);
              break;
            case 'setEnabled':
              data = await service.setEnabled(args);
              break;
            case 'read':
              data = await service.read(args);
              break;
            case 'work':
              data = work.desktop();
              break;
            case 'editWork':
              data = work.edit(args);
              break;
            case 'mergeWork':
              data = work.merge(args);
              break;
            case 'saveRules':
              data = await work.rules(args);
              break;
            case 'connection':
              data = connectionConfig(runtimeRoot, bridgePath, store.home);
              break;
            case 'testMcp': {
              const config = connectionConfig(runtimeRoot, bridgePath, store.home).entry;
              const client = new Client({ name: 'line-agent-desktop-connection-test', version: '0.1.0' });
              const transport = new StdioClientTransport({
                ...config,
                env: { ...process.env, ...config.env },
                stderr: 'pipe',
              });
              transport.stderr?.on('data', () => {});
              try {
                await client.connect(transport, { timeout: 20000 });
                const result = await client.listTools({}, { timeout: 10000 });
                const names = result.tools.map((t) => t.name);
                if (names.length !== MCP_TOOL_NAMES.length || !MCP_TOOL_NAMES.every((n) => names.includes(n)))
                  throw new AppError('MCP_TEST_FAILED');
                data = { connected: true, tools: names, testedAt: new Date().toISOString() };
                await store.record('mcp_test', 'success');
              } finally {
                await client.close();
                await transport.close();
              }
              break;
            }
            case 'copy':
              if (typeof args !== 'string' || args.length > 20000) throw new AppError('INVALID_ARGUMENT');
              clipboard.writeText(args);
              data = true;
              break;
            case 'openSettings':
              await fs.mkdir(store.home, { recursive: true, mode: 0o700 });
              if (await shell.openPath(store.home)) throw new AppError('OPEN_FOLDER_FAILED');
              data = true;
              break;
            case 'openAccessibility':
              if (process.platform !== 'darwin') throw new AppError('INVALID_ARGUMENT');
              systemPreferences.isTrustedAccessibilityClient(true);
              await shell.openExternal(
                'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
              );
              data = true;
              break;
            default:
              throw new AppError('UNKNOWN_TOOL');
          }
          return { ok: true, data };
        } catch (error) {
          return { ok: false, error: safeError(error) };
        } finally {
          if (
            closeAfterRead &&
            !service.busy &&
            !assistant.busy &&
            !assistant.scanning &&
            !mainWindow.isDestroyed()
          ) {
            quitting = true;
            mainWindow.close();
          }
        }
      });
      mainWindow.once('ready-to-show', () => mainWindow.show());
      // There is no tray daemon, polling timer, startup task, or HTTP listener.
      mainWindow.on('close', (event) => {
        if ((assistant.busy || assistant.scanning) && !quitting) {
          event.preventDefault();
          closeAfterRead = true;
          mainWindow.webContents.send('operation-in-progress');
          if (assistant.scanning) void assistant.cancelScan();
          if (assistant.busy)
            assistant.cancel().finally(() => {
              if (!service.busy && !assistant.scanning && !mainWindow.isDestroyed()) {
                quitting = true;
                mainWindow.close();
              }
            });
          return;
        }
        if (service.busy && !quitting) {
          event.preventDefault();
          closeAfterRead = true;
          mainWindow.webContents.send('operation-in-progress');
        }
      });
      app.on('window-all-closed', () => {
        workWatcher?.close();
        clearTimeout(workTimer);
        quitting = true;
        app.quit();
      });
      await mainWindow.loadFile(uiFile);
      if (smokeDir && path.isAbsolute(smokeDir)) {
        // Bounded packaging check. Does not list chats or read messages.
        let exitCode = 1;
        try {
          await fs.mkdir(smokeDir, { recursive: true });
          await new Promise((resolve) => setTimeout(resolve, 1500));
          const title = await mainWindow.webContents.executeJavaScript('document.title');
          const state = await mainWindow.webContents.executeJavaScript('window.lineAgent.state()');
          const line = await mainWindow.webContents.executeJavaScript('window.lineAgent.status()');
          const mcp = await mainWindow.webContents.executeJavaScript('window.lineAgent.testMcp()');
          const workState = await mainWindow.webContents.executeJavaScript('window.lineAgent.work()');
          const assistants = await mainWindow.webContents.executeJavaScript(
            process.platform === 'darwin'
              ? 'window.lineAgent.assistant()'
              : 'window.lineAgent.scanAssistants()',
          );
          const uiWorkCount = await mainWindow.webContents.executeJavaScript(
            'document.querySelectorAll("article.work-card").length',
          );
          const screenshot = await mainWindow.webContents.capturePage();
          await fs.writeFile(path.join(smokeDir, 'desktop.png'), screenshot.toPNG());
          await fs.writeFile(
            path.join(smokeDir, 'smoke.json'),
            JSON.stringify({ title, state, line, mcp, work: workState, assistants, uiWorkCount }, null, 2),
          );
          exitCode =
            title === 'LINE Agent Desktop' && state.ok && mcp.ok && workState.ok && assistants.ok ? 0 : 1;
        } finally {
          quitting = true;
          app.exit(exitCode);
        }
      }
    })
    .catch(async (error) => {
      if (smokeDir && path.isAbsolute(smokeDir)) {
        await fs.mkdir(smokeDir, { recursive: true }).catch(() => {});
        await fs
          .writeFile(path.join(smokeDir, 'startup-error.txt'), String(error?.stack ?? error))
          .catch(() => {});
      }
      console.error('LINE Agent Desktop could not start:', error?.message ?? 'unknown error');
      app.exit(1);
    });
