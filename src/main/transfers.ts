import { createHash, randomUUID, type Hash } from 'node:crypto';
import { constants, createReadStream } from 'node:fs';
import { copyFile, link, open, stat as fileStat, unlink, type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { CHUNK_BYTES, MAX_FILE_BYTES, type TransferPacket, type TransferState } from '../shared/transfers';
import { numberedFilename, portableFilename } from './file-names';

interface Entry {
  state: TransferState;
  sha256: string;
  source?: string;
  temporary?: boolean;
  handle?: FileHandle;
  part?: string;
  target?: string;
  saved?: string;
  hash?: Hash;
  expectedAck?: number;
  finishing?: boolean;
  lastAt: number;
}

const terminal = (state: TransferState) => ['completed', 'cancelled', 'failed'].includes(state.status);

export async function fileDigest(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

/** Stop-and-wait, bounded-memory transfer. Only acknowledged chunks advance. */
export class TransferManager {
  private readonly entries = new Map<string, Entry>();
  private queue = Promise.resolve();
  private closed = false;
  private lastEmission = 0;
  private readonly timer: ReturnType<typeof setInterval>;

  constructor(private readonly send: (packet: TransferPacket, to: string) => void, private readonly changed: (states: TransferState[]) => void) {
    this.timer = setInterval(() => {
      for (const entry of this.entries.values()) {
        const timeout = entry.state.status === 'offered' ? 10 * 60_000 : 60_000;
        if (!terminal(entry.state) && Date.now() - entry.lastAt > timeout) {
          try { this.send({ type: 'cancel', transferId: entry.state.id, reason: '응답 시간이 초과됐습니다. 다시 보내 주세요.' }, entry.state.peerId); } catch { /* disconnected */ }
          this.receive({ type: 'cancel', transferId: entry.state.id, reason: '응답 시간이 초과됐습니다. 다시 보내 주세요.' }, entry.state.peerId);
        }
      }
    }, 1000);
    this.timer.unref();
  }

  states() { return [...this.entries.values()].map(entry => ({ ...entry.state })); }

  private emit(force = true) {
    if (!force && Date.now() - this.lastEmission < 100) return;
    this.lastEmission = Date.now();
    const finished = [...this.entries.values()].filter(entry => terminal(entry.state));
    while (this.entries.size > 24 && finished.length) this.entries.delete(finished.shift()!.state.id);
    this.changed(this.states());
  }

  async offer(file: string, peerId: string, image = false, temporary = false) {
    if (this.closed) throw new Error('먼저 PC를 연결해 주세요.');
    if ([...this.entries.values()].filter(e => e.state.direction === 'send' && !terminal(e.state)).length >= 4) throw new Error('한 번에 파일 4개까지 보낼 수 있습니다.');
    // Windows rejects opening a directory before fstat; validate it portably first.
    if (!(await fileStat(file)).isFile()) throw new Error('폴더와 macOS .app은 ZIP으로 압축한 뒤 보내 주세요.');
    const handle = await open(file, 'r');
    let retained = false;
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) throw new Error('폴더와 macOS .app은 ZIP으로 압축한 뒤 보내 주세요.');
      if (stat.size > MAX_FILE_BYTES) throw new Error('파일당 500MB(500,000,000바이트) 이하만 보낼 수 있습니다.');
      const hash = createHash('sha256');
      for await (const chunk of handle.createReadStream({ start: 0, autoClose: false })) {
        if (this.closed) throw new Error('연결이 해제됐습니다.');
        hash.update(chunk);
      }
      if (this.closed) throw new Error('연결이 해제됐습니다.');
      const after = await handle.stat();
      if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs) throw new Error('파일이 변경됐습니다. 저장을 마친 뒤 다시 보내 주세요.');
      const entry: Entry = {
        state: { id: randomUUID(), peerId, name: portableFilename(path.basename(file)), size: stat.size, bytes: 0, image, direction: 'send', status: 'offered', error: null },
        sha256: hash.digest('hex'), source: file, handle, temporary, lastAt: Date.now(),
      };
      this.entries.set(entry.state.id, entry);
      retained = true;
      try {
        this.send({ type: 'offer', transferId: entry.state.id, name: entry.state.name, size: stat.size, sha256: entry.sha256, image }, peerId);
      } catch (error) { await this.fail(entry, error); throw error; }
      this.emit();
      return entry.state.id;
    } finally {
      if (!retained) { await handle.close(); if (temporary) await unlink(file).catch(() => {}); }
    }
  }

  async accept(id: string, destination: string) {
    const work = this.queue.then(() => this.acceptNow(id, destination));
    this.queue = work.catch(() => {});
    return work;
  }

  private async acceptNow(id: string, destination: string) {
    const entry = this.entries.get(id);
    if (!entry || entry.state.direction !== 'receive' || entry.state.status !== 'offered' || this.closed) throw new Error('수신 대기 중인 파일이 아닙니다.');
    if ([...this.entries.values()].filter(e => e.state.status === 'receiving').length >= 2) throw new Error('한 번에 파일 2개까지 받을 수 있습니다.');
    entry.state.status = 'receiving';
    try {
      entry.target = path.join(path.dirname(destination), portableFilename(path.basename(destination)));
      entry.part = path.join(path.dirname(entry.target), `.clipsync-${entry.state.id}.part`);
      entry.handle = await open(entry.part, 'wx', 0o600);
      entry.hash = createHash('sha256');
      entry.lastAt = Date.now();
      this.send({ type: 'accept', transferId: id }, entry.state.peerId);
      this.emit();
    } catch (error) { await this.fail(entry, error); throw error; }
  }

  receive(packet: TransferPacket, from: string) {
    if (this.closed) return;
    this.queue = this.queue.then(async () => {
      if (this.closed) return;
      if (packet.type === 'offer') {
        if (this.entries.has(packet.transferId)) return;
        if ([...this.entries.values()].filter(e => !terminal(e.state)).length >= 16) {
          this.send({ type: 'cancel', transferId: packet.transferId, reason: '수신 대기 파일이 너무 많습니다.' }, from);
          return;
        }
        this.entries.set(packet.transferId, {
          state: { id: packet.transferId, direction: 'receive', peerId: from, name: portableFilename(packet.name), size: packet.size, bytes: 0, image: packet.image, status: 'offered', error: null },
          sha256: packet.sha256, lastAt: Date.now(),
        });
        this.emit();
        return;
      }
      const entry = this.entries.get(packet.transferId);
      if (!entry || entry.state.peerId !== from || terminal(entry.state)) return;
      entry.lastAt = Date.now();
      try {
        if (packet.type === 'cancel') {
          entry.state.status = 'cancelled';
          entry.state.error = packet.reason;
          await this.cleanup(entry);
          this.emit();
        } else if (packet.type === 'accept' && entry.state.direction === 'send' && entry.state.status === 'offered') {
          entry.state.status = 'sending';
          await this.next(entry);
        } else if (packet.type === 'ack' && entry.state.direction === 'send' && entry.state.status === 'sending') {
          if (packet.offset !== entry.expectedAck || packet.offset <= entry.state.bytes) throw new Error('파일 전송 순서가 올바르지 않습니다.');
          entry.state.bytes = packet.offset;
          await this.next(entry);
        } else if (packet.type === 'chunk' && entry.state.direction === 'receive' && entry.state.status === 'receiving') {
          const data = Buffer.from(packet.data, 'base64');
          if (!data.length || data.length > CHUNK_BYTES || data.toString('base64') !== packet.data || packet.offset !== entry.state.bytes || data.length > entry.state.size - entry.state.bytes) throw new Error('파일 조각이 올바르지 않습니다.');
          let written = 0;
          while (written < data.length) {
            const result = await entry.handle!.write(data, written, data.length - written, entry.state.bytes + written);
            if (!result.bytesWritten) throw new Error('파일을 저장할 수 없습니다.');
            written += result.bytesWritten;
          }
          entry.hash!.update(data);
          entry.state.bytes += data.length;
          this.send({ type: 'ack', transferId: entry.state.id, offset: entry.state.bytes }, from);
          this.emit(false);
        } else if (packet.type === 'finish' && entry.state.direction === 'receive' && entry.state.status === 'receiving') {
          if (entry.state.bytes !== entry.state.size || entry.hash!.digest('hex') !== entry.sha256) throw new Error('원본과 일치하지 않아 파일을 저장하지 않았습니다. 다시 보내 주세요.');
          await entry.handle!.sync();
          await entry.handle!.close();
          entry.handle = undefined;
          entry.saved = await this.publish(entry);
          entry.part = undefined;
          entry.state.name = path.basename(entry.saved);
          entry.state.status = 'completed';
          // A lost final acknowledgement must not invalidate an already verified file.
          try { this.send({ type: 'done', transferId: entry.state.id }, from); } catch { /* file is safely saved */ }
          this.emit();
        } else if (packet.type === 'done' && entry.state.direction === 'send' && entry.finishing) {
          entry.state.status = 'completed';
          await this.cleanup(entry);
          this.emit();
        } else throw new Error('예상하지 못한 파일 전송 메시지입니다.');
      } catch (error) { await this.fail(entry, error); }
    }).catch(() => { /* A disconnected peer must not create an unhandled rejection. */ });
  }

  private async next(entry: Entry) {
    if (entry.state.bytes === entry.state.size) {
      entry.finishing = true;
      this.send({ type: 'finish', transferId: entry.state.id }, entry.state.peerId);
    } else {
      const data = Buffer.allocUnsafe(Math.min(CHUNK_BYTES, entry.state.size - entry.state.bytes));
      const result = await entry.handle!.read(data, 0, data.length, entry.state.bytes);
      if (!result.bytesRead) throw new Error('원본 파일이 변경되거나 삭제됐습니다.');
      entry.expectedAck = entry.state.bytes + result.bytesRead;
      this.send({ type: 'chunk', transferId: entry.state.id, offset: entry.state.bytes, data: data.subarray(0, result.bytesRead).toString('base64') }, entry.state.peerId);
    }
    this.emit(entry.finishing || entry.state.bytes === 0);
  }

  private async publish(entry: Entry) {
    const base = path.basename(entry.target!);
    for (let number = 0; number < 10000; number++) {
      const target = path.join(path.dirname(entry.target!), number ? numberedFilename(base, number) : base);
      try {
        try { await link(entry.part!, target); }
        catch (error) {
          if (!['EPERM', 'ENOSYS', 'ENOTSUP', 'EOPNOTSUPP', 'EXDEV'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
          await copyFile(entry.part!, target, constants.COPYFILE_EXCL);
        }
        await unlink(entry.part!);
        return target;
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    }
    throw new Error('같은 이름의 파일이 너무 많습니다. 다른 저장 위치를 선택해 주세요.');
  }

  private async cleanup(entry: Entry) {
    const handle = entry.handle;
    entry.handle = undefined;
    await handle?.close().catch(() => {});
    if (entry.part) { await unlink(entry.part).catch(() => {}); entry.part = undefined; }
    if (entry.temporary && entry.source) { await unlink(entry.source).catch(() => {}); entry.source = undefined; }
  }

  private async fail(entry: Entry, error: unknown) {
    entry.state.status = 'failed';
    entry.state.error = error instanceof Error ? error.message : '파일 전송에 실패했습니다.';
    try { this.send({ type: 'cancel', transferId: entry.state.id, reason: entry.state.error.slice(0, 240) }, entry.state.peerId); } catch { /* disconnected */ }
    await this.cleanup(entry);
    this.emit();
  }

  async cancel(id: string) {
    const entry = this.entries.get(id);
    if (!entry || terminal(entry.state)) return;
    try { this.send({ type: 'cancel', transferId: id, reason: '사용자가 전송을 취소했습니다.' }, entry.state.peerId); } catch { /* disconnected */ }
    this.receive({ type: 'cancel', transferId: id, reason: '사용자가 전송을 취소했습니다.' }, entry.state.peerId);
    await this.queue;
  }

  peersChanged(ids: string[]) {
    for (const entry of this.entries.values()) {
      if (!terminal(entry.state) && !ids.includes(entry.state.peerId)) this.receive({ type: 'cancel', transferId: entry.state.id, reason: '상대 PC와 연결이 해제됐습니다.' }, entry.state.peerId);
    }
  }

  completedFile(id: string) {
    const entry = this.entries.get(id);
    if (!entry?.saved || entry.state.status !== 'completed' || entry.state.direction !== 'receive') throw new Error('수신이 완료된 파일이 아닙니다.');
    return { path: entry.saved, image: entry.state.image };
  }

  async abortAll() {
    this.closed = true;
    clearInterval(this.timer);
    await this.queue;
    for (const entry of this.entries.values()) {
      if (!terminal(entry.state)) { entry.state.status = 'cancelled'; entry.state.error = '연결이 해제됐습니다.'; }
      await this.cleanup(entry);
    }
    this.emit();
  }
}
