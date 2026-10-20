# 0.4.5 창 상단 드래그 수정

## 문제와 수정

제목 글자 줄에서는 창이 이동하지만 그 위쪽 여백에서는 움직이지 않는 Windows 사용자 보고를 확인했습니다. 기존 CSS는 `.header-top`에만 드래그 영역을 지정해 `.header`의 위쪽 12px 패딩을 제외했습니다.

`.header` 전체를 드래그 영역으로 확장했습니다. 상단 도구 모음·버튼과 가로로 스크롤하는 기기 목록은 `no-drag`로 유지합니다. 검색 입력과 기록 항목의 영역은 기존 동작을 사용합니다.

## 확인

- 수정 전 실제 Electron 창에 네이티브 포인터 입력을 보내면 제목 줄 좌표 `(130,22)`는 이동하고, 위쪽 여백 `(130,6)`에서는 이동하지 않아 보고된 증상을 재현했습니다.
- 수정 후 Linux/Xvfb/Openbox에서 제목 줄 `(130,22)`, 제목 위쪽 `(130,6)`, 버튼 위쪽 `(330,6)`의 세 지점 모두 실제 창 위치가 바뀌었습니다. 설정 버튼·검색·기록 고정·창 숨김과 재실행 후 위치/연결 복원 검사도 통과했습니다.
- Windows CI에서는 실제 창 핸들과 DPI를 반영한 화면 좌표로 `WM_NCHITTEST`를 조회합니다. 제목과 위쪽 패딩의 세 지점이 `HTCAPTION(2)`, 설정·숨김 버튼·기기 목록은 `HTCLIENT(1)`인지 검사합니다. 브라우저의 가상 마우스 이벤트만으로 창 이동 여부를 추정하지 않습니다.

Linux의 포인터 입력 검사와 Windows의 영역 판정 검사는 검사 방법이 다릅니다. Windows 실물에서 마우스로 이동하는 최종 확인은 사용자 환경의 추가 확인으로 남습니다.

## 아이콘

[세 가지 시안과 최종 A 아이콘](icon-concepts.md)을 기록했습니다. 사용자 선택에 따라 A의 바탕을 투명하게 바꾸고 청록색 클립보드·동기화 심볼을 앱·설치 프로그램에 적용했습니다. Mac 메뉴바에는 흰색·검은색으로 자동 표시되는 전용 단색 템플릿을 사용합니다.

## 실행 결과 · 2026-10-21 (Asia/Seoul)

- 제품 커밋: `94e47e8` / 태그: `v0.4.5`.
- [최종 CI](https://github.com/limfrog/ClipSync/actions/runs/39492257819): Windows, Linux, Apple Silicon Mac, Intel Mac 네 작업 모두 성공했습니다. Windows의 실제 `WM_NCHITTEST` 영역 판정과 보안 저장소·재실행 복원, Linux의 실제 포인터 창 이동 및 데스크톱·전송 통합 검사가 포함됩니다.
- 새 아이콘 적용 후 Linux Electron에서 설정·검색·기록 고정·다시 복사·숨김·실제 OS 클립보드 동기화 검사가 성공했습니다. [다크·라이트 실제 화면](icon-concepts.md#실제-electron-화면-확인)을 확인했습니다.
- PNG·Windows ICO의 투명 알파와 16–256px 프레임, macOS ICNS의 16–1024px 프레임을 확인했습니다. 전용 Mac 메뉴바 템플릿은 18px/36px이며 배경·내용 줄·클립 홀·순환 표시 내부가 투명합니다.
- 로컬 Windows 설치 파일의 7-Zip NSIS 무결성 검사와 앱·설치 파일의 7개 아이콘 리소스 비교가 성공했습니다. NSIS는 리소스 ID 순서를 바꾸므로 프레임 내용 전체를 순서와 무관하게 비교합니다.
- 패키징 중 발견한 기존 설정의 문제도 수정했습니다. 플랫폼별 제외 패턴만 지정하면 별도의 전체 파일 매처가 추가되어 과거 `release` 결과물이 ASAR에 포함됐습니다. 플랫폼별 파일 집합에도 앱 허용 목록을 지정했으며, 실제 ASAR의 최상위 구성이 `dist`, `node_modules`, `package.json`, `THIRD_PARTY_NOTICES.txt` 네 항목뿐임을 확인했습니다. 릴리스마다 실제 패키지의 구성·버전·아이콘을 검사합니다.

Mac 메뉴바의 실제 흰색/검은색 전환과 Windows 실물의 마우스 드래그는 사용자 기기에서의 추가 확인 대상입니다.

## 공개 설치 파일 확인

[설치 프로그램 빌드·게시](https://github.com/limfrog/ClipSync/actions/runs/39492740237)가 성공했습니다. Windows의 실제 EXE·설치 파일 아이콘과 앱 구성, Mac 두 앱의 ICNS·ad-hoc 서명 및 PKG 확장 검사가 포함됩니다.

[릴리스 v0.4.5](https://github.com/limfrog/ClipSync/releases/tag/v0.4.5)의 고정 HTTPS 주소에서 아래 세 파일과 `SHA256SUMS.txt`를 실제로 다시 내려받았습니다. 각각 파일 크기·PE/XAR 헤더·SHA-256이 일치했습니다. 검증 결과는 로컬 `release/github-download/v0.4.5/download-validation.json`에도 기록됩니다.

| 파일 | 바이트 | SHA-256 |
| --- | ---: | --- |
| `ClipSync-0.4.5-Windows-x64-Setup.exe` | 116,561,952 | `482c3a22794ec49267b70ebb8e36ed00cd841250eee1fe401b4f894634ea2222` |
| `ClipSync-0.4.5-macOS-arm64.pkg` | 129,331,842 | `7161908b9c1a999e1d7bd08ccab9ea52724ec19ff1617ab30d63ab5d90797d8f` |
| `ClipSync-0.4.5-macOS-x64.pkg` | 136,271,483 | `b098afe4f25ba3456e485e4c0133f4299135bcc5830fcaff15838c3294ac39e2` |

공개 링크에서 내려받은 Windows 설치 파일도 7-Zip NSIS 무결성 검사에서 `Everything is Ok`를 확인했습니다.

[중복 파일 수신 방지 검토](duplicate-file-review.md)는 별도 검토 문서이며, 이 기능은 0.4.5에 구현되지 않았습니다.
