export type Chat = {
  chatRef: string;
  chatName: string;
  chatType: 'direct' | 'group';
  ownSenderRef: string;
  lastMessageAt?: string;
};
export type Settings = { schemaVersion: number; enabled: boolean; chats: Chat[]; revision: string };
export type Activity = {
  id: string;
  at: string;
  action: string;
  outcome: string;
  code?: string;
  count?: number;
  chatRef?: string;
};
export type State = {
  settings: Settings;
  environment: { platform: string; supported: boolean; components: { id: string; available: boolean }[] };
  activity: Activity[];
};
export type LineStatus = { verified: boolean; version: string; running: boolean; processState: string };
export type Recent = { chats: Chat[]; warnings: string[]; hasMore: boolean; checkedAt: string };
export type Page = {
  chatName: string;
  chatRef: string;
  count: number;
  messages: {
    sourceRef: string;
    date: string;
    time: string;
    text: string;
    senderRef: string;
    contentType?: number;
  }[];
  ownSenderRef: string;
  pagination: { hasMore: boolean; nextCursor: string | null };
  freshness?: { checkedAt?: string };
};
export type ReadArgs = { chatRef: string; dateFrom: string; dateTo: string; limit?: number; cursor?: string };
export type Connection = { json: string; codex: string; codexWsl: string };
export type Result<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };
export type WorkStatus = 'review' | 'todo' | 'doing' | 'done' | 'dismissed';
export type WorkFields = {
  title: string;
  description: string;
  status: WorkStatus;
  owner: string | null;
  dueDate: string | null;
};
export type WorkItem = WorkFields & {
  id: string;
  workKey: string;
  chatRef: string;
  chatName: string;
  ownSenderRef: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  locks: (keyof WorkFields)[];
  mergedInto: string | null;
  sources: {
    sourceRef: string;
    date: string;
    time: string;
    senderRef: string;
    text: string;
    truncated: boolean;
  }[];
  history: {
    at: string;
    actor: 'agent' | 'human';
    reason: string;
    changes: Record<string, unknown>;
    blockedFields: string[];
  }[];
};
export type WorkRules = { text: string; revision: number; updatedAt: string | null };
export type WorkSnapshot = { items: WorkItem[]; rules: WorkRules };
export type WorkEdit = {
  id: string;
  expectedRevision: number;
  patch: Partial<WorkFields>;
  reason?: string;
  unlockFields?: (keyof WorkFields)[];
};
export type WorkMerge = {
  targetId: string;
  targetRevision: number;
  sourceId: string;
  sourceRevision: number;
};
export type Bridge = {
  assistant(): Promise<Result<AssistantState>>;
  scanAssistants(): Promise<Result<AssistantState>>;
  selectAssistant(id: string): Promise<Result<AssistantState>>;
  startOrganizing(args: { days: number; chatRef?: string }): Promise<Result<AssistantState>>;
  stopOrganizing(): Promise<Result<AssistantState>>;
  onAssistantChanged?(callback: (state: AssistantState) => void): () => void;
  onClosing?(callback: () => void): () => void;
  onWorkChanged?(callback: () => void): () => void;
  work(): Promise<Result<WorkSnapshot>>;
  editWork(args: WorkEdit): Promise<Result<WorkItem>>;
  mergeWork(args: WorkMerge): Promise<Result<WorkItem>>;
  saveRules(args: { text: string; expectedRevision: number }): Promise<Result<WorkRules>>;
  state(): Promise<Result<State>>;
  status(): Promise<Result<LineStatus>>;
  recent(query: string): Promise<Result<Recent>>;
  saveChats(refs: string[]): Promise<Result<Settings>>;
  setEnabled(enabled: boolean): Promise<Result<Settings>>;
  read(args: ReadArgs): Promise<Result<Page>>;
  connection(): Promise<Result<Connection>>;
  testMcp(): Promise<Result<{ connected: boolean; tools: string[]; testedAt: string }>>;
  copy(text: string): Promise<Result<boolean>>;
  openSettings(): Promise<Result<boolean>>;
};
export type AssistantProvider = {
  id: string;
  provider: 'codex' | 'claude';
  label: string;
  location: string;
  version: string;
  status: 'ready' | 'login' | 'api' | 'update' | 'unknown';
  detail: string;
};
export type AssistantJob = {
  id: string;
  state: 'running' | 'stopping' | 'completed' | 'failed' | 'cancelled';
  phase: string;
  startedAt: string;
  updatedAt: string;
  finishedAt?: string;
  messageCount: number;
  chatCount: number;
  added: number;
  updated: number;
  skipped: number;
  events: number;
  summary: string;
  warnings: string[];
  error: { code: string; message: string } | null;
};
export type AssistantState = {
  providers: AssistantProvider[];
  notes: string[];
  selectedId: string | null;
  scanning: boolean;
  job: AssistantJob | null;
};
declare global {
  interface Window {
    lineAgent?: Bridge;
  }
}
