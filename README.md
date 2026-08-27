# TubeShadow (튜브쉐도잉)

유튜브로 듣고 따라 말하는 영어. 링크를 붙이면 클립 듣기 · 쉐도잉 · 말하기 연습이 됩니다.

## 레벨 테스트

형식은 하나입니다. 듣기·읽기 객관식 8문항 다음 말하기 4턴. 맞으면 어렵게, 틀리거나 시간이 끝나면 쉽게 갑니다.

결과는 듣기 · 말하기 · 어휘 · 문장 이해 각각 초급/중급/고급(81조합)과 공유용 별명 16가지입니다. 카드 뉴스로 저장할 수 있습니다.

같은 문제 묶음은 한 번만 봅니다. 중간에 나가면 처음부터입니다.

## OpenAI 키 (새 영상 · 말하기 평가)

추천 클립은 키 없이 연습됩니다. 직접 붙인 유튜브와 말하기 평가에는 키가 필요합니다.

1. [platform.openai.com](https://platform.openai.com)에 로그인
2. Settings → Billing에서 결제 수단을 넣습니다 ($5면 시작 가능)
3. [API keys](https://platform.openai.com/api-keys)에서 비밀 키를 만듭니다
4. 앱 **설정**에 `sk-` / `sk-proj-` 키를 붙여넣습니다. 채팅에 붙여 넣지 마세요
5. **연결 테스트**를 누릅니다

키는 서버에서 암호화되어 계정에만 저장됩니다. 전체 키는 다시 보여 주지 않습니다.

## 스택

TanStack Start, React 19, Tailwind v4, Postgres (Neon / 미리보기는 PGLite).

## 배포

GitHub `main`에 푸시하면 Vercel이 빌드합니다.

공개 주소: [https://tubeshadow.vercel.app](https://tubeshadow.vercel.app)

공개 사이트는 **이 기기 IndexedDB**에 계정·레벨·단어장을 저장합니다. Vercel 환경 변수는 필요 없습니다.

Google 로그인은 OAuth2 PKCE입니다. Google Cloud 웹 클라이언트에 아래 두 값을 넣으세요.

- 승인된 자바스크립트 원본: `https://tubeshadow.vercel.app`
- 승인된 리디렉션 URI: `https://tubeshadow.vercel.app/oauth/callback`

이메일 가입은 바로 됩니다. 기기 간 동기화가 필요하면 Neon `DATABASE_URL`과 Better Auth 변수를 Vercel에 넣을 수 있습니다.
