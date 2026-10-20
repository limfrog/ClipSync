import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ClipboardHistory } from '../src/main/history';
import { SyncController } from '../src/main/controller';
import { MemoryClipboard, until } from './helpers';

test('history deduplicates exact text, preserves full Unicode copies, and excludes invitations', () => {
  const history = new ClipboardHistory();
  const text = '한글 👋\n'.repeat(1000);
  history.recordText(text, 'local');
  const first = history.state()[0];
  assert.equal(first.preview.length, 1000);
  assert.equal(history.text(first.id), text);
  history.pin(first.id);
  history.recordText('second', 'local');
  history.recordText(text, 'remote');
  assert.equal(history.state().length, 2);
  assert.equal(history.state()[0].id, first.id);
  assert.equal(history.state()[0].pinned, true);
  assert.equal(history.state()[0].source, 'remote');
  history.recordText('clipsync://private-invitation', 'local');
  assert.equal(history.state().length, 2);
  history.clear();
  assert.equal(history.state().length, 1);
  history.delete(first.id);
  assert.throws(() => history.text(first.id));
});

test('history bounds item count and full-text memory even when records are pinned', () => {
  const history = new ClipboardHistory();
  for (let i = 0; i < 120; i++) { history.recordText(`항목 ${i}`, 'local'); history.pin(history.state()[0].id); }
  assert.equal(history.state().length, 100);
  const big = new ClipboardHistory();
  for (let i = 0; i < 8; i++) { big.recordText(String(i).repeat(1024 * 1024), 'local'); big.pin(big.state()[0].id); }
  assert.equal(big.state().length, 4);
  assert.ok(JSON.stringify(big.state()).length < 5000, 'IPC must carry previews rather than full megabyte texts');
});

test('offline history starts with new copies, and explicitly re-copying a record synchronizes without loops', async t => {
  const a = new MemoryClipboard(); a.text = 'before app startup';
  const b = new MemoryClipboard();
  const host = new SyncController(a, () => {}, 15);
  const client = new SyncController(b, () => {}, 15);
  t.after(async () => { await client.dispose(); await host.dispose(); });
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(host.state().history.length, 0);
  a.text = 'offline copy 한글';
  await until(() => host.state().history.length === 1);
  await host.host(0, '127.0.0.1'); await client.join(host.state().invitation);
  a.text = 'connected copy';
  await until(() => b.text === 'connected copy' && client.state().history.length === 1);
  assert.equal(client.state().history[0].source, 'remote');
  const id = host.state().history.find(item => item.preview === 'offline copy 한글')!.id;
  await host.manageHistory('copy', id);
  assert.equal(a.text, 'offline copy 한글');
  await until(() => b.text === 'offline copy 한글');
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(host.state().sent, 2);
  assert.equal(client.state().sent, 0);
  await host.copyInvitation();
  assert.ok(!host.state().history.some(item => item.preview.startsWith('clipsync://')));
});
