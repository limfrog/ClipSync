const appFiles = ['dist/**/*', 'package.json', 'THIRD_PARTY_NOTICES.txt', '!node_modules/**/prebuilds/**/*.bare'];

module.exports = {
  appId: 'dev.limfrog.clipsync',
  productName: 'ClipSync',
  directories: { output: 'release/installers' },
  files: [...appFiles],
  asar: true,
  asarUnpack: ['node_modules/**/prebuilds/**/*'],
  npmRebuild: false,
  publish: null,
  win: {
    icon: 'build/icons/icon.ico',
    // An ignore-only platform file set adds a separate **/* matcher in electron-builder.
    // Include the application allowlist here too, so local releases/caches never enter ASAR.
    files: [...appFiles, '!node_modules/**/prebuilds/{android-*,ios-*,linux-*,darwin-*}/**/*'],
    target: [{ target: 'nsis', arch: ['x64'] }],
    artifactName: 'ClipSync-${version}-Windows-${arch}-Setup.${ext}',
    signExecutable: false,
  },
  nsis: {
    installerIcon: 'build/icons/icon.ico',
    uninstallerIcon: 'build/icons/icon.ico',
    script: 'build/windows-installer.nsi',
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: false,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'ClipSync',
    runAfterFinish: true,
    installerLanguages: ['ko_KR', 'en_US'],
    displayLanguageSelector: true,
    uninstallDisplayName: 'ClipSync',
  },
  mac: {
    icon: 'build/icons/icon.icns',
    files: [...appFiles, '!node_modules/**/prebuilds/{android-*,ios-*,linux-*,win32-*}/**/*'],
    target: [{ target: 'pkg', arch: ['arm64', 'x64'] }],
    category: 'public.app-category.utilities',
    extendInfo: { NSLocalNetworkUsageDescription: '같은 네트워크의 컴퓨터를 찾고 클립보드를 직접 동기화하기 위해 로컬 네트워크에 접근합니다.' },
    identity: '-',
    hardenedRuntime: false,
    artifactName: 'ClipSync-${version}-macOS-${arch}.${ext}',
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.plist',
  },
  pkg: { installLocation: '/Applications', isRelocatable: false },
};
