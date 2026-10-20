import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { SyncController } from '../src/main/controller';
import { MediaSync, type MediaClipboard, type MediaSnapshot } from '../src/main/media-sync';
import { MemoryClipboard, until } from './helpers';
import { isTransferPacket } from '../src/shared/transfers';

class Media implements MediaClipboard {
  current: MediaSnapshot | null = null;
  writes = 0;
  gate?: Promise<void>;
  async read() { return this.current; }
  async write(snapshot: MediaSnapshot) { this.current = snapshot; this.writes++; }
  async describe(paths: string[], image: boolean) {
    await this.gate;
    const sizes = await Promise.all(paths.map(async p => (await stat(p)).size));
    return { id: randomUUID(), paths, image, size: sizes.reduce((a,b) => a+b,0), fingerprint: paths.join('|') };
  }
}
async function pair(t: TestContext) {
  const root = await mkdtemp(path.join(tmpdir(), 'clipsync-auto-'));
  const textA = new MemoryClipboard(), textB = new MemoryClipboard();
  const mediaA = new Media(), mediaB = new Media();
  let syncA: MediaSync | undefined, syncB: MediaSync | undefined;
  // A native clipboard has one current representation; a file/image replaces text.
  const a = new SyncController({ readText: () => mediaA.current ? null : textA.readText(), writeText: text => { mediaA.current = null; textA.writeText(text); } }, s => syncA?.observe(s), 10);
  const b = new SyncController({ readText: () => mediaB.current ? null : textB.readText(), writeText: text => { mediaB.current = null; textB.writeText(text); } }, s => syncB?.observe(s), 10);
  await a.host(0, '127.0.0.1'); await b.join(a.state().invitation);
  syncA = new MediaSync(a, mediaA, path.join(root, 'A'), 15);
  syncB = new MediaSync(b, mediaB, path.join(root, 'B'), 15);
  t.after(async () => { await a.dispose(); await b.dispose(); await syncA?.dispose(); await syncB?.dispose(); await rm(root, { recursive: true, force: true }); });
  await delay(50);
  async function copied(name: string, image = false) {
    const file = path.join(root, name); await writeFile(file, Buffer.from('프로그램 바이트\0\xff 한글'));
    return mediaA.describe([file], image);
  }
  return { root, a, b, mediaA, mediaB, textA, textB, copied, syncA, syncB };
}

test('copied files synchronize and become the receiver clipboard without upload, accept, or copy actions', async t => {
  const { a,b,mediaA,mediaB,copied } = await pair(t);
  mediaA.current = await copied('한글 프로그램.exe'.normalize('NFD'));
  await until(() => mediaB.writes === 1, 'Automatic clipboard synchronization did not finish', 5000);
  assert.equal(path.basename(mediaB.current!.paths[0]), '한글 프로그램.exe');
  assert.deepEqual(await readFile(mediaB.current!.paths[0]), await readFile(mediaA.current.paths[0]));
  assert.equal(b.state().history.find(item => item.type === 'file')?.source, 'remote');
  await delay(100);
  assert.equal(mediaA.writes, 0);
  assert.equal(mediaB.writes, 1);
  assert.equal(a.state().transfers.length, 1);
  assert.equal(b.state().transfers.length, 1);
});

test('multiple copied files commit to the receiving clipboard as one complete batch', async t => {
  const { mediaA,mediaB,copied } = await pair(t);
  const first = await copied('첫 번째.exe'); const second = await copied('두 번째.zip');
  mediaA.current = await mediaA.describe([...first.paths, ...second.paths], false);
  await until(() => mediaB.writes === 1, 'Batch was not applied', 5000);
  assert.deepEqual(mediaB.current!.paths.map(p => path.basename(p)), ['첫 번째.exe','두 번째.zip']);
});

