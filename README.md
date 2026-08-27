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

계정·레벨·단어장을 **기기 간에 유지**하려면 Vercel 프로젝트 Environment Variables에 다음을 넣으세요.

| 변수 | 값 |
|---|---|
| `DATABASE_URL` | Neon Postgres 연결 문자열 |
| `BETTER_AUTH_URL` | `https://tubeshadow.vercel.app` |
| `BETTER_AUTH_SECRET` | 32자 이상 임의 문자열 |
| `GROK_AUTH_CLIENT_ID` / `GROK_AUTH_CLIENT_SECRET` | Google·X 로그인용 (배포기에서 발급) |

`DATABASE_URL`이 없으면 인스턴스 메모리 DB로 동작해 재시작 시 계정이 사라집니다. Google·X 로그인은 브로커 키가 있을 때만 됩니다. 이메일 가입은 `BETTER_AUTH_URL`이 공개 주소와 같아야 합니다.
