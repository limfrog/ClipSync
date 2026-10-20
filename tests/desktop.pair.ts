import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, mkdtemp, open, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { setTimeout } from 'node:timers/promises';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright';
import { until } from './helpers';

interface Desktop { app: ElectronApplication; page: Page; display: string; profile: string }
interface CheckResult { name: string; status: 'passed' | 'failed'; durationMs: number; error?: string }

async function digest(file: string) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function displayServer(): Promise<{ process: ChildProcess; display: string }> {
  const process = spawn(globalThis.process.env.CLIPSYNC_XVFB || 'Xvfb', ['-displayfd', '1', '-screen', '0', '1280x1000x24', '-nolisten', 'tcp'], { stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    const display = await new Promise<string>((resolve, reject) => {
      const timer = globalThis.setTimeout(() => reject(new Error('Xvfb startup timed out')), 10000);
      let output = '';
      process.stdout!.on('data', chunk => {
        output += chunk.toString();
        if (/^\d+\n/.test(output)) { clearTimeout(timer); resolve(`:${output.trim()}`); }
      });
      process.once('error', error => { clearTimeout(timer); reject(error); });
      process.once('exit', code => { clearTimeout(timer); reject(new Error(`Xvfb startup exited: ${code}`)); });
    });
    return { process, display };
  } catch (error) {
    process.kill();
    throw error;
  }
}

async function clipboard(desktop: Desktop) {
  return desktop.app.evaluate(({ clipboard }) => clipboard.readText());
}

async function state(desktop: Desktop) {
  return desktop.page.evaluate(() => window.clipSync.state());
}

async function editor(desktop: Desktop) {
  await desktop.page.evaluate(() => {
    if (document.getElementById('verification-editor')) return;
    const editor = document.createElement('textarea');
    editor.id = 'verification-editor';
    editor.setAttribute('aria-label', '검증용 편집기');
    editor.rows = 3;
    editor.style.cssText = 'position:fixed;bottom:55px;left:12px;width:370px;z-index:5';
    document.body.append(editor);
  });
  return desktop.page.getByRole('textbox', { name: '검증용 편집기' });
}

async function copy(desktop: Desktop, text: string) {
  const field = await editor(desktop);
  await field.fill(text);
  await field.press('ControlOrMeta+A');
  await field.press('ControlOrMeta+C');
  await until(async () => await clipboard(desktop) === text, 'Native copy did not update the source clipboard', 5000);
}

async function paste(desktop: Desktop, expected: string) {
  const field = await editor(desktop);
  await field.fill('');
  await field.press('ControlOrMeta+V');
  await until(async () => await field.inputValue() === expected, 'Native paste did not insert the expected peer text', 5000);
}

async function screenshot(desktop: Desktop, file: string) {
  await desktop.page.evaluate(() => document.getElementById('verification-editor')?.remove());
  await desktop.page.screenshot({ path: file, fullPage: true });
}

test('two packaged desktops with independent OS clipboards', { timeout: 240000 }, async t => {
  assert.equal(process.platform, 'linux', 'This isolated-display test requires Linux with Xvfb');
  const executable = process.env.CLIPSYNC_EXECUTABLE || path.resolve('release/ClipSync-linux-x64/ClipSync');
  await mkdir('test-results', { recursive: true });
  const report = {
    startedAt: new Date().toISOString(), finishedAt: '',
    platform: process.platform, executable,
    executableSha256: await digest(executable),
    applicationSha256: await digest(path.join(path.dirname(executable), 'resources/app.asar')),
    version: JSON.parse(await readFile('package.json', 'utf8')).version as string,
    outcome: 'running' as 'running' | 'passed' | 'failed',
    independentDisplays: [] as string[],
    network: 'Host-generated invitation; no address or session-key override',
    checks: [] as CheckResult[],
  };
  const displays: Awaited<ReturnType<typeof displayServer>>[] = [];
  const runningApps: { app: ElectronApplication; closed: boolean }[] = [];
  const profiles: string[] = [];
  const rendererErrors: string[] = [];

  t.after(async () => {
    let cleaned = false;
    try {
      for (const running of runningApps) {
        if (!running.closed) await running.app.close();
      }
      cleaned = true;
    } finally {
      for (const display of displays) display.process.kill();
      for (const profile of profiles) await rm(profile, { recursive: true, force: true });
      report.finishedAt = new Date().toISOString();
      report.outcome = cleaned && report.checks.length === 12 && report.checks.every(check => check.status === 'passed') ? 'passed' : 'failed';
      await writeFile('test-results/pair-report.json', JSON.stringify(report, null, 2) + '\n');
    }
  });

  async function launch(): Promise<Desktop> {
    const display = await displayServer();
    displays.push(display);
    report.independentDisplays.push(display.display);
    const profile = await mkdtemp(path.join(tmpdir(), 'clipsync-pair-'));
    profiles.push(profile);
    const app = await electron.launch({
      executablePath: executable,
      args: process.env.CLIPSYNC_TEST_NO_SANDBOX === '1' ? ['--no-sandbox'] : [],
      env: { ...process.env, DISPLAY: display.display, CLIPSYNC_DATA_DIR: profile },
    });
    const running = { app, closed: false };
    runningApps.push(running);
    app.on('close', () => { running.closed = true; });
    const page = await app.firstWindow();
    page.on('pageerror', error => rendererErrors.push(error.message));
    await page.getByRole('heading', { name: 'ClipSync', exact: true }).waitFor();
    await page.getByRole('button', { name: '창 항상 위에 고정', exact: true }).click();
    const desktop = { app, page, display: display.display, profile };
    return desktop;
  }

  async function check(name: string, run: () => Promise<void>) {
    const start = performance.now();
    let failed = false;
    await t.test(name, async () => {
      try {
        await run();
        report.checks.push({ name, status: 'passed', durationMs: Math.round(performance.now() - start) });
      } catch (error) {
        failed = true;
        // Assertion messages use fixed descriptions, never invitation values.
        report.checks.push({ name, status: 'failed', durationMs: Math.round(performance.now() - start), error: error instanceof Error ? error.message : 'Unknown failure' });
        throw error;
      }
    });
    if (failed) throw new Error(`Stopped after failed prerequisite: ${name}`);
  }

  const host = await launch();
  const client = await launch();
  let invitation = '';

  await check('separate displays have independent native clipboards', async () => {
    assert.notEqual(host.display, client.display);
    await host.app.evaluate(({ clipboard }) => clipboard.writeText('host-only-before-connection'));
    await client.app.evaluate(({ clipboard }) => clipboard.writeText('client-only-before-connection'));
    assert.ok(await clipboard(host) === 'host-only-before-connection', 'Host clipboard was contaminated by the client display');
    assert.ok(await clipboard(client) === 'client-only-before-connection', 'Client clipboard was contaminated by the host display');
  });

  await check('UI rejects malformed invitations and wrong keys, then joins with the original host invitation', async () => {
    await host.page.getByRole('button', { name: '기기 연결', exact: true }).click();
    await host.page.getByRole('button', { name: '연결 열기' }).click();
    await until(async () => (await state(host)).mode === 'hosting');
    await host.page.getByRole('button', { name: '초대 코드 복사' }).click();
    invitation = await clipboard(host);
    await host.page.getByRole('button', { name: '기기 연결 닫기', exact: true }).click();
    await client.page.getByRole('button', { name: '기기 연결', exact: true }).click();
    assert.ok(invitation.startsWith('clipsync://join?'), 'Copy invitation did not write a valid code');
    const input = client.page.getByRole('textbox', { name: '초대 코드', exact: true });
    const join = client.page.getByRole('button', { name: '참여', exact: true });
    await input.fill('not-an-invitation');
    await join.click();
    await client.page.getByRole('alert').waitFor();
    assert.equal((await state(client)).mode, 'idle');
    const wrong = new URL(invitation);
    wrong.searchParams.set('key', randomBytes(32).toString('base64url'));
    await input.fill(wrong.toString());
    await join.click();
    await until(async () => await client.page.getByRole('alert').isVisible() && await join.isEnabled(), 'Wrong key was not rejected', 8000);
    assert.equal((await state(client)).mode, 'idle');
    assert.equal((await state(host)).peers, 0);

    // This transfer represents delivering the invitation through an external channel.
    await client.app.evaluate(({ clipboard }, code) => clipboard.writeText(code), invitation);
    await input.fill('');
    await input.press('ControlOrMeta+V');
    await client.app.evaluate(({ clipboard }) => clipboard.writeText('client-only-before-connection'));
    await join.click();
    await until(async () => (await state(client)).mode === 'joined' && (await state(host)).peers === 1, 'Two packaged apps did not connect', 8000);
    await setTimeout(900);
    assert.equal((await state(host)).sent, 0);
    assert.equal((await state(client)).sent, 0);
    assert.ok(await clipboard(client) === 'client-only-before-connection', 'Pre-connection clipboard content was shared');
  });

  await check('keyboard copy and paste work in both directions with Unicode and multiline text', async () => {
    const text = '첫 번째 PC에서 복사 👋\nSecond line — Ελληνικά — 日本語';
    await copy(host, text);
    await until(async () => await clipboard(client) === text, 'Host-to-client clipboard sync failed', 5000);
    await paste(client, text);
    const reply = '두 번째 PC의 답장 🖥️\nPC B → PC A';
    await copy(client, reply);
    await until(async () => await clipboard(host) === reply, 'Client-to-host clipboard sync failed', 5000);
    await paste(host, reply);
    await setTimeout(900);
    for (const desktop of [host, client]) {
      assert.equal((await state(desktop)).sent, 1);
      assert.equal((await state(desktop)).received, 1);
    }
    await screenshot(host, 'test-results/pair-host.png');
    await screenshot(client, 'test-results/pair-client.png');
  });

  await check('pause blocks sending and receiving; resume does not leak paused copies', async () => {
    await client.page.getByRole('button', { name: '기기 연결', exact: true }).click();
    await client.page.getByRole('button', { name: '일시정지', exact: true }).click();
    await client.page.getByRole('button', { name: '기기 연결 닫기', exact: true }).click();
    await until(async () => (await state(client)).paused);
    const previousHost = await clipboard(host);
    await copy(client, 'private copy while paused');
    await setTimeout(900);
    assert.ok(await clipboard(host) === previousHost, 'Paused client sent a private copy');
    await copy(host, 'host update while client is paused');
    await setTimeout(900);
    assert.ok(await clipboard(client) === 'private copy while paused', 'Paused client applied incoming clipboard content');
    await client.page.getByRole('button', { name: '기기 연결', exact: true }).click();
    await client.page.getByRole('button', { name: '동기화 재개' }).click();
    await client.page.getByRole('button', { name: '기기 연결 닫기', exact: true }).click();
    await until(async () => !(await state(client)).paused);
    await setTimeout(900);
    assert.ok(await clipboard(host) === 'host update while client is paused', 'Resume leaked an old private copy');
    await copy(client, 'new copy after resuming');
    await until(async () => await clipboard(host) === 'new copy after resuming');
  });

  await check('copying an image automatically synchronizes the real image clipboard without text loops', async () => {
    const before = (await state(host)).sent;
    const previousText = await clipboard(host);
    await host.app.evaluate(async ({ clipboard, ClipboardItem, nativeImage }) => {
      const png = nativeImage.createFromBitmap(Buffer.from([255, 255, 255, 255]), { width: 1, height: 1 }).toPNG();
      await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(png)], { type: 'image/png' }) })]);
    });
    await until(async () => await client.app.evaluate(({ clipboard }) => clipboard.has('image/png')), 'Image did not automatically enter the peer clipboard', 10000);
    await setTimeout(900);
    assert.equal((await state(host)).sent, before);
    assert.equal((await state(host)).transfers.filter(t => t.clipboard).length, 1);
    assert.equal((await state(client)).transfers.filter(t => t.clipboard).length, 1);
    await copy(host, previousText);
    await until(async () => await clipboard(client) === previousText, 'Re-copying the same preceding text after an image was lost', 5000);
    await copy(host, 'text after image');
    await until(async () => await clipboard(client) === 'text after image');
  });

  await check('1 MiB UTF-8 text transfers and an oversized copy is rejected without disconnecting', async () => {
    const limit = 1024 * 1024;
    const text = '가'.repeat(Math.floor(limit / 3)) + 'a';
    assert.equal(Buffer.byteLength(text), limit);
    await host.app.evaluate(({ clipboard }, value) => clipboard.writeText(value), text);
    await until(async () => await clipboard(client) === text, 'Maximum-size text did not arrive intact', 10000);
    const sent = (await state(host)).sent;
    await host.app.evaluate(({ clipboard }, value) => clipboard.writeText(value), text + 'b');
    await until(async () => (await state(host)).error?.includes('1MB') === true, 'Oversized clipboard was not rejected', 5000);
    assert.equal((await state(host)).sent, sent);
    assert.ok(await clipboard(client) === text, 'Oversized text changed the destination clipboard');
    await copy(host, 'normal copy after oversized rejection');
    await until(async () => await clipboard(client) === 'normal copy after oversized rejection');
  });

  await check('simultaneous native copies converge and counters settle without a loop', async () => {
    for (let round = 0; round < 5; round++) {
      const a = `simultaneous host ${round}`;
      const b = `simultaneous client ${round}`;
      await Promise.all([
        host.app.evaluate(({ clipboard }, text) => clipboard.writeText(text), a),
        client.app.evaluate(({ clipboard }, text) => clipboard.writeText(text), b),
      ]);
      await until(async () => {
        const [one, two] = await Promise.all([clipboard(host), clipboard(client)]);
        return one === two && (one === a || one === b);
      }, 'Concurrent native clipboard copies did not converge', 5000);
    }
    await setTimeout(500);
    const before = await Promise.all([state(host), state(client)]);
    await setTimeout(1200);
    const after = await Promise.all([state(host), state(client)]);
    assert.deepEqual(after.map(({ sent, received }) => ({ sent, received })), before.map(({ sent, received }) => ({ sent, received })));
  });

  await check('copying a program synchronizes Korean filename and bytes and exposes a native file clipboard', async () => {
    const source = path.join(host.profile, '한글 설치 프로그램.exe'.normalize('NFD'));
    const data = Buffer.concat([Buffer.from('MZ\0프로그램\0'), randomBytes(700_000)]);
    await writeFile(source, data);
    const destination = path.join(client.profile, 'ClipSync', '한글 설치 프로그램.exe');
    await host.app.evaluate(async ({ clipboard, ClipboardItem }, uri) => {
      await clipboard.write([new ClipboardItem({ 'text/uri-list': uri })]);
    }, pathToFileURL(source).href);
    await until(async () => (await state(client)).transfers.some(t => t.status === 'completed' && t.name === '한글 설치 프로그램.exe'), 'Program clipboard did not sync', 15000);
    assert.ok((await readFile(destination)).equals(data), 'Received program bytes differ');
    const uris = await client.app.evaluate(async ({ clipboard }) => {
      const item = (await clipboard.read()).find(item => item.types.includes('text/uri-list'));
      return item ? (await item.getType('text/uri-list')).text() : '';
    });
    await until(async () => await client.app.evaluate(({ clipboard }) => clipboard.has('text/uri-list')), 'File clipboard was not prepared');
    const actual = await client.app.evaluate(async ({ clipboard }) => {
      const item = (await clipboard.read()).find(item => item.types.includes('text/uri-list'))!;
      return (await item.getType('text/uri-list')).text();
    });
    assert.equal(fileURLToPath(actual.trim()), destination);
    assert.ok(uris === '' || uris.includes('file:'), 'Invalid native file reference');
  });

  await check('image clipboard synchronization preserves pixels and creates a reusable image history record', async () => {
    await host.app.evaluate(async ({ clipboard, ClipboardItem, nativeImage }) => {
      const png = nativeImage.createFromBitmap(Buffer.from([10, 100, 240, 255]), { width: 1, height: 1 }).toPNG();
      await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(png)], { type: 'image/png' }) })]);
    });
    await until(async () => await client.app.evaluate(async ({ clipboard, nativeImage }) => {
      const item = (await clipboard.read()).find(item => item.types.includes('image/png'));
      if (!item) return false;
      const image = nativeImage.createFromBuffer(Buffer.from(await (await item.getType('image/png')).arrayBuffer()));
      return image.getSize().width === 1 && image.toBitmap()[0] === 10 && image.toBitmap()[1] === 100;
    }), 'PNG pixels did not synchronize automatically', 10000);
    await until(async () => (await state(client)).history.some(item => item.type === 'image' && item.mediaId));
    const item = (await state(client)).history.find(item => item.type === 'image')!;
    assert.ok(item.thumbnail?.startsWith('data:image/png;'));
  });

  await check('two packaged apps exchange a full 500MB program with a Korean filename and matching SHA-256', async () => {
    const source = path.join(host.profile, '한글 대용량 프로그램.exe'.normalize('NFD'));
    const handle = await open(source, 'wx');
    await handle.truncate(500_000_000);
    const header = Buffer.concat([Buffer.from('MZ\0한글프로그램\0'), randomBytes(2048)]);
    await handle.write(header, 0, header.length, 0);
    const tail = Buffer.from('프로그램 마지막 데이터 👋');
    await handle.write(tail, 0, tail.length, 500_000_000 - tail.length);
    await handle.close();
    const destination = path.join(client.profile, 'ClipSync', '한글 대용량 프로그램.exe');
    await host.app.evaluate(async ({ clipboard, ClipboardItem }, uri) => {
      await clipboard.write([new ClipboardItem({ 'text/uri-list': uri })]);
    }, pathToFileURL(source).href);
    await until(async () => (await state(client)).transfers.some(t => t.size === 500_000_000 && t.status === 'completed') && (await state(host)).transfers.some(t => t.size === 500_000_000 && t.status === 'completed'), '500MB desktop transfer did not complete', 170000);
    assert.equal((await stat(destination)).size, 500_000_000);
    assert.equal(await digest(source), await digest(destination));
    await screenshot(host, 'test-results/pair-files-host.png');
    await screenshot(client, 'test-results/pair-files-client.png');
  });

  await check('disconnect stops sharing, a new session rejects the old code, and reconnect restores sync', async () => {
    await client.page.getByRole('button', { name: '기기 연결', exact: true }).click();
    await client.page.getByRole('button', { name: '연결 해제' }).click();
    await client.page.getByRole('button', { name: '기기 연결 닫기', exact: true }).click();
    await until(async () => (await state(host)).peers === 0 && (await state(client)).mode === 'idle');
    const existing = await clipboard(client);
    await copy(host, 'copy after peer disconnected');
    await setTimeout(900);
    assert.ok(await clipboard(client) === existing, 'Disconnected peer still received clipboard data');
    await host.page.getByRole('button', { name: '기기 연결', exact: true }).click();
    await host.page.getByRole('button', { name: '연결 해제' }).click();
    await host.page.getByRole('button', { name: '연결 열기' }).click();
    await until(async () => (await state(host)).mode === 'hosting');
    await client.page.getByRole('button', { name: '기기 연결', exact: true }).click();
    const input = client.page.getByRole('textbox', { name: '초대 코드', exact: true });
    const join = client.page.getByRole('button', { name: '참여', exact: true });
    await input.fill(invitation);
    await join.click();
    await until(async () => await client.page.getByRole('alert').isVisible() && await join.isEnabled(), 'Old session code was not rejected', 8000);
    assert.equal((await state(client)).mode, 'idle');
    await host.page.getByRole('button', { name: '초대 코드 복사' }).click();
    const fresh = await clipboard(host);
    await host.page.getByRole('button', { name: '기기 연결 닫기', exact: true }).click();
    assert.ok(fresh !== invitation, 'Session key was not rotated');
    await input.fill(fresh);
    await join.click();
    await until(async () => (await state(client)).mode === 'joined');
    await copy(client, 'copy after reconnect');
    await until(async () => await clipboard(host) === 'copy after reconnect');
  });

  await check('closing the host stops its process and returns the client to a disconnected state', async () => {
    const exited = new Promise<number | null>(resolve => host.app.process().once('exit', resolve));
    await host.app.close();
    assert.equal(await exited, 0);
    await until(async () => (await state(client)).mode === 'idle' && (await state(client)).error !== null, 'Client did not detect host shutdown', 5000);
    assert.equal((await state(client)).peers, 0);
    await screenshot(client, 'test-results/pair-host-closed.png');
    assert.deepEqual(rendererErrors, []);
  });
});
