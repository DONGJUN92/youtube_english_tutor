# TubeShadow (튜브쉐도잉)

유튜브로 듣고 따라 말하는 영어. 링크를 붙이면 클립 듣기 · 쉐도잉 · 말하기 연습이 됩니다.

## 레벨 테스트

형식은 하나입니다. 듣기·읽기 객관식 8문항 다음 말하기 4턴. 맞으면 어렵게, 틀리거나 시간이 끝나면 쉽게 갑니다.

결과는 듣기 · 말하기 · 어휘 · 문장 이해 각각 초급/중급/고급(81조합)과 공유용 별명 16가지입니다. 카드 뉴스로 저장할 수 있습니다.

같은 문제 묶음은 한 번만 봅니다. 중간에 나가면 처음부터입니다.

레벨 테스트 없이도 바로 공부할 수 있습니다. 새 영상을 세 번 공부할 때마다 테스트를 권하는 안내가 뜹니다.

## OpenAI 키 (운영자)

학습자가 키를 넣지 않습니다. Vercel 환경 변수 `OPENAI_API_KEY`에 운영자 키를 넣으세요. 선택적으로 `OPENAI_MODEL` (기본 `gpt-4.1-mini`). **Production**에 저장한 뒤 다시 배포해야 앱이 읽습니다.

추천 클립은 키 없이도 연습됩니다. 직접 붙인 YouTube와 말하기 평가에 키가 쓰입니다. 붙여 넣은 영상은 문제를 만드는 동안 진행 화면이 보입니다.

## 계정 · 기기 연동

공개 사이트는 Neon에 계정·레벨·단어장·진도를 저장합니다. 같은 Google 계정으로 다른 기기에서 이어집니다.

Google 로그인은 Google Identity Services 팝업입니다. Google Cloud 웹 클라이언트에 다음을 넣으세요.

- 승인된 자바스크립트 원본: `https://tubeshadow.vercel.app`

Vercel에 필요한 값:

- `DATABASE_URL` — Neon 연결 문자열 (풀링, `sslmode=require`)
- `OPENAI_API_KEY` — 문제 생성용

## 스택

TanStack Start, React 19, Tailwind v4, Postgres (Neon / 미리보기는 PGLite).

## 배포

GitHub `main`에 푸시하면 Vercel이 빌드합니다.

공개 주소: [https://tubeshadow.vercel.app](https://tubeshadow.vercel.app)
