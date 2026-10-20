# ClipSync 설치 프로그램

현재 클립보드 관리자 버전은 0.3.0입니다. 아래 0.2.0 파일·검증 설명은 최초 설치 파일의 기록이며, 현재 동작과 검증은 [0.3.0 검증 기록](clipboard-manager-verification.md)을 참고하세요. 현재 릴리스의 파일명과 SHA-256은 해당 GitHub Release를 기준으로 확인하세요.

| 대상 | 파일 | 설치 위치 |
| --- | --- | --- |
| Windows x64 | `release/installers/ClipSync-0.2.0-Windows-x64-Setup.exe` | `%LOCALAPPDATA%\Programs\ClipSync` |
| macOS Apple Silicon | `release/installers/ClipSync-0.2.0-macOS-arm64.pkg` | `/Applications/ClipSync.app` |
| macOS Intel | `release/installers/ClipSync-0.2.0-macOS-x64.pkg` | `/Applications/ClipSync.app` |

각 파일은 500,000,000바이트보다 작습니다. Windows 설치 화면은 한국어·영어를 지원하며 시작 메뉴·바탕화면 바로가기와 제거 프로그램을 포함합니다. Mac은 자기 CPU에 맞는 PKG를 선택해야 합니다. PKG 설치에는 관리자 권한이 필요합니다. 프로그램을 종료한 뒤 설치하세요.

배포자 인증서 서명과 Apple 공증은 포함하지 않습니다. macOS 앱의 ad-hoc 서명은 코드·리소스 무결성을 위한 서명이며 개발자 신원을 인증하지 않습니다. 운영체제의 개발자 신뢰 검사로 설치·실행이 차단될 수 있습니다. Gatekeeper나 SmartScreen을 전역 해제하는 설정은 제공하지 않습니다. 인증된 일반 배포를 위해서는 Windows 코드 서명 및 Apple Developer ID Application/Installer 인증서와 공증이 추가로 필요합니다.

## 실제 검증 범위

Linux에서 Windows 설치 파일을 생성하고 7-Zip의 NSIS 무결성 검사를 수행했습니다. 설치 파일을 별도 임시 디렉터리에 풀어 모든 앱 파일의 SHA-256을 원본과 비교하고, x64 PE 실행 파일 및 제거 프로그램의 포함 여부를 확인했습니다.

macOS는 두 아키텍처의 Electron 앱을 구성하고 고정 버전 `rcodesign`으로 ad-hoc 서명한 뒤 Apple flat component PKG(XAR, BOM, gzip/odc cpio Payload)를 생성했습니다. 독립된 시스템 `libarchive`로 PKG와 Payload를 읽고 모든 파일의 내용·권한·소유자·심볼릭 링크를 서명된 원본과 비교했습니다. BOM의 경로 목록, 설치 경로, 번들 ID, 버전, CPU도 확인합니다. 별도 검사기는 Mach-O 코드 페이지와 특수 슬롯, 번들 리소스, 중첩 앱의 서명 해시와 JIT entitlement를 검사합니다. 이 검사는 Apple의 `codesign`, Installer, Gatekeeper 검증을 대체하지 않습니다.

재검증 결과는 `release/installers/installer-validation.json`, 전체 설치 파일의 SHA-256은 같은 폴더의 `SHA256SUMS.txt`에 기록됩니다. 단위·소켓·한글 파일명 테스트 20개도 통과했습니다. 이미지·실제 500MB 파일과 앱 두 개의 Linux 전송 검증은 [이전 기능 검증 기록](file-transfer-verification.md)에 있습니다.

**Windows/macOS에서 실제 설치·제거·실행, 두 운영체제 사이의 실제 파일 교환은 아직 검증하지 않았습니다.** 클라우드 환경에는 해당 OS 런타임이 없습니다. `.github/workflows/installers.yml`은 각 OS의 빌드·정적 검증을 실행할 수 있도록 준비한 워크플로이며, 이번 환경에서 원격 실행하지 않았습니다.

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
