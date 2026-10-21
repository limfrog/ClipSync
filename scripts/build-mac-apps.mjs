import { packager } from '@electron/packager';
import { readFile } from 'node:fs/promises';

const metadata = JSON.parse(await readFile('package.json', 'utf8'));

const architectures = process.argv.slice(2);
for (const arch of architectures.length ? architectures : ['arm64', 'x64']) {
  if (!['arm64', 'x64'].includes(arch)) throw new Error(`Unsupported macOS architecture: ${arch}`);
  const paths = await packager({
    dir: '.', name: 'ClipSync', appBundleId: 'dev.limfrog.clipsync',
    appCategoryType: 'public.app-category.utilities',
    platform: 'darwin', arch, out: 'release', overwrite: true, asar: true,
    buildVersion: String(metadata.buildNumber),
    icon: 'build/icons/icon.icns',
    extendInfo: { NSLocalNetworkUsageDescription: '같은 네트워크의 컴퓨터를 찾고 클립보드를 직접 동기화하기 위해 로컬 네트워크에 접근합니다.' },
    osxSign: false, asarIntegrityDigest: false,
    download: { cacheRoot: process.env.electron_config_cache },
    ignore: [/^\/(src|tests|scripts|release|build|docs|\.cache|test-results)(\/|$)/, /^\/\.(git|github)(\/|$)/, /^\/\.env(?:\.|$)/],
  });
  console.log('macOS app:', paths.join(', '));
}
