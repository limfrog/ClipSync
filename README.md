# ClipSync

복사한 내용을 모아 검색하고 다시 쓰는 **데스크톱 클립보드 관리자**입니다. 신뢰하는 PC를 연결하면 텍스트·이미지·파일 클립보드가 자동으로 동기화됩니다. 파일당 최대 **500MB(500,000,000바이트)**를 지원합니다.

[다크 화면](docs/screenshots/clipboard-dark.png) · [라이트 화면](docs/screenshots/clipboard-light.png)

## 사용하는 방법

1. 앱을 열고 평소처럼 텍스트, 스크린샷 또는 파일을 복사하세요. 기록을 클릭하거나 **복사**를 누르면 다시 클립보드에 들어갑니다.
2. 검색, 텍스트·이미지·파일 탭, **고정**으로 필요한 기록을 찾으세요. **비우기**는 고정한 항목을 남기며 원본 파일을 지우지 않습니다.
3. **기기 연결**에서 한 PC는 **연결 열기**, 다른 PC는 전달받은 초대 코드로 **참여**합니다. 같은 Wi-Fi 또는 유선 네트워크의 신뢰하는 PC만 연결하세요.
4. 연결 후 새로 복사한 내용은 다른 PC에서도 그대로 붙여넣을 수 있습니다. 별도로 받기·보내기·이미지 복사 버튼을 누를 필요가 없습니다. 파일은 다운로드 폴더의 `ClipSync`에 완전히 받은 다음 파일 클립보드에 등록합니다.
5. 창의 ×와 Esc는 창을 숨깁니다. 트레이/메뉴 막대 또는 기본 단축키 `Ctrl/⌘ + Shift + V`로 다시 엽니다. **종료**는 동기화도 끝냅니다. 환경설정에서 단축키, 다크·라이트·시스템 테마, 항상 위에 고정을 바꿀 수 있습니다.

기기 연결에서 **일시정지**하면 새 내용의 동기화와 자동 파일 수신을 멈춥니다. 재개할 때 중간에 복사한 개인 내용을 다시 보내지 않습니다. 진행 중인 자동 동기화도 취소합니다. 다른 참여 PC끼리의 중계는 호스트에서 계속될 수 있습니다.

## 클립보드와 기록의 범위

- 텍스트는 UTF-8 기준 1MiB까지, 파일·PNG 이미지는 각각 500MB까지 지원합니다. 파일 복사는 최대 16개를 한 묶음으로 처리하며 전체가 준비된 뒤 반대편 파일 클립보드에 등록합니다. 폴더와 macOS `.app`은 먼저 ZIP으로 압축하세요.
- 기록은 앱 실행 중 메모리에 최대 100개 보관합니다. 텍스트 본문은 합계 4MiB 이내로 제한하며 오래된 비고정 항목부터 정리합니다. 고정한 항목만으로 한도를 넘으면 가장 오래된 항목이 정리됩니다. 종료 시 기록은 사라집니다.
- 원본 파일은 복사해 둔 경로를 참조합니다. 기록 후 원본을 삭제하거나 이동하면 다시 복사할 수 없습니다. 이미지는 임시 캐시에 보관하고 정상 종료 시 삭제합니다. 동기화된 수신 파일은 다운로드 폴더의 `ClipSync`에 남습니다. 기록 삭제·비우기는 이 파일들을 삭제하지 않습니다.
- 파일은 암호화된 조각으로 전송하고 SHA-256과 전체 바이트 수가 일치한 경우에만 최종 파일로 만듭니다. 기존 파일이 있으면 번호를 붙여 보존하고, 중단한 조각 파일은 제거합니다. 프로그램을 자동으로 실행하지 않습니다.
- 더 최신의 텍스트나 이미지를 복사했다면 뒤늦게 완성된 큰 파일은 기록에만 남고 최신 클립보드를 덮어쓰지 않습니다.
- 서식 있는 텍스트는 일반 텍스트로 처리합니다. 프로그램의 실행 가능 여부는 받는 운영체제에 따릅니다. 연결 전 클립보드는 자동으로 보내지 않으며 초대 코드는 기록하거나 동기화하지 않습니다.

### macOS·Windows 간 한글

파일명은 UTF-8로 전달하고 NFC로 정규화해 macOS의 NFD 한글 자모 분리를 처리합니다. 파일 내용은 원본 바이트 그대로 보존하며 CP949/UTF-8이나 실행 파일 내용을 임의로 변환하지 않습니다. Windows 금지 문자·예약명은 저장 가능한 이름으로 바꿉니다.

