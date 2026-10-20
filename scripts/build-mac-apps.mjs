import { packager } from '@electron/packager';

const architectures = process.argv.slice(2);
for (const arch of architectures.length ? architectures : ['arm64', 'x64']) {
  if (!['arm64', 'x64'].includes(arch)) throw new Error(`Unsupported macOS architecture: ${arch}`);
  const paths = await packager({
    dir: '.', name: 'ClipSync', appBundleId: 'dev.limfrog.clipsync',
    appCategoryType: 'public.app-category.utilities',
    platform: 'darwin', arch, out: 'release', overwrite: true, asar: true,
    osxSign: false, asarIntegrityDigest: false,
    download: { cacheRoot: process.env.electron_config_cache },
    ignore: [/^\/(src|tests|scripts|release|build|docs|\.cache|test-results)(\/|$)/, /^\/\.(git|github)(\/|$)/, /^\/\.env(?:\.|$)/],
  });
  console.log('macOS app:', paths.join(', '));
}
