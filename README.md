# ClipSync

복사한 내용을 모아 검색하고 다시 쓰는 **데스크톱 클립보드 관리자**입니다. 신뢰하는 PC를 연결하면 텍스트·이미지·파일 클립보드가 자동으로 동기화됩니다. 파일당 최대 **500MB(500,000,000바이트)**를 지원합니다.

[다크 화면](docs/screenshots/clipboard-dark.png) · [라이트 화면](docs/screenshots/clipboard-light.png)

## 사용하는 방법

1. 앱을 열고 평소처럼 텍스트, 스크린샷 또는 파일을 복사하세요. 기록을 클릭하거나 **복사**를 누르면 다시 클립보드에 들어갑니다.
2. 검색, 텍스트·이미지·파일 탭, **고정**으로 필요한 기록을 찾으세요. **비우기**는 고정한 항목을 남기며 원본 파일을 지우지 않습니다.
3. **기기 연결**에서 영문·숫자 20자리 **연결 키**와 8자 이상의 **비밀번호**를 입력합니다. 한 PC에서 **새 키 만들기**를 누른 뒤 모든 PC에 같은 키와 비밀번호를 입력하세요. 대소문자를 구분하며 한글 비밀번호는 NFC로 정규화합니다.
4. 각 PC는 동등한 P2P 참여자입니다. 전용 중계 서버나 master PC 없이 같은 네트워크에서는 즉시 직접 탐색하고, 외부망에서는 공개 DHT 탐색을 병행합니다. 직접 연결된 PC 사이에서 암호화한 클립보드를 주고받습니다. 새로 복사한 파일은 다운로드 폴더의 `ClipSync`에 완전히 받은 다음 파일 클립보드에 등록합니다. 이미 받은 동일 파일은 이름·크기·SHA-256을 확인해 재사용하며, 양쪽이 0.4.6 이상이면 파일 데이터 재전송도 생략합니다.
5. 한 번 저장한 연결은 앱 재실행·절전 복귀·상대 PC 재실행 후 다시 찾습니다. **연결 해제 및 저장 삭제**를 누르면 이 PC의 자동 연결을 해제합니다. 다른 PC의 설정은 그대로 남으므로 그룹 접근 자체를 바꾸려면 키와 비밀번호를 변경하세요.
6. 상단 로고와 빈 제목 영역을 드래그하면 창이 이동하며, 가장자리·모서리를 드래그해 최소 360×480부터 크기를 조절합니다. 크기와 위치를 기억합니다. 톱니 아이콘으로 환경설정을 엽니다. ×와 Esc는 창을 숨기고, 트레이/메뉴 막대 또는 기본 단축키 `Ctrl/⌘ + Shift + V`로 다시 엽니다. Mac은 숨길 때 Dock에서 빠지고 메뉴바에 남으며, 다시 열면 Dock에 표시됩니다. 오른쪽 아래 **종료**는 앱과 연결을 모두 종료합니다. 저장한 연결은 다음 실행에 복원됩니다.

환경설정의 **종료 후에도 클립보드 기록 유지**를 켜면 다음 실행에 텍스트·이미지·파일 기록과 고정을 복원합니다. 기본값은 꺼짐이며, 저장한 기록을 복원해도 자동으로 다른 기기에 전송하지 않습니다.

환경설정의 **새 버전 자동 확인**은 기본으로 켜져 있습니다. 설치 앱 실행 후와 6시간마다 GitHub를 확인하고 새 버전이 있으면 알림과 다운로드 버튼을 표시합니다. **업데이트 확인**으로 직접 확인할 수도 있습니다. 다운로드는 이 PC에 맞는 공식 설치 파일 주소를 브라우저에서 열며, 앱 종료 후 직접 설치하세요. 클립보드·연결 정보는 버전 확인에 보내지 않습니다. [업데이트 검증](docs/update-verification.md).

