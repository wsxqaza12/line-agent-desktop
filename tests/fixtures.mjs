export const ownSenderRef = 'sender:' + '1'.repeat(24);
export const chat = {
  chatName: 'Example customer',
  chatRef: 'chat:' + '2'.repeat(24),
  chatType: 'direct',
  ownSenderRef,
};
export const other = {
  chatName: 'Private room',
  chatRef: 'chat:' + '3'.repeat(24),
  chatType: 'group',
  ownSenderRef,
};
export const scope = { chatRef: chat.chatRef, dateFrom: '2026-10-01', dateTo: '2026-10-07' };
export function backend(overrides = {}) {
  return {
    environment: async () => ({ platform: 'win32', supported: true, components: [] }),
    status: async () => ({ verified: true, version: '26.5.0.3975', running: true }),
    recent: async () => ({
      chats: [chat, other],
      ownSenderRef,
      hasMore: false,
      warnings: [],
      checkedAt: new Date().toISOString(),
    }),
    read: async (s) => ({
      chatName: s.chatName,
      chatRef: s.expectedChatRef,
      ownSenderRef: s.expectedOwnSenderRef,
      count: 1,
      messages: [
        {
          text: 'Synthetic confidential message: do not persist this text',
          sourceRef: 'message:' + '4'.repeat(24),
        },
      ],
      pagination: { hasMore: false, nextCursor: null },
    }),
    ...overrides,
  };
}
