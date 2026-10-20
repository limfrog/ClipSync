import './style.css';
import type { ClipSyncAPI, Result, SyncState } from '../shared/api';
import { DEFAULT_PREFERENCES, type HistoryItem, type Preferences } from '../shared/history';
import type { ConnectionInfo } from '../shared/group';
import type { TransferState } from '../shared/transfers';

declare global { interface Window { clipSync: ClipSyncAPI } }
function element<T extends HTMLElement = HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing element: ${id}`);
  return found as T;
}
const connection = element<HTMLDialogElement>('connection-dialog');
const settings = element<HTMLDialogElement>('settings-dialog');
let current: SyncState;
let preferences: Preferences = { ...DEFAULT_PREFERENCES };
let busy = false;
let filter = 'all';
let historySignature = '';
let transferSignature = '';
let peerSignature = '';
let toastTimer: ReturnType<typeof setTimeout>;

function notice(message: string) {
  element('notice').textContent = message;
  element('notice').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { element('notice').hidden = true; }, 3000);
}
function showError(message: string | null) {
  for (const [id, visible] of [['error', !connection.open && !settings.open], ['connection-error', connection.open], ['settings-error', settings.open]] as const) {
    element(id).textContent = message ?? '';
    element(id).hidden = !message || !visible;
  }
}
function enabled() {
  document.querySelectorAll<HTMLButtonElement>('button').forEach(button => { button.disabled = busy; });
}
async function act(action: () => Promise<Result>, success?: string) {
  if (busy) return;
  busy = true; enabled(); showError(null);
  try {
    const result = await action();
    if (!result.ok) showError(result.error ?? '요청을 처리할 수 없습니다.');
    else if (success) notice(success);
    return result;
  } catch { showError('앱과 통신할 수 없습니다. 다시 시도해 주세요.'); }
  finally { busy = false; enabled(); }
}
function updatePreferences(value: Preferences) {
  preferences = value;
  document.documentElement.dataset.theme = value.theme;
  element('pin-window').setAttribute('aria-pressed', String(value.alwaysOnTop));
  element('shortcut').textContent = value.shortcutAvailable === false ? '단축키 사용 불가' : value.shortcut.replace(/CommandOrControl/g, 'Ctrl/⌘').replaceAll('+', ' + ');
}
function render(state: SyncState) {
  current = state;
  const connected = state.mode !== 'idle';
  element('status').textContent = state.paused ? '동기화 일시정지' : state.peers ? `${state.peers}대 P2P 연결` : state.groupStatus === 'reconnecting' ? '자동 재연결 중' : connected ? 'P2P 기기 찾는 중' : '연결 대기';
  element('status').classList.toggle('connected', state.peers > 0 && !state.paused);
  element('group-form').hidden = connected;
  element('group-panel').hidden = !connected;
  element('session-actions').hidden = !connected;
  element('session-title').textContent = state.paused ? '재개한 뒤 새로 복사하는 내용부터 동기화합니다.' : state.peers ? 'PC끼리 클립보드를 직접 동기화합니다. 다른 PC가 종료돼도 이 연결은 유지됩니다.' : '같은 키와 비밀번호를 입력한 PC를 자동으로 찾고 있습니다.';
  element('pause').textContent = state.paused ? '동기화 재개' : '일시정지';
  for (const [id, value] of [['peer-count', state.peers], ['sent-count', state.sent], ['received-count', state.received]] as const) element(id).textContent = String(value);
  showError(state.error);
  const signature = JSON.stringify(state.devices);
  if (signature !== peerSignature) {
    peerSignature = signature;
    const devices = element('devices'); devices.replaceChildren();
    for (const [index, name] of ['이 PC', ...state.devices.map(peer => peer.name)].entries()) {
      const chip = document.createElement('span'); chip.className = 'device-chip'; chip.textContent = name;
      if (index > 0) chip.title = state.devices[index - 1].transport === 'lan' ? '내부 네트워크 직접 연결' : 'P2P 직접 연결';
      devices.append(chip);
    }
    if (!state.devices.length) { const hint = document.createElement('span'); hint.className = 'device-hint'; hint.textContent = '기기 연결에서 다른 PC를 추가하세요'; devices.append(hint); }
  }
  const transfers = state.transfers.filter(t => t.status !== 'completed');
  const transfersKey = JSON.stringify(transfers);
  if (transfersKey !== transferSignature) {
    transferSignature = transfersKey;
    element('transfer-list').replaceChildren(...transfers.slice().reverse().map(t => transferCard(t)));
  }
  renderHistory(); enabled();
}
function size(bytes: number) { return bytes >= 1_000_000 ? `${(bytes / 1_000_000).toLocaleString('ko-KR', { maximumFractionDigits: 1 })} MB` : `${(bytes / 1000).toLocaleString('ko-KR', { maximumFractionDigits: 1 })} KB`; }
function actionButton(label: string, action: string, id: string, className = 'button secondary') {
  const button = document.createElement('button'); button.type = 'button'; button.className = className; button.textContent = label; button.dataset.action = action; button.dataset.id = id; return button;
}
function transferCard(transfer: TransferState) {
  const row = document.createElement('article'); row.className = 'clip-card transfer-row'; row.dataset.transferId = transfer.id;
  const info = document.createElement('div'); info.className = 'transfer-info';
  const name = document.createElement('strong'); name.textContent = `${transfer.image ? '▧' : '↗'}  ${transfer.name}`;
  const detail = document.createElement('p');
  const labels = { offered: transfer.direction === 'receive' ? '수신 대기' : '상대 PC의 수락 대기', sending: '보내는 중', receiving: '받는 중', completed: '전송 완료', cancelled: '취소됨', failed: '전송 실패' };
  detail.textContent = `${transfer.clipboard ? '클립보드 동기화' : transfer.direction === 'send' ? '보내기' : '받기'} · ${transfer.reused ? '기존 파일 사용' : labels[transfer.status]} · ${transfer.reused ? size(transfer.size) : `${size(transfer.bytes)} / ${size(transfer.size)}`}${transfer.error ? ` · ${transfer.error}` : ''}`;
  info.append(name, detail); row.append(info);
  if (!transfer.reused && (transfer.status === 'sending' || transfer.status === 'receiving')) {
    const progress = document.createElement('progress'); progress.max = transfer.size || 1; progress.value = transfer.bytes; progress.setAttribute('aria-label', `${transfer.name} 전송 진행률`); info.append(progress);
  }
  const actions = document.createElement('div'); actions.className = 'transfer-actions';
  if (!transfer.clipboard && transfer.status === 'offered' && transfer.direction === 'receive') actions.append(actionButton('받기', 'accept', transfer.id));
  if (['offered', 'sending', 'receiving'].includes(transfer.status)) actions.append(actionButton(transfer.direction === 'receive' && transfer.status === 'offered' ? '거절' : '취소', 'cancel', transfer.id));
  if (transfer.status === 'completed' && transfer.direction === 'receive') {
    actions.append(actionButton('폴더 열기', 'show', transfer.id));
    if (transfer.image) actions.append(actionButton('이미지 복사', 'image', transfer.id));
  }
  row.append(actions); return row;
}
function historyCard(item: HistoryItem, latest: boolean) {
  const card = item.transfer ? transferCard(item.transfer) : document.createElement('article');
  card.classList.add('clip-card'); card.classList.toggle('latest-active', latest); card.dataset.historyId = item.id;
  const top = document.createElement('div'); top.className = 'clip-top';
  const type = document.createElement('span'); type.className = 'clip-type'; type.textContent = item.type === 'text' ? (/^https?:\/\/\S+$/.test(item.preview) ? 'LINK' : 'TEXT') : item.type === 'image' ? 'IMAGE' : 'FILE';
  const time = document.createElement('time'); time.dateTime = item.copiedAt; time.textContent = new Date(item.copiedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  top.append(type, time); card.prepend(top);
  if (item.type === 'text' || item.mediaId) {
    const preview = actionButton(item.preview, 'copy', item.id, 'clip-preview'); preview.title = '클릭하여 다시 복사'; card.append(preview);
    if (item.thumbnail) { const image = document.createElement('img'); image.className = 'media-preview'; image.src = item.thumbnail; image.alt = '클립보드 이미지 미리보기'; preview.append(image); }
    if (item.size !== undefined) { const meta = document.createElement('p'); meta.className = 'media-size'; meta.textContent = `${size(item.size)} · 클릭하면 클립보드로 복사`; card.append(meta); }
  }
  const bottom = document.createElement('div'); bottom.className = 'clip-bottom';
  const source = document.createElement('span'); source.textContent = `${item.source === 'local' ? '이 PC' : '연결된 PC'}${item.pinned ? ' · 고정됨' : ''}`;
  const actions = document.createElement('div'); actions.className = 'clip-actions';
  if (item.type === 'text' || item.mediaId) actions.append(actionButton('복사', 'copy', item.id, ''));
  const pin = actionButton(item.pinned ? '고정 해제' : '고정', 'pin', item.id, ''); pin.setAttribute('aria-pressed', String(item.pinned));
  actions.append(pin, actionButton('삭제', 'delete', item.id, ''));
  bottom.append(source, actions); card.append(bottom); return card;
}
function renderHistory() {
  if (!current) return;
  const query = element<HTMLInputElement>('search').value.toLocaleLowerCase();
  const key = JSON.stringify([current.history, query, filter]);
  if (key === historySignature) return;
  historySignature = key;
  const items = current.history.filter(item => (filter === 'all' || (filter === 'pinned' ? item.pinned : item.type === filter)) && item.preview.toLocaleLowerCase().includes(query)).sort((a, b) => Number(b.pinned) - Number(a.pinned));
  const list = element('history-list'); list.replaceChildren(...items.map((item, index) => historyCard(item, index === 0)));
  if (!items.length) {
    const empty = document.createElement('div'); empty.className = 'empty-history';
    const icon = document.createElement('span'); icon.className = 'empty-icon'; icon.textContent = '▤'; icon.ariaHidden = 'true';
    const heading = document.createElement('h2'); heading.textContent = current.history.length || filter !== 'all' || query ? '일치하는 기록이 없어요' : '클립보드가 비어 있어요';
    const hint = document.createElement('p'); hint.textContent = current.history.length || filter !== 'all' || query ? '검색어나 기록 유형을 바꿔보세요.' : '텍스트, 스크린샷, 파일을 복사해 보세요. 기록을 클릭하면 다시 사용할 수 있어요.';
    empty.append(icon, heading, hint); list.append(empty);
  }
}

for (const id of ['open-connection', 'open-settings']) element(id).addEventListener('click', async () => {
  if (id === 'open-connection') {
    connection.showModal();
    void window.clipSync.connection().then(updateConnection).catch(() => showError('연결 정보를 읽을 수 없습니다.'));
  }
  else {
    try { updatePreferences(await window.clipSync.preferences()); } catch { showError('설정을 읽을 수 없습니다.'); return; }
    element<HTMLSelectElement>('theme').value = preferences.theme;
    element<HTMLInputElement>('shortcut-setting').value = preferences.shortcut;
    const startup = element<HTMLInputElement>('start-on-login');
    startup.checked = preferences.startOnLogin;
    startup.disabled = preferences.startupStatus === 'unsupported';
    element('startup-note').textContent = preferences.startupStatus === 'requires-approval' ? '시스템 설정 > 일반 > 로그인 항목에서 ClipSync를 허용해 주세요.' : preferences.startupStatus === 'blocked' ? 'Windows 설정 > 앱 > 시작 프로그램에서 ClipSync를 허용해 주세요.' : preferences.startupStatus === 'unsupported' ? '부팅 시 시작은 설치된 Windows·Mac 앱에서 사용할 수 있습니다.' : '컴퓨터에 로그인하면 트레이·메뉴바에서 자동으로 시작합니다.';
    settings.showModal();
  }
});
document.querySelectorAll<HTMLButtonElement>('[data-close]').forEach(button => button.addEventListener('click', () => element<HTMLDialogElement>(button.dataset.close!).close()));
element('search').addEventListener('input', renderHistory);
document.querySelectorAll<HTMLButtonElement>('[data-filter]').forEach(button => button.addEventListener('click', () => {
  filter = button.dataset.filter!;
  document.querySelectorAll('[data-filter]').forEach(tab => tab.setAttribute('aria-selected', String(tab === button)));
  renderHistory();
}));
function updateConnection(value: ConnectionInfo) {
  element('group-key-display').textContent = value.groupKey;
  element('remember-status').textContent = value.remembered ? '보안 저장됨 · 다음 실행에도 자동 연결' : '이번 실행에서 연결 중 · 보안 저장소를 사용할 수 없으면 재실행 후 다시 입력해야 합니다.';
  if (!current || current.mode === 'idle') element<HTMLInputElement>('group-key').value = value.groupKey;
}
element('generate-key').addEventListener('click', () => {
  void window.clipSync.createGroupKey().then(key => { element<HTMLInputElement>('group-key').value = key; }).catch(() => showError('연결 키를 만들 수 없습니다.'));
});
element('group-form').addEventListener('submit', event => {
  event.preventDefault();
  const input = { groupKey: element<HTMLInputElement>('group-key').value.trim(), password: element<HTMLInputElement>('group-password').value };
  void act(async () => {
    const result = await window.clipSync.connectGroup(input);
    if (result.ok) { element<HTMLInputElement>('group-password').value = ''; updateConnection(await window.clipSync.connection()); }
    return result;
  });
});
element('copy-group-key').addEventListener('click', () => { void act(() => window.clipSync.copyGroupKey(), '연결 키를 복사했어요. 비밀번호도 별도로 전달하세요.'); });
element('copy-diagnostics').addEventListener('click', () => { void act(() => window.clipSync.copyDiagnostics(), '키·비밀번호·클립보드 내용을 제외한 연결 상태를 복사했어요.'); });
element('rediscover').addEventListener('click', () => { void act(() => window.clipSync.rediscover(), '기기를 다시 찾고 있어요.'); });
element('pause').addEventListener('click', () => { void act(() => window.clipSync.pause(!current.paused)); });
element('disconnect').addEventListener('click', () => { void act(async () => { const result = await window.clipSync.disconnect(); if (result.ok) { updateConnection({ groupKey: '', remembered: false }); element<HTMLInputElement>('group-password').value = ''; } return result; }); });
element('settings-form').addEventListener('submit', event => {
  event.preventDefault();
  void act(async () => {
    const result = await window.clipSync.configure({ ...preferences, theme: element<HTMLSelectElement>('theme').value as Preferences['theme'], shortcut: element<HTMLInputElement>('shortcut-setting').value.trim(), startOnLogin: element<HTMLInputElement>('start-on-login').checked });
    if (result.ok) settings.close(); return result;
  }, '설정을 저장했어요.');
});
element('pin-window').addEventListener('click', () => { void act(() => window.clipSync.configure({ ...preferences, alwaysOnTop: !preferences.alwaysOnTop })); });
element('hide-window').addEventListener('click', () => { void act(() => window.clipSync.hide()); });
element('quit').addEventListener('click', () => { void act(() => window.clipSync.quit()); });
element('open-downloads').addEventListener('click', () => { void act(() => window.clipSync.openDownloads()); });
element('clear-history').addEventListener('click', () => { void act(() => window.clipSync.history('clear'), '고정한 항목을 남기고 기록을 비웠어요.'); });
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !connection.open && !settings.open) { event.preventDefault(); void act(() => window.clipSync.hide()); }
});
element('history-list').addEventListener('click', dispatchAction);
element('transfer-list').addEventListener('click', dispatchAction);
function dispatchAction(event: MouseEvent) {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]');
  if (!button?.dataset.id) return;
  const id = button.dataset.id;
  const actions: Record<string, () => Promise<Result>> = {
    accept: () => window.clipSync.acceptTransfer(id), cancel: () => window.clipSync.cancelTransfer(id), show: () => window.clipSync.showFile(id), image: () => window.clipSync.copyImage(id),
    copy: () => window.clipSync.history('copy', id), pin: () => window.clipSync.history('pin', id), delete: () => window.clipSync.history('delete', id),
  };
  if (actions[button.dataset.action!]) void act(actions[button.dataset.action!], button.dataset.action === 'copy' || button.dataset.action === 'image' ? '클립보드에 복사했어요.' : undefined);
}
window.clipSync.subscribe(render);
window.clipSync.onPreferences(updatePreferences);
void Promise.all([window.clipSync.state().then(render), window.clipSync.preferences().then(updatePreferences), window.clipSync.connection().then(updateConnection)]).catch(() => showError('앱을 다시 실행해 주세요.'));
