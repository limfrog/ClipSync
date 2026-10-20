# ClipSync 0.4.0 P2P 검증

확인일: 2026-10-21 (한국 시간).

## 연결 구조

- Hyperswarm 4.17.2 / HyperDHT 6.34.1. 모든 PC가 같은 비밀 주제를 announce/lookup하는 동등한 참여자입니다. 기기별 Noise 키/ID는 다르며 연결 정보에 보관합니다.
- 20자리 영문·숫자 키와 NFC 비밀번호(8~128자)로 scrypt(N=32768, r=8, p=1)를 수행하고 데이터 암호화 키와 인증 키를 분리합니다. 탐색 주제는 인증 키 해시입니다. 원문 비밀번호를 저장하거나 DHT에 전송하지 않습니다.
- Noise 연결의 핸드셰이크 해시와 양쪽 nonce/기기 ID에 바인딩한 HMAC으로 상호 인증합니다. 본문은 AES-256-GCM으로 암호화하며, 제한된 길이의 프레임으로 전달합니다.
- 각 PC가 직접 연결된 모든 상대에게 전송합니다. 전용 서버, 애플리케이션 데이터 중계, master 역할, 결제/API 키가 없습니다. `relayThrough: null`로 데이터 중계를 설정하지 않습니다. 공개 DHT는 기기 발견·연결 협상에 필요합니다.
- 텍스트 순서는 Lamport 시계와 기기 ID로 결정하며, 동시 복사를 모든 기기에서 같은 순서로 수렴시킵니다. 접속 시 시계를 교환하여 재실행한 기기의 새 복사도 처리합니다.
- 설정된 그룹은 앱 종료와 네트워크 단절 후에도 유지합니다. 복귀하면 새 복사부터 전송하며 오프라인/일시정지 동안의 클립보드는 재전송하지 않습니다. 중단한 파일은 조각을 정리하고 다시 복사해야 합니다.

## 실행한 검증

- `npm run build` 및 `npm test`: 35개 테스트. 키·비밀번호/NFC, 암호화 저장 adapter, 세 PC의 실제 UDP DHT 발견과 직접 Noise 연결, 비밀번호 불일치 격리, 첫 PC 종료 후 나머지 연결 유지, 기기 ID/Noise seed를 보존한 재접속, 동시 텍스트 순서, 기존 인증·기록·이미지·전송 테스트.
- P2P 세 기기 테스트의 실제 라이브러리 진단값에서 데이터 중계 시도 0회.
- `node scripts/test-desktop.mjs`: 실제 Electron 창의 검색·고정·다시 복사·테마·숨김·P2P 텍스트 동기화.
- `npm run test:persistence`: Linux의 실제 GNOME Secret Service와 Openbox/Xvfb/xdotool 사용. 실제 마우스 드래그로 창 위치 변경, 암호화된 파일에 원문 키·비밀번호가 없음을 확인, 숨김 중 동기화 유지, UI 종료 버튼으로 프로세스 종료, 같은 프로필 재실행 후 키·비밀번호 재입력 없이 자동 연결과 창 위치 복원, 연결 해제 후 저장 파일 삭제와 다음 실행의 미연결 상태를 검증했습니다.
- Playwright는 일반 Electron 테스트에서 `password-store=basic`을 강제합니다. 보안 저장 검증의 `tests/fixtures/secure-entry.cjs`는 이 테스트 기본값만 Secret Service로 바꿉니다. 암호화 API나 연결 동작을 모의 구현하지 않습니다. 실제 Windows DPAPI/macOS Keychain을 Linux에서 검증한 것은 아닙니다.
- 일반 Linux 테스트에 보안 저장소가 없으면 자동 보관을 거부하고 현재 실행에서만 연결합니다. 현재 제품은 Windows/macOS 대상입니다.

패키지 두 개의 독립 클립보드 검증은 12개 시나리오(상위 테스트 포함 13개)를 모두 통과했습니다. 결과는 `test-results/pair-report.json`에 기록하며 실행 파일·ASAR 해시, 실제 500MB 프로그램 파일의 전송·SHA-256·한글 파일명/네이티브 파일 클립보드, 이미지 픽셀·재복사·일시정지·재연결을 포함합니다. 이 환경의 500MB 직접 전송은 약 257초가 걸렸으며 전체 검증은 약 275초였습니다. 회선과 NAT·혼잡에 따라 속도가 달라지고 기존 LAN TCP 전송보다 느릴 수 있습니다.

## 검증 한계

- 공개 DHT의 기본 노드로 18초 동안 접속을 시도했지만 라우팅 노드 0개였고 announce 완료를 확인하지 못했습니다. 따라서 외부 네트워크의 실제 NAT 통과 성공을 주장하지 않습니다. 격리된 DHT 테스트는 실제 UDP와 직접 Noise 소켓을 사용하지만 WAN/통신사 NAT를 재현하지 않습니다.
- UDP가 차단되거나 특정 대칭 NAT/CGNAT·회사 방화벽 뒤에 있으면 직접 연결이 실패할 수 있습니다. 키·비밀번호 불일치와 상대 오프라인도 기기 대기 상태로 표시되며, 앱은 자동 탐색을 계속합니다. 유료 중계로 전환하지 않습니다.
- macOS의 Dock 숨김·표시/메뉴바 잔류와 Windows/macOS 간 Finder/탐색기 복사·붙여넣기, 실제 사용자 설치·제거는 실기기 검증이 필요합니다.
- 설치 파일의 코드 서명과 Apple 공증은 별도 인증서가 필요합니다. 현재 배포는 Windows 무서명, macOS ad-hoc입니다.

## 다시 실행

```sh
npm ci
node node_modules/electron/install.js
npm run build
npm test
npm run test:desktop
# Linux: gnome-keyring, dbus-run-session, Openbox, xdotool 필요
npm run test:persistence
npm run package
npm run test:pair
```

격리된 Linux 클라우드에서만 `CLIPSYNC_TEST_NO_SANDBOX=1`을 사용할 수 있습니다. `CLIPSYNC_DHT_BOOTSTRAP`은 사설 탐색망/테스트의 알려진 노드 목록을 지정하며 기본값은 공개 HyperDHT 노드입니다. 테스트 노드를 실제 서비스 배포용 서버로 생성하거나 외부에 공개하지 않았습니다.
