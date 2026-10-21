import assert from 'node:assert/strict';
import { test } from 'node:test';
import { restoreWindowBounds } from '../src/main/window-bounds';

test('window restores resized geometry and legacy positions within connected displays', () => {
  const primary = { x: 0, y: 0, width: 1280, height: 900 };
  const left = { x: -1920, y: 0, width: 1920, height: 1080 };
  const areas = [primary, left];
  assert.deepEqual(restoreWindowBounds({ x: -1800, y: 100, width: 640, height: 800 }, areas, primary), { x: -1800, y: 100, width: 640, height: 800 });
  assert.deepEqual(restoreWindowBounds({ x: 100, y: 60 }, areas, primary), { x: 100, y: 60, width: 400, height: 760 });
  assert.deepEqual(restoreWindowBounds({ x: -1800, y: 100, width: 640, height: 800 }, [primary], primary), { width: 640, height: 800 });
  assert.deepEqual(restoreWindowBounds({ x: 1200, y: 850, width: 9000, height: 9000 }, areas, primary), { x: 0, y: 0, width: 1280, height: 900 });
  const fullHeight = { x: 20, y: 0, width: 640, height: 900 };
  assert.deepEqual(restoreWindowBounds(restoreWindowBounds(fullHeight, areas, primary), areas, primary), fullHeight, 'Restoring a saved height must not shrink it on every restart');
  assert.deepEqual(restoreWindowBounds({ width: 100, height: 100 }, areas, primary), { width: 360, height: 480 });
  assert.deepEqual(restoreWindowBounds({ width: 'oops', height: null }, areas, primary), { width: 400, height: 760 });
});
