import { randomUUID } from 'node:crypto';
import type { HistoryItem } from '../shared/history';
import type { TransferState } from '../shared/transfers';

/** Session-only history. Previews cross IPC; full text stays in bounded memory. */
export class ClipboardHistory {
  revision = 0;
  private items: HistoryItem[] = [];
  private readonly texts = new Map<string, string>();
  private textBytes = 0;

  state(): HistoryItem[] { return this.items.map(item => ({ ...item, ...(item.transfer ? { transfer: { ...item.transfer } } : {}) })); }

  recordText(text: string, source: HistoryItem['source']) {
    if (!text || text.startsWith('clipsync://')) return;
    const previous = this.items.find(item => item.type === 'text' && this.texts.get(item.id) === text);
    if (previous) this.items = this.items.filter(item => item !== previous);
    const item: HistoryItem = {
      id: previous?.id ?? randomUUID(), type: 'text', preview: text.slice(0, 1000),
      source, pinned: previous?.pinned ?? false, copiedAt: new Date().toISOString(),
    };
    if (!previous) { this.texts.set(item.id, text); this.textBytes += Buffer.byteLength(text); }
    this.items.unshift(item);
    this.revision++;
    this.trim();
  }

  recordTransfer(transfer: TransferState) {
    if (transfer.clipboard) return;
    if (transfer.status !== 'completed' || this.items.some(item => item.id === transfer.id)) return;
    this.items.unshift({ id: transfer.id, type: transfer.image ? 'image' : 'file', preview: transfer.name,
      source: transfer.direction === 'receive' ? 'remote' : 'local', pinned: false,
      copiedAt: new Date().toISOString(), transfer: { ...transfer } });
    this.revision++;
    this.trim();
  }

  recordMedia(item: Pick<HistoryItem, 'id' | 'type' | 'preview' | 'source' | 'size' | 'thumbnail'>) {
    const existing = this.items.find(entry => entry.id === item.id);
    this.items = this.items.filter(entry => entry.id !== item.id);
    this.items.unshift({ ...item, mediaId: item.id, pinned: existing?.pinned ?? false, copiedAt: new Date().toISOString() });
    this.revision++;
    this.trim();
  }

  text(id: string) {
    const text = this.texts.get(id);
    if (text === undefined) throw new Error('복사할 텍스트 기록이 없습니다.');
    return text;
  }

  pin(id: string) {
    const item = this.items.find(item => item.id === id);
    if (!item) throw new Error('기록을 찾을 수 없습니다.');
    item.pinned = !item.pinned;
    this.revision++;
  }

  delete(id: string) {
    this.revision++;
    const text = this.texts.get(id);
    if (text !== undefined) { this.textBytes -= Buffer.byteLength(text); this.texts.delete(id); }
    this.items = this.items.filter(item => item.id !== id);
  }

  clear() { for (const item of [...this.items]) if (!item.pinned) this.delete(item.id); }

  private trim() {
    while (this.items.length > 100 || this.textBytes > 4 * 1024 * 1024) {
      const candidate = this.items.findLast(item => !item.pinned && item !== this.items[0]) ?? this.items.at(-1)!;
      this.delete(candidate.id);
    }
  }
}
