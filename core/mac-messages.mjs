import { createHash } from 'node:crypto';
import { AppError } from './errors.mjs';

export const macRef = (kind, ...parts) =>
  `${kind}:${createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 24)}`;
export const macChatRef = (own, name, type) => macRef('chat', 'mac-ui-v1', own, name, type);

// Preserve the accessibility label's sender/content prefix verbatim. Display names
// are not account IDs. Only LINE's outgoing read-receipt suffix identifies "me".
export function parseMacRows(rows, { ownSenderRef, chatRef, timeZone }) {
  if (timeZone !== 'Asia/Taipei') throw new AppError('MAC_TIMEZONE_REQUIRED');
  let date = null,
    omitted = 0;
  const messages = [],
    occurrences = new Map();
  for (const row of rows) {
    if (typeof row !== 'string' || row.length > 100000) {
      omitted++;
      continue;
    }
    const day = /^(\d{4})年(\d{1,2})月(\d{1,2})日$/.exec(row);
    if (day) {
      date = `${day[1]}-${day[2].padStart(2, '0')}-${day[3].padStart(2, '0')}`;
      const parsed = new Date(`${date}T00:00:00Z`);
      if (!Number.isFinite(+parsed) || parsed.toISOString().slice(0, 10) !== date) date = null;
      continue;
    }
    // Do not infer missing dates, sender identity, or dates mentioned in a message.
    const match = /^(.*), (上午|下午) (\d{1,2}):(\d{2})(, 已讀(?: \d+)?)?$/s.exec(row);
    if (!date || !match || +match[3] < 1 || +match[3] > 12 || +match[4] > 59) {
      omitted++;
      continue;
    }
    const hour = (+match[3] % 12) + (match[2] === '下午' ? 12 : 0);
    const time = `${String(hour).padStart(2, '0')}:${match[4]}`;
    const key = JSON.stringify([date, time, row]);
    const occurrence = occurrences.get(key) ?? 0;
    occurrences.set(key, occurrence + 1);
    messages.push({
      sourceRef: macRef('message', 'mac-ui-v1', chatRef, date, time, row, occurrence),
      date,
      time,
      text: match[1],
      senderRef: match[5] ? ownSenderRef : macRef('sender', 'mac-ui-unknown', chatRef),
      senderIdentity: match[5] ? 'self-read-receipt' : 'unverified',
      sourceKind: 'accessibility-snapshot',
    });
  }
  return { messages, omitted };
}
