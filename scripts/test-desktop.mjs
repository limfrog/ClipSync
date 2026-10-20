import { spawn } from 'node:child_process';

let displayServer;
const env = { ...process.env };

try {
  if (process.platform === 'linux' && !env.DISPLAY) {
    displayServer = spawn(env.CLIPSYNC_XVFB || 'Xvfb', ['-displayfd', '1', '-screen', '0', '1280x900x24', '-nolisten', 'tcp'], { stdio: ['ignore', 'pipe', 'inherit'] });
    env.DISPLAY = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Xvfb startup timed out')), 10000);
      let output = '';
      displayServer.stdout.on('data', chunk => {
        output += chunk.toString();
        if (/^\d+\n/.test(output)) { clearTimeout(timeout); resolve(`:${output.trim()}`); }
      });
      displayServer.once('error', error => { clearTimeout(timeout); reject(error); });
      displayServer.once('exit', code => { clearTimeout(timeout); reject(new Error(`Xvfb exited: ${code}`)); });
    });
  }
  const runner = spawn(process.execPath, ['--import', 'tsx', '--test', process.argv[2] ?? 'tests/desktop.smoke.ts'], { env, stdio: 'inherit' });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => runner.kill(signal));
  process.exitCode = await new Promise((resolve, reject) => {
    runner.once('error', reject);
    runner.once('exit', code => resolve(code ?? 1));
  });
} catch (error) {
  console.error(error.message);
  console.error('Linux headless: install Xvfb or set CLIPSYNC_XVFB to its executable.');
  process.exitCode = 1;
} finally {
  displayServer?.kill();
}
