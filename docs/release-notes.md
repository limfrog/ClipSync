# ClipSync 0.2.0

PC 간 텍스트 클립보드 동기화와 이미지·파일 전송을 지원합니다. 파일당 최대 500MB(500,000,000바이트)이며, 한글 파일명을 UTF-8/NFC로 처리하고 원본 파일 내용은 그대로 보존합니다. 받은 프로그램은 자동 실행하지 않습니다.

- Windows x64: `ClipSync-0.2.0-Windows-x64-Setup.exe`
- macOS Apple Silicon: `ClipSync-0.2.0-macOS-arm64.pkg`
- macOS Intel: `ClipSync-0.2.0-macOS-x64.pkg`
- SHA-256 확인: `SHA256SUMS.txt`

macOS 13 이상이 필요합니다. 두 PC를 같은 네트워크에 연결하고 첫 PC에서 연결을 연 뒤 초대 코드를 다른 PC에 입력하세요. 이미지·파일은 수신 PC를 선택해 보내고, 받는 PC에서 수락해 저장합니다. 폴더와 macOS .app 번들은 먼저 ZIP으로 압축하세요.

이 사전 릴리스에는 배포자 인증서 서명과 Apple 공증이 없습니다. macOS 앱에는 무결성 확인용 ad-hoc 서명이 있습니다. 운영체제에서 설치·실행을 차단할 수 있습니다. Windows/macOS에서 사용자 설치·제거·실행 및 두 운영체제 사이의 실제 전송은 아직 검증하지 않았습니다.

GitHub Actions는 각 운영체제에서 설치 파일을 빌드하고 단위·소켓 테스트 20개와 macOS 코드 서명·PKG 확장 검사를 수행한 후 이 릴리스를 게시합니다. 이미지·한글 프로그램 파일·실제 500MB 전송은 Linux의 독립된 앱 두 개에서 검증했습니다. 자세한 검증 범위는 저장소의 `docs/file-transfer-verification.md`, `docs/installers.md`를 참고하세요.
