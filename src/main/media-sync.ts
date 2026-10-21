import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import type { SyncState } from '../shared/api';
import type { TransferState } from '../shared/transfers';
import { portableFilename } from './file-names';
import type { SyncController } from './controller';

export interface MediaSnapshot { id: string; paths: string[]; image: boolean; size: number; fingerprint: string; thumbnail?: string }
export interface MediaClipboard {
  read(): Promise<MediaSnapshot | null>;
  write(snapshot: MediaSnapshot): Promise<void>;
  describe(paths: string[], image: boolean): Promise<MediaSnapshot>;
  materialize?(snapshot: MediaSnapshot): Promise<MediaSnapshot>;
}
interface Incoming {
  key: string; id: string; count: number; image: boolean; revision: number;
  entries: Map<number, { id: string; path: string }>; handling: boolean;
}

/** Clipboard synchronization orchestrates the existing bounded, authenticated file transport. */
export class MediaSync {
  private readonly timer: ReturnType<typeof setInterval>;
  private running = false;
  private closed = false;
  private seeded = false;
  private wasPaused = false;
  private epoch = 0;
  private lastSignature = '';
  private lastRevision = -1;
  private applying = 0;
  private latestIncoming = '';
  private outgoing = Promise.resolve();
  private incoming = Promise.resolve();
  private readonly accepted = new Set<string>();
  private readonly completed = new Set<string>();
  private readonly groups = new Map<string, Incoming>();
  private readonly records = new Map<string, MediaSnapshot>();
  private readonly sending = new Map<string, number>();
  private error = '';
  private pendingPoll: Promise<void> = Promise.resolve();

  constructor(private readonly controller: SyncController, private readonly io: MediaClipboard, private readonly receivedFolder: string, interval = 650) {
    this.timer = setInterval(() => { if (!this.running) this.pendingPoll = this.poll(); }, interval); this.timer.unref();
    this.pendingPoll = this.poll();
  }

  private report(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (!this.closed && message !== this.error) { this.error = message; this.controller.reportError(error); }
  }

  private async poll() {
    if (this.running || this.closed || this.applying) return;
    this.running = true;
    const epoch = this.epoch;
    const initialRevision = this.controller.state().clipboardRevision;
    try {
      let snapshot = await this.io.read();
      if (this.closed || this.applying || epoch !== this.epoch || initialRevision !== this.controller.state().clipboardRevision) return;
      const signature = snapshot?.fingerprint ?? '';
      const state = this.controller.state();
      if (!this.seeded || state.paused || this.wasPaused) {
        this.seeded = true; this.wasPaused = state.paused; this.lastSignature = signature; this.lastRevision = state.clipboardRevision; return;
      }
      // A text -> same-file copy can occur entirely between two media polls.
      // The text controller's revision still proves that this is a fresh copy.
      if (signature === this.lastSignature && state.clipboardRevision === this.lastRevision) return;
      this.lastSignature = signature; this.lastRevision = state.clipboardRevision; this.error = '';
      if (!snapshot) return;
      this.controller.mediaChanged();
      const capturedRevision = this.controller.state().clipboardRevision;
      this.lastRevision = capturedRevision;
      if (this.io.materialize) snapshot = await this.io.materialize(snapshot);
      if (this.closed || capturedRevision !== this.controller.state().clipboardRevision) return;
      this.record(snapshot, 'local');
      this.synchronize(snapshot);
    } catch (error) { this.report(error); }
    finally { this.running = false; }
  }

  private synchronize(captured: MediaSnapshot) {
    const state = this.controller.state();
    if (state.paused) return;
    const revision = state.clipboardRevision;
    const batchId = randomUUID();
    // Each authenticated destination receives the same copy; no manual recipient/upload step.
    for (const peer of state.devices) this.outgoing = this.outgoing.then(async () => {
        for (let index = 0; index < captured.paths.length; index++) {
          if (this.closed || this.controller.state().paused || this.controller.state().clipboardRevision !== revision) return;
          const id = await this.controller.sendFile(captured.paths[index], peer.id, captured.image, false,
            { id: batchId, index, count: captured.paths.length }, revision);
          this.sending.set(id, revision);
          let complete = false;
          // Slow WAN transfers remain valid while acknowledged chunks make progress.
          // TransferManager enforces an inactivity timeout instead of a fixed total duration.
          while (!this.closed) {
            const transfer = this.controller.state().transfers.find(t => t.id === id);
            if (transfer?.status === 'completed') { complete = true; break; }
            if (!transfer || ['completed', 'cancelled', 'failed'].includes(transfer.status)) break;
            await delay(100);
          }
          this.sending.delete(id);
          if (!complete) {
            await this.controller.cancelTransfer(id, '클립보드 묶음 동기화가 중단됐습니다.');
            return;
          }
        }
    }).catch(error => { if (this.controller.state().clipboardRevision === revision) this.report(error); });
  }

