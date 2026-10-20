import { networkInterfaces } from 'node:os';
import type { SyncState } from '../shared/api';
import { createInvitation, createKey, MAX_TEXT_BYTES, parseInvitation } from './protocol';
import { hostSession, joinSession, type Session } from './session';
import { TransferManager } from './transfers';
import type { ClipboardBatch, Peer, TransferPacket } from '../shared/transfers';
import type { HistoryItem } from '../shared/history';
import { ClipboardHistory } from './history';
import type { GroupCredentials } from '../shared/group';
import { groupSession, type P2POptions } from './group-session';

export interface Clipboard { readText(): string | null | Promise<string | null>; writeText(text: string): void | Promise<void> }

export class SyncController {
  private readonly history = new ClipboardHistory();
  private readonly recordedTransfers = new Set<string>();
  private session: Session | null = null;
  private files: TransferManager | null = null;
  private readonly savedFiles = new Map<string, { path: string; image: boolean }>();
  private lastText: string | null = null;
  private connecting = false;
  private generation = 0;
  private readonly privateTexts = new Set<string>();
  private polling = false;
  private clipboardQueue = Promise.resolve();
  private readonly timer: ReturnType<typeof setInterval>;
  private current: SyncState = {
    mode: 'idle', paused: false, peers: 0, invitation: '', sent: 0,
    received: 0, lastActivity: null, error: null, devices: [], transfers: [], history: [], clipboardRevision: 0, historyRevision: 0,
  };

  constructor(private readonly clipboard: Clipboard, private readonly changed: (state: SyncState) => void, interval = 350) {
    void this.enqueue(async () => { this.lastText = await this.clipboard.readText(); }).catch(() => {});
    this.timer = setInterval(() => { void this.poll(); }, interval);
    this.timer.unref();
  }

  state(): SyncState { return { ...this.current, historyRevision: this.history.revision, history: this.history.state(), devices: this.current.devices.map(p => ({ ...p })), transfers: this.current.transfers.map(t => ({ ...t })) }; }

  private enqueue<T>(action: () => T | Promise<T>): Promise<T> {
    const next = this.clipboardQueue.then(action);
    this.clipboardQueue = next.then(() => {}, () => {});
    return next;
  }

  private update(patch: Partial<SyncState>) {
    this.current = { ...this.current, ...patch };
    this.changed(this.state());
  }

  private readonly callbacks = {
    onText: (text: string, localEcho = false) => {
      const generation = this.generation;
      void this.enqueue(async () => {
        if (!this.session || this.current.paused || generation !== this.generation) return;
        await this.clipboard.writeText(text);
        this.lastText = text;
        if (!localEcho) {
          this.history.recordText(text, 'remote');
          this.update({ received: this.current.received + 1, lastActivity: new Date().toISOString(), error: null, clipboardRevision: this.current.clipboardRevision + 1 });
        }
      }).catch(() => this.update({ error: '클립보드에 쓸 수 없습니다. 앱 권한을 확인해 주세요.' }));
    },
    onPeers: (peers: number) => this.update({ peers }),
    onDisconnect: (reason: string) => { void this.disconnect(reason); },
    onDevices: (devices: Peer[]) => { this.files?.peersChanged(devices.map(peer => peer.id)); this.update({ devices }); },
    onTransfer: (packet: TransferPacket, from: string) => this.files?.receive(packet, from),
  };

