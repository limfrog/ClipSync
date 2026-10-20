# ClipSync

같은 네트워크의 PC 사이에서 텍스트 클립보드를 동기화하고 이미지·파일을 주고받는 데스크톱 앱입니다. 파일당 **500MB(500,000,000바이트)**까지 지원합니다.
Electron + TypeScript로 Windows, macOS, Linux를 대상으로 개발합니다.

[0.2.0 이미지·500MB 파일 전송 검증 기록](docs/file-transfer-verification.md)

## 설치 프로그램

0.2.0 설치 파일은 `release/installers/`에 생성됩니다. Windows x64는 `ClipSync-0.2.0-Windows-x64-Setup.exe`, Apple Silicon Mac은 `ClipSync-0.2.0-macOS-arm64.pkg`, Intel Mac은 `ClipSync-0.2.0-macOS-x64.pkg`를 사용하세요. Windows는 현재 사용자 계정에, macOS는 `/Applications/ClipSync.app`에 설치합니다.

현재 파일에는 배포자 인증서 서명과 Apple 공증이 없습니다. macOS 앱 내부에는 무결성 확인용 임시 서명(ad-hoc)이 있습니다. 운영체제에서 신뢰되지 않은 개발자로 표시하거나 설치·실행을 차단할 수 있습니다. Windows/macOS에서 실제 설치·실행은 아직 검증하지 않았습니다. 빌드 방법과 검증 범위는 [설치 프로그램 안내](docs/installers.md)를 확인하세요.

## 실행하기

Node.js 24 LTS와 npm이 필요합니다. 저장소 루트에서 실행하세요.

```sh
npm ci
node node_modules/electron/install.js
npm run dev
```

`npm run dev`는 타입 검사와 빌드 후 앱을 엽니다. 소스를 수정한 뒤 앱을 닫고 명령을 다시 실행하면 변경 사항이 반영됩니다. 이미 빌드했다면 `npm start`로 실행할 수 있습니다.

## 두 PC 연결하기

1. 두 PC를 같은 Wi-Fi 또는 유선 네트워크에 연결하고 각각 ClipSync를 실행합니다.
2. 첫 번째 PC에서 **연결 열기 → 초대 코드 복사**를 누릅니다.
3. 두 번째 PC에 초대 코드를 전달하고 **기존 연결에 참여**에 붙여넣은 뒤 **참여**를 누릅니다.
4. 새 텍스트를 복사하고 반대쪽 PC에서 붙여넣습니다. 첫 번째 PC의 코드를 사용해 여러 PC가 참여할 수 있습니다.

연결 중 새로 복사하는 텍스트는 모든 참여 PC에 공유됩니다. 초대 코드는 신뢰하는 기기에만 전달하세요. **일시정지**는 이 PC의 텍스트 자동 동기화를 멈춥니다. 재개하면 이후 복사한 텍스트부터 공유합니다. 호스트를 일시정지해도 다른 참여 PC 사이의 중계와 명시적으로 시작한 파일 전송은 계속됩니다. **연결 해제** 또는 앱 종료로 연결을 끝낼 수 있습니다. 호스트를 종료하면 참여한 PC 모두의 연결이 끊기고 진행 중인 전송은 취소됩니다.

텍스트는 최대 1MiB(UTF-8)이며 약 350ms 간격으로 변경을 감지합니다. 연결 전 클립보드, 서식, Linux 선택 영역 클립보드(PRIMARY)는 자동 공유하지 않습니다. 텍스트 기록과 초대 코드를 디스크에 저장하지 않습니다. Linux에서는 일반 복사·붙여넣기 클립보드(CLIPBOARD)를 사용합니다.

## 이미지·프로그램·파일 보내기

1. **받을 PC**에서 상대 기기를 선택합니다. 파일은 선택한 PC로만 전달하며 호스트를 통해 다른 참여 PC에도 보낼 수 있습니다.
2. **파일 보내기**를 눌러 사진, 문서, ZIP, EXE, MSI, DMG, PKG 등 파일을 선택합니다. 폴더와 macOS `.app` 번들은 먼저 ZIP으로 압축하세요. 프로그램의 실행 호환성은 받는 운영체제에 따릅니다.
3. 받는 PC에서 파일명을 확인하고 **받기**를 눌러 저장 위치를 선택합니다. **거절**하면 파일 본문을 받지 않습니다.
4. 전송이 끝나면 **폴더 열기**로 저장 파일을 확인할 수 있습니다. 기존 파일이 있으면 `파일명 (1).확장자`처럼 번호를 붙여 보존합니다.

