import type { App } from 'electron';
import type { Preferences } from '../shared/history';

type NativeLogin = Pick<App, 'isPackaged' | 'getLoginItemSettings' | 'setLoginItemSettings'>;
export class LoginStartup {
  constructor(private readonly app: NativeLogin, private readonly platform = process.platform, private readonly executable = process.execPath) {}
  private options() { return this.platform === 'win32' ? { path: `"${this.executable}"`, args: ['--startup'] } : {}; }
  info(): Pick<Preferences, 'startOnLogin' | 'startupStatus'> {
    if (!this.app.isPackaged || !['win32', 'darwin'].includes(this.platform)) return { startOnLogin: false, startupStatus: 'unsupported' };
    let native: Electron.LoginItemSettings;
    try { native = this.app.getLoginItemSettings(this.options()); }
    catch { return { startOnLogin: false, startupStatus: 'unavailable' }; }
    if (this.platform === 'win32') {
      // Electron's openAtLogin only looks up the default AppUserModelID key,
      // even when setLoginItemSettings uses our custom name. launchItems also
      // reflects Task Manager's approval state for this specific user entry.
      // Chromium excludes --switches from launchItems.args, so that list cannot
      // verify --startup. The query already filters by this executable's path.
      const item = native.launchItems.find(item => item.scope === 'user' && item.name === 'ClipSync');
      return { startOnLogin: item?.enabled === true, startupStatus: !item ? 'disabled' : item.enabled ? 'enabled' : 'blocked' };
    }
    if (this.platform === 'darwin' && native.status === 'requires-approval') return { startOnLogin: true, startupStatus: 'requires-approval' };
    return { startOnLogin: native.openAtLogin, startupStatus: native.openAtLogin ? 'enabled' : 'disabled' };
  }
  set(enabled: boolean) {
    if (this.info().startupStatus === 'unavailable') throw new Error('자동 시작 설정을 확인할 수 없습니다. 시스템의 로그인 항목 설정을 확인해 주세요.');
    if (this.info().startupStatus === 'unsupported') {
      if (enabled) throw new Error('부팅 시 시작은 설치된 Windows·Mac 앱에서 사용할 수 있습니다.');
      return;
    }
    this.app.setLoginItemSettings({ ...this.options(), openAtLogin: enabled,
      ...(this.platform === 'win32' ? { name: 'ClipSync', ...(enabled ? { enabled: true } : {}) } : {}) });
    const actual = this.info();
    if (actual.startOnLogin !== enabled) throw new Error(this.platform === 'darwin'
      ? 'ClipSync를 응용 프로그램 폴더에 설치한 뒤 로그인 항목 설정을 확인해 주세요.'
      : 'Windows 설정의 앱 > 시작 프로그램에서 ClipSync를 허용해 주세요.');
  }
  startedAtLogin() {
    if (this.info().startupStatus === 'unsupported') return false;
    if (process.argv.includes('--startup')) return true;
    try { return this.platform === 'darwin' && this.app.getLoginItemSettings(this.options()).wasOpenedAtLogin; }
    catch { return false; }
  }
}
