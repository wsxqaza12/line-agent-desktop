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
export type Bridge = {
  onClosing?(callback: () => void): () => void;
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
declare global {
  interface Window {
    lineAgent?: Bridge;
  }
}