  private async connect(action: () => Promise<void>) {
    if (this.session || this.connecting) throw new Error('현재 연결을 먼저 해제해 주세요.');
    this.connecting = true;
    this.update({ error: null, sent: 0, received: 0, lastActivity: null, paused: false });
    try {
      await action();
      const session = this.session!;
      const files = new TransferManager((packet, to) => session.sendTransfer(packet, to), transfers => {
        for (const transfer of transfers) {
          if (transfer.direction === 'receive' && transfer.status === 'completed') this.savedFiles.set(transfer.id, files.completedFile(transfer.id));
          if (transfer.status === 'completed' && !this.recordedTransfers.has(transfer.id)) {
            this.recordedTransfers.add(transfer.id);
            this.history.recordTransfer(transfer);
          }
        }
        while (this.savedFiles.size > 100) this.savedFiles.delete(this.savedFiles.keys().next().value!);
        while (this.recordedTransfers.size > 200) this.recordedTransfers.delete(this.recordedTransfers.values().next().value!);
        this.update({ transfers });
      });
      this.files = files;
      await this.enqueue(async () => { this.lastText = await this.clipboard.readText(); });
    } catch (error) {
      await this.disconnect();
      throw error;
    } finally {
      this.connecting = false;
    }
  }

  async host(port?: number, address?: string) {
    await this.connect(async () => {
      const host = address ?? Object.values(networkInterfaces()).flat().find(info => info?.family === 'IPv4' && !info.internal)?.address;
      if (!host) throw new Error('사용할 네트워크 주소가 없습니다. Wi-Fi 또는 유선 네트워크에 연결해 주세요.');
      const key = createKey();
      try {
        const session = await hostSession(key, this.callbacks, port);
        this.session = session;
        this.update({ mode: 'hosting', invitation: createInvitation({ host, port: session.port, key }) });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') throw new Error('47832 포트를 사용 중입니다. 다른 ClipSync 연결을 종료해 주세요.');
        throw error;
      }
    });
  }

  async join(code: string) {
    const invitation = parseInvitation(code);
    await this.connect(async () => {
      this.session = await joinSession(invitation, this.callbacks);
      this.update({ mode: 'joined', invitation: '' });
    });
  }

  async connectGroup(credentials: GroupCredentials, options: P2POptions = {}) {
    this.privateTexts.add(credentials.groupKey);
    await this.connect(async () => {
      const generation = ++this.generation;
      const guarded = <A extends unknown[]>(callback: (...args: A) => void) => (...args: A) => { if (generation === this.generation) callback(...args); };
      this.session = groupSession(credentials, {
        onText: guarded(this.callbacks.onText), onPeers: guarded(this.callbacks.onPeers),
        onDevices: guarded(this.callbacks.onDevices), onTransfer: guarded(this.callbacks.onTransfer),
        onStatus: guarded((groupStatus, error) => this.update({ groupStatus, error: error ?? null })),
      }, options);
      this.update({ mode: 'group', groupStatus: 'discovering', invitation: '' });
    });
  }

  protectText(text: string) { this.privateTexts.add(text); if (this.privateTexts.size > 32) this.privateTexts.delete(this.privateTexts.values().next().value!); }
  async copyGroupKey(key: string) {
    this.privateTexts.add(key);
    await this.enqueue(async () => { await this.clipboard.writeText(key); this.lastText = key; });
  }

  async disconnect(error: string | null = null) {
    this.generation++;
    const session = this.session;
    const files = this.files;
    this.session = null;
    this.files = null;
    this.update({ mode: 'idle', groupStatus: undefined, peers: 0, invitation: '', paused: false, error, devices: [] });
    await files?.abortAll();
    await session?.close();
  }

  async pause(paused: boolean) {
    if (!this.session) throw new Error('먼저 다른 PC와 연결해 주세요.');
    if (typeof paused !== 'boolean') throw new Error('잘못된 요청입니다.');
    // Resuming only shares new copies, never material copied while paused.
    await this.enqueue(async () => {
      this.lastText = await this.clipboard.readText();
      this.update({ paused });
    });
  }

  async copyInvitation() {
    if (this.current.mode !== 'hosting') throw new Error('먼저 연결을 열어 주세요.');
    await this.enqueue(async () => {
      await this.clipboard.writeText(this.current.invitation);
      // An invitation is a session secret; never relay it as clipboard content.
      this.lastText = this.current.invitation;
    });
  }

