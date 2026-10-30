import type { AssistantState } from './types';
let state: AssistantState = { providers: [], notes: [], selectedId: null, scanning: false, job: null };
const listeners = new Set<(s: AssistantState) => void>();
const snapshot = () => structuredClone(state);
const emit = () => listeners.forEach((fn) => fn(snapshot()));
let timer: ReturnType<typeof setTimeout>;
export const demoAssistant = {
  assistant: async () => ({ ok: true as const, data: snapshot() }),
  onAssistantChanged: (fn: (s: AssistantState) => void) => {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
  scanAssistants: async () => {
    state.scanning = true;
    emit();
    await new Promise((r) => setTimeout(r, 350));
    state.providers = [
      {
        id: 'demo-codex',
        provider: 'codex',
        label: 'Codex',
        location: 'Windows',
        version: '展示版本',
        status: 'ready',
        detail: '已登入 ChatGPT，可使用原帳號額度。',
      },
      {
        id: 'demo-claude',
        provider: 'claude',
        label: 'Claude Code',
        location: 'WSL · Ubuntu',
        version: '展示版本',
        status: 'login',
        detail: '請先開啟 Claude Code，用 Claude 帳號登入。',
      },
    ];
    state.scanning = false;
    emit();
    return { ok: true as const, data: snapshot() };
  },
  selectAssistant: async (id: string) => {
    state.selectedId = id;
    emit();
    return { ok: true as const, data: snapshot() };
  },
  startOrganizing: async () => {
    state.job = {
      id: 'demo',
      state: 'running',
      phase: 'Codex 正在判讀 12 則訊息',
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      chatCount: 2,
      messageCount: 12,
      added: 0,
      updated: 0,
      skipped: 0,
      events: 1,
      summary: '',
      warnings: [],
      error: null,
    };
    emit();
    timer = setTimeout(() => {
      if (!state.job) return;
      state.job.state = 'completed';
      state.job.phase = '整理完成';
      state.job.summary = '展示整理已完成。實際使用時，AI 的結果會寫回工作看板。';
      state.job.finishedAt = new Date().toISOString();
      emit();
    }, 1800);
    return { ok: true as const, data: snapshot() };
  },
  stopOrganizing: async () => {
    clearTimeout(timer);
    if (state.job) {
      state.job.state = 'cancelled';
      state.job.finishedAt = new Date().toISOString();
    }
    emit();
    return { ok: true as const, data: snapshot() };
  },
};