Electron의 `text/uri-list` API가 Windows `CF_HDROP`, macOS `NSFilenamesPboardType`, Linux의 파일 URI 목록을 매핑합니다. 이 클라우드에서는 Linux의 실제 클립보드로 자동 이미지·프로그램·500MB 동기화를 검증했습니다. Windows 탐색기·macOS Finder에서 실제 복사·붙여넣기는 각 OS의 추가 확인이 필요합니다.

## 개발

Node.js 24 LTS와 npm이 필요합니다.

```sh
npm ci
node node_modules/electron/install.js
npm run dev
```

| 명령 | 동작 |
| --- | --- |
| `npm run build` | 타입 검사와 빌드 |
| `npm test` | 기록·암호화·인증·자동 동기화·한글 파일명 테스트 |
| `npm run test:desktop` | 실제 Electron에서 검색·고정·다시 복사·설정·창 숨김·텍스트 동기화 검사 |
| `npm run package` | 현재 OS의 앱 묶음 생성 |
| `npm run test:pair` | Linux에서 독립된 앱 두 개로 자동 이미지·한글 프로그램·실제 500MB 클립보드 동기화 검사 |
| `npm run test:large` | 실제 암호화 소켓으로 500MB 전송과 메모리 사용량 검사 |
| `npm run dist:win` | Windows x64 NSIS 설치 프로그램 생성; Linux에서도 가능 |
| `npm run dist:mac` | macOS에서 Apple Silicon·Intel PKG 생성 |
| `npm run dist:mac:cross` | Linux x64에서 macOS PKG 생성; `scripts/setup-installer-tools.sh` 필요 |

GUI 없는 클라우드에서는 다음 캐시·프록시 설정을 사용합니다.

```sh
export npm_config_cache=/workspace/.cache/npm
export XDG_CACHE_HOME=/workspace/.cache
export XDG_CONFIG_HOME=/workspace/.cache/config
export electron_config_cache=/workspace/.cache/electron
export NODE_USE_ENV_PROXY=1
export NODE_USE_SYSTEM_CA=1
bash scripts/setup-cloud.sh
export CLIPSYNC_XVFB=/workspace/.cache/xvfb/usr/bin/Xvfb
export CLIPSYNC_TEST_NO_SANDBOX=1
npm test
npm run test:desktop
npm run package
npm run test:pair
```

`CLIPSYNC_TEST_NO_SANDBOX=1`은 Chromium 샌드박스를 지원하지 않는 격리된 테스트 컨테이너 전용입니다. 일반 데스크톱은 기본 샌드박스를 사용합니다. `CLIPSYNC_DATA_DIR`은 테스트 프로필과 수신 파일을 격리하며 일반 실행에서는 Electron의 사용자별 경로와 다운로드 폴더를 사용합니다.

## 설치 파일과 검증

[GitHub Releases](https://github.com/limfrog/ClipSync/releases)에서 자기 OS/CPU에 맞는 설치 파일과 `SHA256SUMS.txt`를 받을 수 있습니다. `v0.3.1`은 클립보드 관리자와 자동 동기화 버전입니다. 설치 전 기존 앱을 **종료**하세요. 배포자 인증서 서명과 Apple 공증은 포함하지 않습니다.

검증 범위와 결과는 [0.3.1 검증 기록](docs/clipboard-manager-verification.md), 빌드 설정은 [설치 프로그램 안내](docs/installers.md)를 참고하세요. 네트워크 연결이 안 되면 호스트의 로컬 TCP 47832 접근과 Wi-Fi 기기 격리/VPN을 확인하세요. 인터넷에 포트를 개방할 필요는 없습니다.

## 데이터 처리와 참고 원본

별도 클라우드 계정 없이 호스트 PC가 참여 PC의 메시지를 중계합니다. 초대 코드의 256비트 세션 키로 AES-256-GCM 암호화와 매 연결의 HMAC challenge 인증을 수행합니다. IP 주소와 데이터 크기 등 메타데이터는 숨기지 않습니다. 참여한 PC와 호스트를 신뢰해야 하며, 연결은 이미지와 파일의 자동 수신 권한도 포함합니다.

창 크기·기록 중심 사용 방식은 사용자 제공 [ClipSync_Original](https://github.com/limfrog/ClipSync_Original) 커밋 `088efd75f6232840694fbd8616c8942dc9602360`을 참고했습니다. 원본 저장소는 수정하지 않았습니다. 서버 주소·동기화 키·모바일/PWA 연동은 이번 범위에 포함하지 않습니다. 참고한 UI 요소의 MIT 고지는 `THIRD_PARTY_NOTICES.txt`에 포함합니다.
