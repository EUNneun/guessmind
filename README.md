# 게스마인드 (GuessMind)

실서비스 주소: https://guessmind-sigma.vercel.app/

영화 세 편의 별점(0~10점)과 진짜 한줄평을 맞히는 모바일 웹 퀴즈입니다. 자체 영화 목록은 `movies.json`에 있습니다. 카드를 선택하거나 넘기면서 문제를 만듭니다.

## 실제 서비스 배포: Vercel + Firebase

GitHub 저장소를 Vercel에 Import합니다. 프로젝트 루트는 저장소 최상위, 프레임워크는 Other(정적 HTML), Build Command는 비워둡니다. `index.html`과 정적 파일은 Vercel에서, `/api/gateway`는 Node.js Function으로 제공됩니다.

Vercel Project Settings → Environment Variables에 다음을 **Production 및 Preview** 범위로 등록하고 재배포하세요.

| 이름 | 값 | 비밀 여부 |
| --- | --- | --- |
| `OPENAI_API_KEY` | OpenAI API 키 | 비밀 |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | `guessmind-ed9a4` 프로젝트의 Firebase 서비스 계정 JSON 전체 | 비밀 |
| `OPENAI_MODEL` | 생략 가능. 기본 `gpt-4o-mini` | 일반 |

비밀값은 GitHub, 프론트 코드, 이슈, 채팅에 올리지 마세요. 서비스 계정에는 Firestore 읽기·쓰기 권한이 필요하며 키 파일은 로컬에만 보관하거나 삭제하세요. Firebase Authentication의 익명 제공업체와 Firestore를 활성화하세요. Firestore Console → Rules에 이 저장소의 `firestore.rules` 내용을 게시한 뒤 배포하세요. 클라이언트 직접 읽기·쓰기를 모두 막고 Vercel 함수만 Admin SDK로 접근합니다.

브라우저는 Firebase 익명 인증으로 UID를 받고 닉네임을 등록합니다. 서버는 ID 토큰을 검증해 퀴즈·정답·참여 이력을 Firestore에 저장합니다. 공개 퀴즈 응답에는 실제 별점과 정답이 포함되지 않으며 서버가 채점합니다. UID당 퀴즈 중복 참여를 막고 AI 오답 생성은 UTC 날짜별 10회로 제한합니다. 쿠키나 앱 삭제 등으로 익명 UID가 바뀌면 같은 사람을 식별할 수 없습니다.

카카오 공유는 `KAKAO_JS_KEY`가 설정되지 않아 기기 공유/링크 복사로 대체됩니다. 실제 카카오 SDK 공유는 별도 설정이 필요합니다. 포스터 이미지는 사용하지 않습니다.

## 화면 테스트판

`docs/`는 [GitHub Pages 테스트판](https://eunneun.github.io/guessmind/)입니다. 예시 오답과 브라우저 저장만 사용하므로 다른 기기와 퀴즈 데이터가 동기화되지 않습니다. 실제 공유는 Vercel 배포 주소에서 확인합니다.

## 개발 메모

`copy.js`는 일부 화면 문구와 과거 샘플 영화 데이터를 보존합니다. 실제 목록은 `movies.json`이 기준입니다. `server.mjs`의 SQLite 방식과 `firebase/` 아래 Cloud Functions 준비안은 Vercel 전환으로 제거했습니다.
