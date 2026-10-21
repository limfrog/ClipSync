import { packager } from '@electron/packager';
import { readFile } from 'node:fs/promises';

const metadata = JSON.parse(await readFile('package.json', 'utf8'));

const paths = await packager({
  dir: '.',
  name: 'ClipSync',
  buildVersion: process.platform === 'win32' ? `${metadata.version}.${metadata.buildNumber}` : String(metadata.buildNumber),
  out: 'release',
  overwrite: true,
  asar: true,
  icon: process.platform === 'win32' ? 'build/icons/icon.ico' : process.platform === 'darwin' ? 'build/icons/icon.icns' : 'assets/icon.png',
  download: { cacheRoot: process.env.electron_config_cache },
  ignore: [/^\/(src|tests|scripts|release|\.cache|test-results)(\/|$)/, /^\/\.(git|github)(\/|$)/, /^\/\.env(?:\.|$)/],
});
console.log('Packaged:', paths.join(', '));