클립보드 이미지는 복사한 뒤 **클립보드 이미지 보내기**를 누르세요. 상대 PC에서 수락·저장한 뒤 **이미지 복사**를 누르면 상대 OS 클립보드에 PNG 이미지가 들어갑니다. 이미지와 파일은 자동으로 보내지 않으며, 받은 프로그램도 자동으로 실행하지 않습니다. 한 번에 송신 4개, 수신 2개까지 처리합니다.

파일은 256KiB 조각으로 암호화해 전송하고 수신 확인을 기다린 뒤 다음 조각을 보냅니다. 전송 중에는 진행률과 **취소**를 제공합니다. SHA-256과 전체 바이트 수가 원본과 일치한 파일만 최종 이름으로 저장하며, 취소·오류·연결 해제 시 `.part` 파일을 삭제합니다. 수신한 파일은 지정한 저장 위치에 남습니다. 클립보드 이미지 전송용 임시 파일은 완료·취소 시 삭제합니다. 강제 종료로 남은 `.clipsync-*.part` 파일은 불완전한 전송 파일이므로 삭제할 수 있습니다.

### macOS·Windows 간 한글 처리

파일명은 JSON의 UTF-8로 전송하고 **NFC 정규화**를 적용해 macOS의 분해된 한글(NFD)이 Windows에서 자모 단위로 표시되는 문제를 방지합니다. 파일명에 URL 디코딩이나 CP949/Latin-1 재해석을 적용하지 않습니다. Windows 금지 문자·예약 장치명과 긴 파일명은 저장 가능한 이름으로 바꾸며, 정상적인 한글과 확장자는 유지합니다.

파일 내용은 **원본 바이트 그대로** 전송합니다. UTF-8 한글, BOM, CP949 데이터, 실행 파일과 압축 파일을 임의로 변환하지 않으므로 바이너리가 손상되지 않습니다. 외부 편집기로 여는 텍스트 파일은 해당 파일의 원래 인코딩을 선택해야 합니다. 새 텍스트 문서는 UTF-8을 권장합니다. 이 환경에서는 NFC/NFD와 바이너리 보존을 검증했으며, macOS·Windows 실기 간 동작은 각 운영체제에서 추가 확인해야 합니다.

## 연결이 안 될 때

- 호스트 PC에서 ClipSync의 TCP **47832** 포트에 대한 로컬 네트워크 접근을 허용하세요. 공용 인터넷에 포트를 개방할 필요는 없습니다.
- 게스트 Wi-Fi의 기기 격리 기능이 켜져 있으면 다른 PC에 접근하지 못할 수 있습니다.
- 호스트를 다시 열면 새 세션 키가 생성되므로 최신 초대 코드를 사용하세요.
- 여러 네트워크 어댑터/VPN이 있으면 첫 번째 활성 IPv4 주소가 선택됩니다. 올바른 네트워크의 주소인지 확인하고 필요한 경우 초대 코드의 `host` 값을 호스트의 LAN IPv4 주소로 바꾸세요.

## 개발 명령

| 명령 | 동작 |
| --- | --- |
| `npm run dev` | 타입 검사, 빌드, 앱 실행 |
| `npm start` | 빌드된 앱 실행 |
| `npm run typecheck` | TypeScript 타입 검사 |
| `npm test` | 암호화·인증·실제 소켓·클립보드·파일·한글 파일명 테스트 |
| `npm run test:desktop` | 빌드 후 Electron UI와 실제 OS 클립보드 통합 테스트 |
| `npm run test:pair` | Linux에서 독립된 앱 두 개로 클립보드·이미지·500MB 파일 전송 검증 |
| `npm run test:large` | 실제 암호화 소켓으로 500MB 파일 전송과 메모리 사용량 검증 |
| `npm run package` | 현재 OS/아키텍처의 실행 가능한 앱 디렉터리를 `release/`에 생성 |
| `npm run dist:win` | Windows x64 NSIS 설치 프로그램 생성 (Linux에서도 가능) |
| `npm run dist:mac` | macOS에서 Apple Silicon·Intel PKG 생성 |
| `npm run dist:mac:cross` | Linux x64에서 Apple Silicon·Intel PKG 생성 (도구 준비 필요) |
| `python3 scripts/verify-installers.py` | Linux에서 완성 파일의 내용·해시·아키텍처 검증, SHA-256 목록 생성 |

`npm run package`는 앱 디렉터리를 만들며, 설치 프로그램은 `dist:win` 또는 `dist:mac` 명령으로 생성합니다. 데스크톱 통합 테스트는 Linux의 가상 디스플레이에서 검증했으며, Windows/macOS의 네이티브 동작은 각 운영체제에서 추가 확인해야 합니다.