  async sendFile(file: string, peerId: string, image = false, temporary = false, batch?: ClipboardBatch, revision?: number) {
    if (!this.files || !this.current.devices.some(peer => peer.id === peerId)) throw new Error('받을 PC를 먼저 선택해 주세요.');
    return this.files.offer(file, peerId, image, temporary, batch, batch ? () => this.current.clipboardRevision === revision && !this.current.paused : undefined);
  }

  async acceptTransfer(id: string, destination: string) {
    if (!this.files) throw new Error('연결이 해제됐습니다.');
    await this.files.accept(id, destination);
  }

  async cancelTransfer(id: string, reason?: string) { await this.files?.cancel(id, reason); }

  async manageHistory(action: string, id?: string) {
    if (action === 'clear') this.history.clear();
    else {
      if (typeof id !== 'string') throw new Error('기록을 선택해 주세요.');
      if (action === 'copy') {
        const text = this.history.text(id);
        await this.enqueue(async () => {
          await this.clipboard.writeText(text); this.lastText = text;
          this.history.recordText(text, 'local'); this.current.clipboardRevision++;
          if (this.session && this.current.peers && !this.current.paused) {
            this.session.publish(text);
            this.current.sent++; this.current.lastActivity = new Date().toISOString();
          }
        });
      } else if (action === 'pin') this.history.pin(id);
      else if (action === 'delete') this.history.delete(id);
      else throw new Error('잘못된 기록 요청입니다.');
    }
    this.update({});
  }

  recordMedia(item: Pick<HistoryItem, 'id' | 'type' | 'preview' | 'source' | 'size' | 'thumbnail'>) {
    this.history.recordMedia(item);
    this.update({});
  }

  async applyMedia(action: () => Promise<void>, expectedRevision?: number) {
    let applied = false;
    await this.enqueue(async () => {
      if (expectedRevision !== undefined && (!this.session || this.current.paused || this.current.clipboardRevision !== expectedRevision)) return;
      await action(); this.lastText = await this.clipboard.readText(); applied = true;
    });
    if (applied) this.update({ clipboardRevision: this.current.clipboardRevision + 1 });
    return applied;
  }

  mediaChanged() {
    // The preceding text is no longer the current clipboard representation.
    // Copying that same text again after a file/image is a new copy operation.
    this.lastText = null;
    this.update({ clipboardRevision: this.current.clipboardRevision + 1 });
  }
  reportError(error: unknown) { this.update({ error: error instanceof Error ? error.message : String(error) }); }

  completedFile(id: string) {
    const saved = this.savedFiles.get(id);
    if (saved) return saved;
    if (this.files) return this.files.completedFile(id);
    throw new Error('수신이 완료된 파일이 아닙니다.');
  }

  private async poll() {
    if (this.current.paused || this.polling || this.connecting) return;
    this.polling = true;
    try {
      await this.enqueue(async () => {
        const text = await this.clipboard.readText();
        if (this.current.paused || text === null || text === this.lastText) return;
        this.lastText = text;
        if (text.startsWith('clipsync://') || this.privateTexts.has(text)) return;
        if (Buffer.byteLength(text, 'utf8') > MAX_TEXT_BYTES) {
          this.update({ error: '1MB를 초과한 텍스트는 건너뛰었습니다.' });
          return;
        }
        this.history.recordText(text, 'local');
        this.current.clipboardRevision++;
        if (!this.session || this.current.peers === 0) { this.update({}); return; }
        this.session.publish(text);
        this.update({ sent: this.current.sent + 1, lastActivity: new Date().toISOString(), error: null });
      });
    } catch (error) {
      this.update({ error: error instanceof Error ? error.message : '클립보드를 읽을 수 없습니다.' });
    } finally {
      this.polling = false;
    }
  }

  async dispose() {
    clearInterval(this.timer);
    await this.disconnect();
    await this.clipboardQueue;
  }
}