환경설정의 **부팅 시 시작**을 체크하면 로그인 후 창을 띄우지 않고 트레이·메뉴바에서 시작합니다. 해제하면 OS 자동 시작 등록을 제거합니다. Mac에서 승인이 필요하면 설정 화면의 안내를 따르세요. 창 고정은 상단 핀 버튼으로 사용할 수 있습니다.

기기 연결에서 **일시정지**하면 새 내용의 동기화와 자동 파일 수신을 멈춥니다. 재개할 때 중간에 복사한 개인 내용을 다시 보내지 않습니다. 진행 중인 자동 동기화도 취소합니다. 다른 PC끼리의 직접 연결에는 영향을 주지 않습니다.

### P2P 연결과 비용

앱은 유료 중계, 호스팅 계정, 결제 정보를 사용하지 않습니다. 데이터 전송량은 각 PC의 인터넷 회선을 사용합니다. 공개 HyperDHT 탐색 노드는 기기 발견과 연결 협상을 지원하며 앱의 전용 서버가 아닙니다. 공개 노드와 상대 PC에는 IP 주소 등 네트워크 메타데이터가 드러날 수 있습니다. 탐색 주제는 키·비밀번호에서 도출하며 클립보드 내용은 탐색망에 저장하지 않습니다.

같은 네트워크의 탐색·전송은 인터넷 없이도 동작합니다. 외부망 연결에는 인터넷과 UDP 통신이 필요합니다. 공유기의 AP 격리·게스트 Wi-Fi나 멀티캐스트 차단은 내부 탐색을 막을 수 있습니다. UDP 차단, 대칭 NAT/CGNAT, 회사 방화벽 등에서는 직접 연결이 불가능할 수 있습니다. 이런 경우 재시도를 계속하고 UI에 안내하며, 유료 서버로 전환하거나 연결을 보장하지 않습니다. 0.3.x의 호스트 초대 코드는 사용하지 않으므로 연결할 PC를 모두 0.4.0 이상으로 업데이트하세요.

Mac은 시스템 설정 → 개인정보 보호 및 보안 → 로컬 네트워크에서 ClipSync를 허용하세요(해당 설정이 있는 macOS). Windows는 Windows 보안 → 방화벽 및 네트워크 보호에서 ClipSync 통신을 허용하고, 일반 홈 네트워크에서는 네트워크 프로필을 개인으로 설정하세요. 방화벽 전체를 끌 필요는 없습니다.

### 자동 연결 정보의 보관

이전에 인증한 기기의 공개 키와 최대 16개의 탐색 노드 주소를 함께 기억해 다음 실행에는 그룹 탐색과 기존 기기 재접속을 동시에 시도합니다. **다시 찾기**를 눌러 키를 재입력하지 않고 탐색을 재개할 수 있습니다.

비밀번호 원문을 저장하지 않습니다. scrypt로 분리한 기기 발견·인증·암호화 키와 기기 ID를 Windows DPAPI / macOS Keychain / Linux Secret Service로 암호화해 `connection.enc`에 보관합니다. 보안 저장소를 사용할 수 없으면 평문으로 대체하지 않고 현재 실행에서만 연결하며, 기기 연결 화면에 재입력이 필요함을 표시합니다. 서명이 일관되지 않은 Mac 개발 빌드는 업데이트 때 Keychain 접근 승인을 다시 요청할 수 있습니다.

## 클립보드와 기록의 범위

