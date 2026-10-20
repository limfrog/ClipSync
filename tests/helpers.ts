import assert from 'node:assert/strict';
import { setTimeout } from 'node:timers/promises';

export async function until(predicate: () => boolean | Promise<boolean>, message = 'Expected condition within timeout', timeout = 3000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await setTimeout(10);
  }
  assert.fail(message);
}

export class MemoryClipboard {
  text = 'private text before connecting';
  writes: string[] = [];
  async readText() { return this.text; }
  async writeText(text: string) { this.text = text; this.writes.push(text); }
}