test('re-copying a received media history item synchronizes it back without a feedback loop', async t => {
  const { a,b,mediaA,mediaB,copied,syncB,textA } = await pair(t);
  mediaA.current = await copied('기록에서 다시 복사.exe');
  await until(() => mediaB.writes === 1, 'Initial file did not synchronize', 5000);
  const record = b.state().history.find(item => item.mediaId)!;
  mediaA.current = null; mediaB.current = null; textA.text = '파일 이후 복사한 텍스트';
  await until(() => b.state().received === 1);
  await syncB.copy(record.id);
  await until(() => mediaA.writes === 1, 'History activation did not update the other clipboard', 5000);
  assert.deepEqual(await readFile(mediaA.current!.paths[0]), await readFile(mediaB.current!.paths[0]));
  await delay(100);
  assert.equal(a.state().transfers.length, 2);
  assert.equal(b.state().transfers.length, 2);
});

test('a late media completion stays in history and cannot replace a newer text copy', async t => {
  const { a,b,mediaA,mediaB,textB,copied } = await pair(t);
  let release!: () => void;
  mediaB.gate = new Promise<void>(resolve => { release = resolve; });
  t.after(() => release());
  mediaA.current = await copied('늦게 도착한 파일.exe');
  await until(() => b.state().transfers.some(t => t.status === 'completed'), 'File bytes did not complete', 5000);
  textB.text = '이 파일보다 나중에 복사한 텍스트';
  await until(() => a.state().received === 1);
  release();
  await until(() => b.state().history.some(item => item.type === 'file'));
  assert.equal(mediaB.writes, 0);
  assert.equal(textB.text, '이 파일보다 나중에 복사한 텍스트');
});

test('paused media synchronization does not receive or leak a private copy on resume', async t => {
  const { a,b,mediaA,mediaB,copied } = await pair(t);
  await b.pause(true);
  mediaB.current = await copied('개인 파일.exe');
  mediaA.current = await copied('일시정지 중 이미지.png', true);
  await until(() => a.state().transfers.some(t => t.status === 'cancelled'), 'Paused receiver did not reject the automatic offer', 5000);
  await delay(80);
  await b.pause(false); await delay(100);
  assert.equal(mediaB.writes, 0);
  assert.equal(mediaA.writes, 0);
  mediaA.current = await copied('재개 이후 이미지.png', true);
  await until(() => mediaB.writes === 1, 'Media did not resume', 5000);
});

test('a newer copy cancels an older queued media item instead of blocking the clipboard', async t => {
  const { a,b,mediaA,textA,textB,copied } = await pair(t);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const accept = b.acceptTransfer.bind(b);
  b.acceptTransfer = async (id, destination) => { await gate; await accept(id, destination); };
  t.after(() => release());
  mediaA.current = await copied('이전 클립보드.exe');
  await until(() => a.state().transfers.some(t => t.status === 'offered'), 'Previous offer was not sent', 5000);
  mediaA.current = null; textA.text = '더 새로 복사한 내용';
  await until(() => textB.text === textA.text);
  await until(() => a.state().transfers.some(t => t.status === 'cancelled'), 'Old queued copy still blocks synchronization', 5000);
  release();
});

test('automatic clipboard metadata rejects malformed and oversized batches', () => {
  const packet = { type:'offer', transferId:randomUUID(), name:'한글.exe', size:100, sha256:'a'.repeat(64), image:false, clipboard:{id:randomUUID(), index:0, count:2} };
  assert.equal(isTransferPacket(packet), true);
  assert.equal(isTransferPacket({...packet, clipboard:{...packet.clipboard,count:17}}), false);
  assert.equal(isTransferPacket({...packet, clipboard:{...packet.clipboard,index:2}}), false);
  assert.equal(isTransferPacket({...packet, clipboard:{...packet.clipboard,id:'invalid'}}), false);
});

test('a rejected file stops the rest of its clipboard batch', async t => {
  const { a,b,mediaA,copied } = await pair(t);
  b.acceptTransfer = async () => { throw new Error('수신 공간이 부족합니다.'); };
  const first = await copied('받을 수 없는 파일.exe'); const second = await copied('다음 파일.zip');
  mediaA.current = await mediaA.describe([...first.paths, ...second.paths], false);
  await until(() => a.state().transfers.some(t => t.status === 'cancelled'), 'Rejected offer did not cancel', 5000);
  await delay(150);
  assert.equal(a.state().transfers.length, 1);
});
