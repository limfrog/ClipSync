import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_TEXT_BYTES, RecentMessages, createInvitation, createKey, open, parseInvitation, proof, seal, verifyProof } from '../src/main/protocol';

test('IPv4 and IPv6 invitations round-trip; malformed codes are rejected', () => {
  for (const host of ['192.168.1.12', '::1']) {
    const invitation = { host, port: 47832, key: createKey() };
    assert.deepEqual(parseInvitation(createInvitation(invitation)), invitation);
  }
  for (const code of ['hello', 'https://example.com', 'clipsync://join?host=example.com&port=80&key=x', createInvitation({ host: '127.0.0.1', port: 0, key: createKey() })]) {
    assert.throws(() => parseInvitation(code));
  }
});

test('clipboard text is encrypted, supports Unicode and empty strings, and detects tampering', () => {
  const key = createKey();
  for (const text of ['안녕하세요 👋\n다른 PC에서 붙여넣기', 'secret-clipboard-content', '']) {
    const wire = seal(key, text);
    if (text) assert.ok(!wire.includes(text));
    assert.equal(open(key, wire).text, text);
    assert.throws(() => open(createKey(), wire));
    const changed = JSON.parse(wire);
    const tag = Buffer.from(changed.tag, 'base64');
    tag[0] ^= 1;
    changed.tag = tag.toString('base64');
    assert.throws(() => open(key, JSON.stringify(changed)));
  }
});

test('text limits apply to UTF-8 bytes; handshake proofs are role- and challenge-bound', () => {
  const key = createKey();
  assert.throws(() => seal(key, '가'.repeat(MAX_TEXT_BYTES / 3 + 1)));
  const candidate = proof(key, 'client', 'challenge');
  assert.ok(verifyProof(key, 'client', 'challenge', candidate));
  assert.ok(!verifyProof(key, 'server', 'challenge', candidate));
  assert.ok(!verifyProof(key, 'client', 'other', candidate));
  assert.ok(!verifyProof(key, 'client', 'challenge', null));
});

test('duplicate messages are discarded with bounded memory', () => {
  const seen = new RecentMessages();
  assert.ok(seen.accept('first'));
  assert.ok(!seen.accept('first'));
  for (let i = 0; i < 1024; i++) seen.accept(String(i));
  assert.ok(seen.accept('first'));
});
