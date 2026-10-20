import { packager } from '@electron/packager';

const paths = await packager({
  dir: '.',
  name: 'ClipSync',
  out: 'release',
  overwrite: true,
  asar: true,
  download: { cacheRoot: process.env.electron_config_cache },
  ignore: [/^\/(src|tests|scripts|release|\.cache|test-results)(\/|$)/, /^\/\.(git|github)(\/|$)/, /^\/\.env(?:\.|$)/],
});
console.log('Packaged:', paths.join(', '));