- 텍스트는 UTF-8 기준 1MiB까지, 파일·PNG 이미지는 각각 500MB까지 지원합니다. 파일 복사는 최대 16개를 한 묶음으로 처리하며 전체가 준비된 뒤 반대편 파일 클립보드에 등록합니다. 폴더와 macOS `.app`은 먼저 ZIP으로 압축하세요.
- 기록은 앱 실행 중 메모리에 최대 100개 보관합니다. 텍스트 본문은 합계 4MiB 이내로 제한하며 오래된 비고정 항목부터 정리합니다. 고정한 항목만으로 한도를 넘으면 가장 오래된 항목이 정리됩니다. 기본적으로 종료 시 기록은 사라집니다. 기록 유지 옵션을 켜면 원문·순서·고정 상태를 OS 보안 저장소로 암호화해 `history.enc`에 저장합니다. 보안 저장소를 사용할 수 없으면 평문으로 대체하지 않습니다.
- 원본 파일은 복사해 둔 경로를 참조합니다. 기록 후 원본을 삭제하거나 이동하면 다시 복사할 수 없습니다. 기록 유지가 꺼져 있으면 이미지는 임시 캐시에 보관하고 정상 종료 시 삭제합니다. 켜져 있으면 이미지 바이트를 사용자 데이터의 전용 `history-images` 폴더에 보관합니다. 이미지 바이트 자체는 암호화하지 않으며 사용자별 폴더 권한으로 보호합니다. 옵션을 끄면 저장한 기록을 삭제하고 현재 실행의 이미지 참조는 종료까지 유지한 뒤 캐시를 삭제합니다. 동기화된 수신 파일은 다운로드 폴더의 `ClipSync`에 남습니다. 기록 삭제·비우기는 이 파일들을 삭제하지 않습니다.
- 파일은 암호화된 조각으로 전송하고 SHA-256과 전체 바이트 수가 일치한 경우에만 최종 파일로 만듭니다. 기존 파일이 있으면 번호를 붙여 보존하고, 중단한 조각 파일은 제거합니다. 프로그램을 자동으로 실행하지 않습니다.
- 더 최신의 텍스트나 이미지를 복사했다면 뒤늦게 완성된 큰 파일은 기록에만 남고 최신 클립보드를 덮어쓰지 않습니다.
- 서식 있는 텍스트는 일반 텍스트로 처리합니다. 프로그램의 실행 가능 여부는 받는 운영체제에 따릅니다. 연결 전·끊어진 동안의 클립보드를 재접속 때 자동 전송하지 않습니다. 앱의 연결 키 복사 기능은 키를 기록하거나 동기화하지 않습니다. 연결 중이던 파일이 끊어지면 불완전 파일을 지우고, 복원 후 다시 복사해야 합니다.

### macOS·Windows 간 한글

파일명은 UTF-8로 전달하고 NFC로 정규화해 macOS의 NFD 한글 자모 분리를 처리합니다. 파일 내용은 원본 바이트 그대로 보존하며 CP949/UTF-8이나 실행 파일 내용을 임의로 변환하지 않습니다. Windows 금지 문자·예약명은 저장 가능한 이름으로 바꿉니다.

Electron의 `text/uri-list` API가 Windows `CF_HDROP`, macOS `NSFilenamesPboardType`, Linux의 파일 URI 목록을 매핑합니다. 이 클라우드에서는 Linux의 실제 클립보드로 자동 이미지·프로그램·500MB 동기화를 검증했습니다. 2026-10-21(한국시간) 사용자는 실물 Mac–Windows에서 양방향 텍스트·이미지·한글 처리·300MB 파일 전송, 앱 재실행 후 자동 재연결과 외부 네트워크 연결 성공을 보고했습니다. 각 항목의 범위는 [실물 검증 기록](docs/broadcast-discovery-verification.md)을 참고하세요.

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
| `npm run test:persistence` | Linux Secret Service로 실제 암호화 저장·재실행 복원, 창 드래그·숨김·종료·설정 삭제 검사; gnome-keyring, dbus-run-session, openbox, xdotool 필요 |
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