### 클라우드 Linux 환경

GUI가 없는 Debian 13 클라우드에서는 다음과 같이 검증할 수 있습니다. 이 환경에는 Electron의 GTK/NSS/오디오 라이브러리가 이미 제공됩니다. `setup-cloud.sh`는 서명된 Debian 저장소에서 Xvfb를 검증·다운로드해 쓰기 가능한 캐시에 압축 해제하며 시스템 패키지를 변경하지 않습니다.

```sh
export npm_config_cache=/workspace/.cache/npm
export XDG_CACHE_HOME=/workspace/.cache
export XDG_CONFIG_HOME=/workspace/.cache/config
export electron_config_cache=/workspace/.cache/electron
export NODE_USE_ENV_PROXY=1
export NODE_USE_SYSTEM_CA=1
npm ci
node node_modules/electron/install.js
bash scripts/setup-cloud.sh
export CLIPSYNC_XVFB="$(command -v Xvfb || printf '%s' /workspace/.cache/xvfb/usr/bin/Xvfb)"
export CLIPSYNC_TEST_NO_SANDBOX=1
npm test
npm run test:desktop
```

`test:desktop`는 디스플레이가 없으면 Xvfb를 시작하고 테스트 후 종료합니다. 화면 캡처는 `test-results/desktop.png`에 생성됩니다. `CLIPSYNC_TEST_NO_SANDBOX=1`은 Chromium의 사용자 네임스페이스/SUID 샌드박스를 지원하지 않는 격리된 클라우드 테스트 컨테이너에만 사용합니다. 일반 PC의 앱 실행은 Electron 기본 샌드박스를 사용합니다. 클라우드에서는 실제 다른 PC와의 LAN 연결 대신 로컬 소켓으로 통신을 검증합니다.

패키징된 앱 두 개로 실제 동작을 검증하려면 위 환경 변수를 설정한 상태에서 `npm run package` 후 `npm run test:pair`를 실행하세요. 서로 다른 Xvfb 디스플레이와 앱 프로필을 사용해 OS 클립보드가 독립적임을 먼저 확인합니다. 이후 UI로 연결하고 실제 키보드 복사·붙여넣기, 양방향 동기화, 일시정지, 이미지 전송·클립보드 복사, 한글 프로그램 파일, 실제 500MB 파일, 용량 제한, 동시 복사, 재연결과 종료를 검사합니다. 파일 선택·저장 대화상자의 반환 경로만 테스트용 경로로 지정하며 파일 읽기·쓰기·암호화·네트워크 전송은 실제로 수행합니다. 결과와 실행 파일 해시는 `test-results/pair-report.json`, 화면 캡처는 `test-results/pair-*.png`에 저장됩니다. 실제 물리 PC 두 대나 Windows/macOS에서의 검증은 포함하지 않습니다.

### 구조

```text
src/main/         Electron, OS 클립보드 제어, 암호화와 WebSocket 세션
src/renderer/     한국어 UI (Vite + TypeScript + CSS)
src/shared/       제한된 IPC API와 상태 타입
tests/            프로토콜·소켓·클립보드·Electron 통합 테스트
scripts/          빌드, 패키징, 가상 디스플레이 설정
```

## 연결과 데이터 처리

별도 클라우드 서버나 계정 없이 호스트 PC가 다른 참여 PC의 메시지를 중계합니다. 모든 참여 PC는 초대 코드에 포함된 256비트 세션 키를 공유하며, 클립보드 본문은 무작위 nonce를 사용한 AES-256-GCM으로 인증·암호화됩니다. 연결 시 양쪽이 매 연결의 새 challenge에 대한 역할별 HMAC-SHA256 증명을 확인합니다. 키 자체는 네트워크 인증 메시지에 포함되지 않습니다. 초대 코드는 세션 참여 권한이므로 별도의 안전한 경로로 전달해야 합니다.

모든 참여 PC는 같은 세션 키를 공유합니다. 파일 전송은 선택한 수신 PC에만 라우팅하지만, 호스트와 세션 참여자를 신뢰해야 합니다. 본문은 암호화하지만 IP 주소, 연결 시점과 메시지 크기는 숨기지 않습니다. 브라우저 Origin이 있는 연결과 인증되지 않은 메시지는 거부하고 최근 메시지 ID를 사용해 중복 처리를 방지합니다. 외부 콘텐츠를 로드하지 않는 renderer는 Node.js 없이 실행하며, 클립보드와 네트워크는 제한된 preload API를 통해 메인 프로세스에서 처리합니다.