  observe(state: SyncState) {
    if (this.closed) return;
    for (const [id, revision] of this.sending) if (state.clipboardRevision !== revision || state.paused || state.mode === 'idle') {
      this.sending.delete(id);
      void this.controller.cancelTransfer(id, '더 새로운 클립보드가 있거나 동기화가 중지되어 이전 항목을 건너뛰었습니다.');
    }
    if (state.paused) this.wasPaused = true;
    if (state.mode === 'idle' || state.paused) {
      for (const t of state.transfers) if (t.clipboard && !['completed', 'cancelled', 'failed'].includes(t.status)) void this.controller.cancelTransfer(t.id);
      this.groups.clear(); this.latestIncoming = ''; return;
    }
    for (const transfer of state.transfers) {
      const batch = transfer.clipboard;
      if (!batch || transfer.direction !== 'receive') continue;
      const key = `${transfer.peerId}:${batch.id}`;
      if (transfer.status === 'offered' && !this.accepted.has(transfer.id)) {
        this.accepted.add(transfer.id);
        if (this.groups.size >= 16 && !this.groups.has(key) || transfer.image && batch.count !== 1) { void this.controller.cancelTransfer(transfer.id); continue; }
        if (!this.groups.has(key)) {
          this.groups.set(key, { key, id: batch.id, count: batch.count, image: transfer.image, revision: state.clipboardRevision, entries: new Map(), handling: false });
          this.latestIncoming = key;
        }
        const group = this.groups.get(key)!;
        if (group.count !== batch.count || group.image !== transfer.image) { void this.controller.cancelTransfer(transfer.id); continue; }
        void this.accept(transfer).catch(error => {
          if (this.controller.state().transfers.some(t => t.id === transfer.id && !['completed', 'cancelled', 'failed'].includes(t.status))) {
            this.report(error); void this.controller.cancelTransfer(transfer.id);
          }
        });
      }
      if (transfer.status === 'completed' && !this.completed.has(transfer.id)) {
        this.completed.add(transfer.id);
        const group = this.groups.get(key);
        if (!group || group.entries.has(batch.index)) continue;
        group.entries.set(batch.index, { id: transfer.id, path: this.controller.completedFile(transfer.id).path });
        if (group.entries.size === group.count && !group.handling) {
          group.handling = true;
          void this.finish(group).catch(error => this.report(error)).finally(() => this.groups.delete(key));
        }
      }
      if (transfer.status === 'cancelled' || transfer.status === 'failed') this.groups.delete(key);
    }
    while (this.accepted.size > 500) this.accepted.delete(this.accepted.values().next().value!);
    while (this.completed.size > 500) this.completed.delete(this.completed.values().next().value!);
  }

  private async accept(transfer: TransferState) {
    // Serialize automatic receives so simultaneous offers of the same file can
    // reuse the first completed copy instead of both downloading its bytes.
    const work = this.incoming.then(async () => {
      if (this.closed || this.controller.state().paused || this.controller.state().mode === 'idle' ||
        this.controller.state().transfers.find(t => t.id === transfer.id)?.status !== 'offered') return;
      await mkdir(this.receivedFolder, { recursive: true });
      await this.controller.acceptTransfer(transfer.id, path.join(this.receivedFolder, portableFilename(transfer.name)));
      while (!this.closed) {
        const current = this.controller.state().transfers.find(t => t.id === transfer.id);
        if (!current || ['completed', 'cancelled', 'failed'].includes(current.status)) break;
        await delay(50);
      }
    });
    this.incoming = work.catch(() => {});
    await work;
  }

  private async finish(group: Incoming) {
    const paths = [...group.entries.entries()].sort((a, b) => a[0] - b[0]).map(([, value]) => value.path);
    const snapshot = await this.io.describe(paths, group.image);
    if (this.closed) return;
    this.record(snapshot, 'remote');
    // A late large file must not overwrite a newer local copy, text, or remote batch.
    if (this.latestIncoming === group.key) await this.apply(snapshot, group.revision);
  }

  private record(snapshot: MediaSnapshot, source: 'local' | 'remote') {
    const previous = [...this.records.values()].find(item => item.fingerprint === snapshot.fingerprint);
    snapshot = { ...snapshot, id: previous?.id ?? snapshot.id };
    this.records.set(snapshot.id, snapshot);
    this.controller.recordMedia({ id: snapshot.id, type: snapshot.image ? 'image' : 'file', preview: snapshot.image ? '클립보드 이미지' : `${path.basename(snapshot.paths[0]).normalize('NFC')}${snapshot.paths.length > 1 ? ` 외 ${snapshot.paths.length - 1}개` : ''}`, source, size: snapshot.size, thumbnail: snapshot.thumbnail });
    const retained = new Set(this.controller.state().history.map(item => item.id));
    for (const id of this.records.keys()) if (!retained.has(id)) this.records.delete(id);
  }

  private async apply(snapshot: MediaSnapshot, expectedRevision?: number) {
    this.applying++;
    try {
      const applied = await this.controller.applyMedia(async () => {
        this.epoch++;
        try {
          await this.io.write(snapshot);
          this.lastSignature = (await this.io.read())?.fingerprint ?? '';
        } finally { this.epoch++; }
      }, expectedRevision);
      // Include the revision committed by applyMedia, so a remote/history write
      // is not mistaken for another local copy and sent back to the group.
      if (applied) this.lastRevision = this.controller.state().clipboardRevision;
    } finally { this.applying--; }
  }

  async copy(id: string) {
    const snapshot = this.records.get(id);
    if (!snapshot || !this.controller.state().history.some(item => item.id === id)) throw new Error('복사할 클립보드 기록이 없습니다.');
    await this.apply(snapshot);
    this.record(snapshot, 'local');
    this.synchronize(snapshot);
  }

  async dispose() { this.closed = true; clearInterval(this.timer); await Promise.all([this.outgoing, this.incoming, this.pendingPoll]); }
}