[GitHub Releases](https://github.com/limfrog/ClipSync/releases)에서 자기 OS/CPU에 맞는 설치 파일과 `SHA256SUMS.txt`를 받을 수 있습니다. `v0.4.9`(빌드 8)은 [개발자 정보·버전/빌드 표시·오프라인 개인정보처리방침과 이용약관](docs/developer-legal-verification.md)을 포함합니다. [0.4.7의 창 크기 조절·선택 강조·Windows 아이콘·기록 유지·Mac 창 열기 수정](docs/window-history-verification.md)도 유지합니다. [0.4.6의 중복 수신 방지·부팅 시 시작](docs/receipt-startup-verification.md)도 유지합니다. 상단 드래그와 [투명 배경 A 아이콘](docs/icon-concepts.md)도 유지합니다. Mac 메뉴바는 배경에 맞춰 흰색·검은색으로 표시되는 단색 템플릿을 사용합니다. 멀티캐스트·브로드캐스트·외부 P2P 탐색과 저장된 연결은 계속 사용합니다. 0.4.0의 저장된 키·비밀번호는 유지합니다. 설치 전 기존 앱을 **종료**하세요. 배포자 인증서 서명과 Apple 공증은 포함하지 않습니다.

같은 공유기에 연결한 Mac과 Windows에서는 [실물 검증 절차](docs/physical-verification.md)를 따라 **연결 상태 복사** 보고서와 양방향 붙여넣기 결과를 비교할 수 있습니다.

검증 범위와 결과는 [0.4.9 개발자·정책 검증](docs/developer-legal-verification.md), [0.4.7 창·기록 검증](docs/window-history-verification.md), [0.4.6 중복 수신·자동 시작 검증](docs/receipt-startup-verification.md), [0.4.5 창 이동 검증 기록](docs/window-drag-verification.md), [0.4.4 브로드캐스트 검증 기록](docs/broadcast-discovery-verification.md), [0.4.3 발견 속도 검증 기록](docs/discovery-verification.md) 및 [0.4.0 P2P 검증 기록](docs/p2p-verification.md), 빌드 설정은 [설치 프로그램 안내](docs/installers.md)를 참고하세요. 연결되지 않으면 모든 PC의 키·비밀번호·버전이 일치하는지, UDP와 공개 DHT 접근이 허용되는지 확인하세요. 일부 네트워크는 직접 P2P 연결을 지원하지 않습니다.

## 데이터 처리와 참고 원본

별도 클라우드 계정 없이 Hyperswarm/HyperDHT가 직접 연결을 구성합니다. scrypt로 도출한 별도 인증 키로 매 연결의 Noise 핸드셰이크에 바인딩한 HMAC challenge 인증을 수행하고, 클립보드는 AES-256-GCM으로 암호화합니다. 데이터 중계 `relayThrough`는 사용하지 않습니다. IP 주소와 데이터 크기 등 메타데이터는 숨기지 않습니다. 키와 비밀번호를 공유한 PC를 신뢰해야 하며, 연결은 이미지와 파일의 자동 수신 권한도 포함합니다.

창 크기·기록 중심 사용 방식은 사용자 제공 [ClipSync_Original](https://github.com/limfrog/ClipSync_Original) 커밋 `088efd75f6232840694fbd8616c8942dc9602360`을 참고했습니다. 원본 저장소는 수정하지 않았습니다. 서버 주소·동기화 키·모바일/PWA 연동은 이번 범위에 포함하지 않습니다. 참고한 UI 요소의 MIT 고지는 `THIRD_PARTY_NOTICES.txt`에 포함합니다.

## 개발자·문의·정책

개발자: **Horizon Entertainment** · 문의: **apps@horizonent.co.kr**. 환경설정에서 메일 프로그램을 열 수 있으며 문의가 자동 전송되지는 않습니다.

[개인정보처리방침](legal/PRIVACY-POLICY.ko.txt) · [이용약관](legal/TERMS-OF-USE.ko.txt). 시행일 2026-10-21, 문서 버전 1.0입니다. 앱에 같은 문서를 포함하여 인터넷 없이 읽을 수 있습니다. 환경설정 하단의 버전·빌드는 패키지 정보에서 읽고, 모든 플랫폼에 공통 `package.json`의 `buildNumber`를 사용합니다. 새 제품 빌드에서는 버전과 빌드번호를 함께 갱신합니다.
