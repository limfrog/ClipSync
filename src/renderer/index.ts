import './style.css';
import type { ClipSyncAPI, Result, SyncState } from '../shared/api';
import type { TransferState } from '../shared/transfers';

declare global { interface Window { clipSync: ClipSyncAPI } }

function element<T extends HTMLElement = HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing element: ${id}`);
  return found as T;
}

let current: SyncState;
let busy = false;
let noticeTimer: ReturnType<typeof setTimeout> | undefined;
let renderedPeers = '';
let renderedTransfers = '';

function render(state: SyncState) {
  current = state;
  const connected = state.mode !== 'idle';
  element('status').textContent = state.paused ? '일시정지' : connected ? '연결 열림' : '연결 대기';
  element('status').classList.toggle('connected', connected && !state.paused);
  element('session-actions').hidden = !connected;
  element('connection-grid').hidden = connected;
  element('invitation-panel').hidden = state.mode !== 'hosting';
  element('pause').textContent = state.paused ? '동기화 재개' : '일시정지';
  element('session-title').textContent = state.paused ? '이 PC의 동기화를 잠시 멈췄어요' : state.mode === 'hosting' ? (state.peers ? 'PC들이 연결됐어요' : '다른 PC의 참여를 기다리고 있어요') : state.mode === 'joined' ? '호스트 PC와 연결됐어요' : 'PC를 연결할 준비가 됐어요';
  element('session-detail').textContent = state.paused ? '재개한 뒤 새로 복사하는 텍스트부터 공유합니다.' : connected ? '새 텍스트를 복사한 뒤, 연결된 PC에서 붙여넣어 보세요.' : '한 PC에서 연결을 열고, 다른 PC에서 참여하세요.';
  element('peer-count').textContent = String(state.peers);
  element('sent-count').textContent = String(state.sent);
  element('received-count').textContent = String(state.received);
  element('last-activity').textContent = state.lastActivity ? new Date(state.lastActivity).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '아직 없어요';
  showError(state.error);
  const signature = JSON.stringify(state.devices);
  if (signature !== renderedPeers) {
    renderedPeers = signature;
    const select = element<HTMLSelectElement>('recipient');
    const previous = select.value;
    select.replaceChildren(...state.devices.map(peer => new Option(`${peer.name} · ${peer.id === 'host' ? '호스트' : peer.id.slice(0, 6)}`, peer.id)));
    if (!state.devices.length) select.add(new Option('연결된 PC가 없습니다', ''));
    if (state.devices.some(peer => peer.id === previous)) select.value = previous;
  }
  renderTransfers(state.transfers);
  updateEnabled();
}

function size(bytes: number) { return bytes >= 1_000_000 ? `${(bytes / 1_000_000).toLocaleString('ko-KR', { maximumFractionDigits: 1 })} MB` : `${(bytes / 1000).toLocaleString('ko-KR', { maximumFractionDigits: 1 })} KB`; }

function renderTransfers(transfers: TransferState[]) {
  const signature = JSON.stringify(transfers);
  if (signature === renderedTransfers) return;
  renderedTransfers = signature;
  const list = element('transfer-list');
  list.replaceChildren();
  if (!transfers.length) {
    const empty = document.createElement('p'); empty.className = 'empty-transfers'; empty.textContent = '아직 주고받은 파일이 없습니다.'; list.append(empty); return;
  }
  for (const transfer of [...transfers].reverse()) {
    const row = document.createElement('article'); row.className = 'transfer-row'; row.dataset.transferId = transfer.id;
    const info = document.createElement('div'); info.className = 'transfer-info';
    const name = document.createElement('strong'); name.textContent = transfer.name;
    const detail = document.createElement('p');
    const labels = { offered: transfer.direction === 'receive' ? '수신 대기' : '상대 PC의 수락 대기', sending: '보내는 중', receiving: '받는 중', completed: '전송 완료', cancelled: '취소됨', failed: '전송 실패' };
    detail.textContent = `${transfer.direction === 'send' ? '보내기' : '받기'} · ${labels[transfer.status]} · ${size(transfer.bytes)} / ${size(transfer.size)}${transfer.error ? ` · ${transfer.error}` : ''}`;
    info.append(name, detail);
    if (transfer.status === 'sending' || transfer.status === 'receiving') {
      const progress = document.createElement('progress'); progress.max = transfer.size || 1; progress.value = transfer.bytes; progress.setAttribute('aria-label', `${transfer.name} 전송 진행률`); info.append(progress);
    }
    const actions = document.createElement('div'); actions.className = 'transfer-actions';
    function button(text: string, action: string) {
      const button = document.createElement('button'); button.className = 'button secondary'; button.textContent = text; button.dataset.action = action; button.dataset.id = transfer.id; actions.append(button);
    }
    if (transfer.status === 'offered' && transfer.direction === 'receive') button('받기', 'accept');
    if (['offered', 'sending', 'receiving'].includes(transfer.status)) button(transfer.direction === 'receive' && transfer.status === 'offered' ? '거절' : '취소', 'cancel');
    if (transfer.status === 'completed' && transfer.direction === 'receive') { button('폴더 열기', 'show'); if (transfer.image) button('이미지 복사', 'copy'); }
    row.append(info, actions); list.append(row);
  }
}

function updateEnabled() {
  document.querySelectorAll<HTMLButtonElement>('button').forEach(button => { button.disabled = busy; });
  for (const id of ['send-file', 'send-image']) element<HTMLButtonElement>(id).disabled = busy || !current?.devices.length;
  element<HTMLSelectElement>('recipient').disabled = busy || !current?.devices.length;
}

function showError(message: string | null) {
  element('error').hidden = !message;
  element('error').textContent = message ?? '';
}

async function act(action: () => Promise<Result>) {
  if (busy) return;
  busy = true;
  showError(null);
  updateEnabled();
  try {
    const result = await action();
    if (!result.ok) showError(result.error ?? '요청을 처리할 수 없습니다.');
  } catch {
    showError('앱과 통신할 수 없습니다. 앱을 다시 실행해 주세요.');
  } finally {
    busy = false;
    updateEnabled();
  }
}

element('host').addEventListener('click', () => { void act(() => window.clipSync.host()); });
element('join-form').addEventListener('submit', event => {
  event.preventDefault();
  const code = element<HTMLInputElement>('invitation').value.trim();
  void act(async () => {
    const result = await window.clipSync.join(code);
    if (result.ok) element<HTMLInputElement>('invitation').value = '';
    return result;
  });
});
element('pause').addEventListener('click', () => { void act(() => window.clipSync.pause(!current.paused)); });
element('disconnect').addEventListener('click', () => { void act(() => window.clipSync.disconnect()); });
element('send-file').addEventListener('click', () => { void act(() => window.clipSync.chooseFile(element<HTMLSelectElement>('recipient').value)); });
element('send-image').addEventListener('click', () => { void act(() => window.clipSync.sendImage(element<HTMLSelectElement>('recipient').value)); });
element('transfer-list').addEventListener('click', event => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]');
  if (!button?.dataset.id) return;
  const id = button.dataset.id;
  const actions: Record<string, () => Promise<Result>> = { accept: () => window.clipSync.acceptTransfer(id), cancel: () => window.clipSync.cancelTransfer(id), show: () => window.clipSync.showFile(id), copy: () => window.clipSync.copyImage(id) };
  const action = actions[button.dataset.action!];
  if (action) void act(action);
});
element('copy-invitation').addEventListener('click', () => {
  void act(async () => {
    const result = await window.clipSync.copyInvitation();
    if (result.ok) {
      element('notice').textContent = '초대 코드를 복사했어요. 연결할 PC에 전달해 주세요.';
      element('notice').hidden = false;
      clearTimeout(noticeTimer);
      noticeTimer = setTimeout(() => { element('notice').hidden = true; }, 4000);
    }
    return result;
  });
});

window.clipSync.subscribe(render);
void window.clipSync.state().then(render).catch(() => showError('앱을 다시 실행해 주세요.'));
