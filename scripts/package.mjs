import { packager } from '@electron/packager';

const paths = await packager({
  dir: '.',
  name: 'ClipSync',
  out: 'release',
  overwrite: true,
  asar: true,
  icon: process.platform === 'win32' ? 'build/icons/icon.ico' : process.platform === 'darwin' ? 'build/icons/icon.icns' : 'assets/icon.png',
  download: { cacheRoot: process.env.electron_config_cache },
  ignore: [/^\/(src|tests|scripts|release|\.cache|test-results)(\/|$)/, /^\/\.(git|github)(\/|$)/, /^\/\.env(?:\.|$)/],
});
console.log('Packaged:', paths.join(', '));
