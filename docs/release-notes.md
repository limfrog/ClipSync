# ClipSync 0.4.4 · 내부 기기 발견 보완

같은 공유기의 Mac과 Windows가 서로 발견하지 못한 보고를 바탕으로 탐색 경로와 진단을 보완했습니다.

- 각 네트워크 어댑터의 서브넷 브로드캐스트 탐색을 추가했습니다. 기존 멀티캐스트·외부 P2P 탐색과 함께 사용합니다.
- 공통 발견 그룹에서 다른 연결 정보의 ClipSync 신호도 감지합니다. 같은 키·비밀번호의 인증을 통과한 기기끼리만 연결합니다.
- **연결 상태 복사**에 OS 버전과 송신·수신·다른 그룹·인증 거부·접속 시도 수를 추가했습니다. 키·비밀번호·IP·기기 이름·클립보드 내용은 포함하지 않습니다.
- 저장된 연결 정보와 텍스트·이미지·500MB 파일 동기화는 유지합니다. 별도 서버·유료 중계·포트 스캔은 추가하지 않았습니다.

양쪽 앱을 오른쪽 아래 **종료**로 닫고 **0.4.4**를 설치하세요. 기존 연결 정보는 유지합니다. 두 앱을 켜고 10초 정도 기다린 뒤 연결 상태를 확인하세요. 연결되지 않으면 양쪽 **기기 연결 → 연결 상태 복사** 보고서를 비교할 수 있습니다.

방화벽과 Mac 로컬 네트워크에서 ClipSync를 허용해야 합니다. 공유기가 기기 간 통신이나 브로드캐스트도 차단하면 연결되지 않을 수 있습니다. 배포 후 사용자가 실물 Mac–Windows 연결·텍스트·이미지·한글 처리·300MB 파일 전송, 자동 재연결과 외부망 연결 성공을 보고했습니다. 기존 실패의 구체적인 원인과 성공한 발견 경로는 특정하지 않았습니다. 외부망의 UDP·NAT 제한도 유지됩니다.

[검증 기록](https://github.com/limfrog/ClipSync/blob/main/docs/broadcast-discovery-verification.md) · [Mac–Windows 실물 검증 절차](https://github.com/limfrog/ClipSync/blob/main/docs/physical-verification.md)

Windows x64: `ClipSync-0.4.4-Windows-x64-Setup.exe` · Apple Silicon: `ClipSync-0.4.4-macOS-arm64.pkg` · Intel Mac: `ClipSync-0.4.4-macOS-x64.pkg`. SHA-256은 `SHA256SUMS.txt`에서 확인하세요. Windows 배포자 인증서 서명·Apple 공증은 포함하지 않으며, macOS 앱은 ad-hoc 서명입니다.
