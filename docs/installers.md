# ClipSync 설치 프로그램

현재 버전은 창 크기 조절·Windows 아이콘 확대·선택 항목 강조·기록 유지 옵션·Mac 창 열기 수정을 포함한 0.4.7입니다. 기록을 다음 실행에 남기려면 환경설정에서 새 옵션을 켜세요. Mac 메뉴바는 배경에 따라 흰색·검은색으로 표시되는 전용 템플릿 아이콘을 사용합니다. [릴리스](https://github.com/limfrog/ClipSync/releases/tag/v0.4.7) · [0.4.7 검증 기록](window-history-verification.md) · [0.4.6 중복·자동 시작 검증](receipt-startup-verification.md) · [0.4.5 창·아이콘 검증 기록](window-drag-verification.md) · [0.4.4 발견 검증 기록](broadcast-discovery-verification.md) · [Mac–Windows 실물 검증 절차](physical-verification.md).

| 대상 | 파일 | 설치 위치 |
| --- | --- | --- |
| Windows x64 | [ClipSync-0.4.7-Windows-x64-Setup.exe](https://github.com/limfrog/ClipSync/releases/download/v0.4.7/ClipSync-0.4.7-Windows-x64-Setup.exe) | `%LOCALAPPDATA%\Programs\ClipSync` |
| macOS Apple Silicon | [ClipSync-0.4.7-macOS-arm64.pkg](https://github.com/limfrog/ClipSync/releases/download/v0.4.7/ClipSync-0.4.7-macOS-arm64.pkg) | `/Applications/ClipSync.app` |
| macOS Intel | [ClipSync-0.4.7-macOS-x64.pkg](https://github.com/limfrog/ClipSync/releases/download/v0.4.7/ClipSync-0.4.7-macOS-x64.pkg) | `/Applications/ClipSync.app` |

SHA-256은 [SHA256SUMS.txt](https://github.com/limfrog/ClipSync/releases/download/v0.4.7/SHA256SUMS.txt)에서 확인할 수 있습니다.

각 파일은 500,000,000바이트보다 작습니다. Windows 설치 화면은 한국어·영어를 지원하며 시작 메뉴·바탕화면 바로가기와 제거 프로그램을 포함합니다. Mac은 자기 CPU에 맞는 PKG를 선택해야 합니다. PKG 설치에는 관리자 권한이 필요합니다. 프로그램을 종료한 뒤 설치하세요.

배포자 인증서 서명과 Apple 공증은 포함하지 않습니다. macOS 앱의 ad-hoc 서명은 코드·리소스 무결성을 위한 서명이며 개발자 신원을 인증하지 않습니다. 운영체제의 개발자 신뢰 검사로 설치·실행이 차단될 수 있습니다. Gatekeeper나 SmartScreen을 전역 해제하는 설정은 제공하지 않습니다. 인증된 일반 배포를 위해서는 Windows 코드 서명 및 Apple Developer ID Application/Installer 인증서와 공증이 추가로 필요합니다.

## 현재 검증과 과거 기록

현재 릴리스 워크플로는 실제 패키지의 앱 버전·파일 구성·선택한 아이콘을 검사합니다. Windows는 실행 파일과 설치 프로그램의 아이콘 리소스를 모두 비교하고, Mac은 두 앱 번들의 ICNS와 `codesign --verify --deep --strict`, PKG 확장을 검사합니다. 배포 파일을 공개 HTTPS 주소에서 다시 받아 SHA-256을 대조합니다. Windows·Mac의 실제 크기 조절·기록 암호화·이미지 복원·포커스 유지와 패키지의 자동 시작 등록·조회·해제·숨김 실행을 확인합니다. 운영체제 재부팅 자체나 실제 설치 화면·Mac 메뉴바 색 전환을 클라우드에서 실행해 확인하는 검사는 아닙니다.

사용자는 0.4.4에서 Mac–Windows 연결·텍스트·이미지·한글·300MB 파일, 자동 재연결과 외부 네트워크 연결 성공을 확인했습니다. 아래 내용은 **초기 0.2.0 빌드의 검증 기록**입니다.

Linux에서 Windows 설치 파일을 생성하고 7-Zip의 NSIS 무결성 검사를 수행했습니다. 설치 파일을 별도 임시 디렉터리에 풀어 모든 앱 파일의 SHA-256을 원본과 비교하고, x64 PE 실행 파일 및 제거 프로그램의 포함 여부를 확인했습니다.

macOS는 두 아키텍처의 Electron 앱을 구성하고 고정 버전 `rcodesign`으로 ad-hoc 서명한 뒤 Apple flat component PKG(XAR, BOM, gzip/odc cpio Payload)를 생성했습니다. 독립된 시스템 `libarchive`로 PKG와 Payload를 읽고 모든 파일의 내용·권한·소유자·심볼릭 링크를 서명된 원본과 비교했습니다. BOM의 경로 목록, 설치 경로, 번들 ID, 버전, CPU도 확인합니다. 별도 검사기는 Mach-O 코드 페이지와 특수 슬롯, 번들 리소스, 중첩 앱의 서명 해시와 JIT entitlement를 검사합니다. 이 검사는 Apple의 `codesign`, Installer, Gatekeeper 검증을 대체하지 않습니다.

재검증 결과는 `release/installers/installer-validation.json`, 전체 설치 파일의 SHA-256은 같은 폴더의 `SHA256SUMS.txt`에 기록됩니다. 단위·소켓·한글 파일명 테스트 20개도 통과했습니다. 이미지·실제 500MB 파일과 앱 두 개의 Linux 전송 검증은 [이전 기능 검증 기록](file-transfer-verification.md)에 있습니다.

당시 0.2.0 검사에서는 Windows/macOS의 실제 설치·제거·실행과 두 운영체제 사이 파일 교환을 확인하지 않았습니다. 이후 검증과 사용자 실물 확인 결과는 위 링크의 버전별 기록을 기준으로 확인하세요.

## 다시 빌드하기

Node.js 24, npm이 필요합니다.

```sh
npm ci
node node_modules/electron/install.js
npm run dist:win
```

Windows 설치 프로그램은 Electron Builder가 체크섬으로 검증한 NSIS 도구로 만듭니다. 커스텀 NSIS 스크립트가 설치 시 제거 프로그램을 작성하므로 Linux에서도 Wine 없이 빌드할 수 있습니다.

macOS에서는 `npm run dist:mac`을 사용합니다. Linux x64에서는 Python 3.12+, Git, curl, make, C++ 컴파일러로 다음을 실행합니다.

```sh
bash scripts/setup-installer-tools.sh
npm run dist:mac:cross
python3 scripts/verify-installers.py
```

`setup-installer-tools.sh`는 rcodesign 0.29.0의 공식 릴리스 아카이브를 SHA-256으로 검증하며 bomutils는 고정 커밋에서 빌드합니다. 기본 도구 경로는 `/workspace/.cache/clipsync-installer-tools`이며 `CLIPSYNC_INSTALLER_TOOLS`로 바꿀 수 있습니다. 재검증에는 `libarchive.so.13`과 Electron Builder 캐시의 `7zz`가 필요합니다. 캐시 경로는 `ELECTRON_BUILDER_CACHE`로 지정할 수 있습니다.

완성 파일을 같은 폴더에 모아 다음과 같이 확인할 수 있습니다.

```sh
sha256sum -c SHA256SUMS.txt
```
