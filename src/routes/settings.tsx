import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { AuthGate } from "@/components/auth-gate";
import { Button } from "@/components/ui/button";
import { t, useLocaleStore } from "@/lib/i18n";
import { getMyProfile, pingOpenAiKey, saveOpenAiSettings, type PublicProfile } from "@/lib/server/fns";

export const Route = createFileRoute("/settings")({ component: SettingsPage });

function SettingsPage() {
  return (
    <AppShell>
      <AuthGate>
        <SettingsForm />
      </AuthGate>
    </AppShell>
  );
}

function SettingsForm() {
  const locale = useLocaleStore((s) => s.locale);
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [key, setKey] = useState("");
  const [model, setModel] = useState("gpt-4.1-mini");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ping, setPing] = useState<string | null>(null);
  const [pingBusy, setPingBusy] = useState(false);

  function runPing() {
    setPingBusy(true);
    void pingOpenAiKey()
      .then((r) => {
        if (r.ok) setPing(locale === "ko" ? `연결 확인 · ${r.model}` : `Connected · ${r.model}`);
        else if (r.message === "missing_key") setPing(t(locale, "needKey"));
        else setPing(`${t(locale, "keyFail")} ${r.message}`);
      })
      .catch((e: Error) => setPing(e.message))
      .finally(() => setPingBusy(false));
  }

  useEffect(() => {
    void getMyProfile().then((p) => {
      setProfile(p);
      if (p?.openaiModel) setModel(p.openaiModel);
      if (p?.hasOpenAiKey) runPing();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const steps =
    locale === "ko"
      ? [
          {
            n: "1",
            title: "OpenAI에 로그인",
            body: "휴대폰이나 컴퓨터 브라우저에서 platform.openai.com 을 엽니다. 계정이 없으면 Sign up을 눌러 이메일로 만듭니다.",
            href: "https://platform.openai.com",
            cta: "OpenAI 열기",
          },
          {
            n: "2",
            title: "결제 수단 등록",
            body: "왼쪽 메뉴 Settings → Billing 에서 카드를 등록합니다. API는 유료입니다. 처음에는 $5만 넣어도 이 앱의 문제 생성에는 충분합니다.",
            href: "https://platform.openai.com/settings/organization/billing",
            cta: "Billing 열기",
          },
          {
            n: "3",
            title: "API keys 메뉴로 이동",
            body: "왼쪽 메뉴에서 API keys 를 누릅니다. 또는 오른쪽 위 프로필 사진 → API keys.",
            href: "https://platform.openai.com/api-keys",
            cta: "API keys 열기",
          },
          {
            n: "4",
            title: "새 키 만들기",
            body: "Create new secret key 버튼을 누릅니다. 이름은 TubeShadow 정도만 적고 Create secret key를 누릅니다. Permissions는 All 또는 Restricted(모델 사용)면 됩니다.",
          },
          {
            n: "5",
            title: "키 복사 (한 번만 보임)",
            body: "sk- 또는 sk-proj- 로 시작하는 긴 글자가 나옵니다. Copy를 누르세요. 이 화면은 다시 열리지 않습니다. 채팅창에는 절대 붙여넣지 마세요.",
          },
          {
            n: "6",
            title: "이 페이지 아래에 붙여넣고 저장",
            body: "아래 입력칸에 붙여넣습니다. 모델은 gpt-4.1-mini 그대로 둡니다. 암호화해서 저장을 누르면 서버에만 암호화되어 저장되고, 다시는 전체 키를 보여 주지 않습니다.",
          },
        ]
      : [
          {
            n: "1",
            title: "Sign in to OpenAI",
            body: "Open platform.openai.com in a browser. Create an account if you do not have one.",
            href: "https://platform.openai.com",
            cta: "Open OpenAI",
          },
          {
            n: "2",
            title: "Add billing",
            body: "Go to Settings → Billing and add a card. The API is paid. About $5 of credit is enough to start generating lessons.",
            href: "https://platform.openai.com/settings/organization/billing",
            cta: "Open Billing",
          },
          {
            n: "3",
            title: "Open API keys",
            body: "In the left menu choose API keys, or open your profile menu → API keys.",
            href: "https://platform.openai.com/api-keys",
            cta: "Open API keys",
          },
          {
            n: "4",
            title: "Create a secret key",
            body: "Click Create new secret key, name it TubeShadow, then Create secret key.",
          },
          {
            n: "5",
            title: "Copy it once",
            body: "Copy the string that starts with sk- or sk-proj-. OpenAI shows the full key only once. Never paste it in chat.",
          },
          {
            n: "6",
            title: "Paste and save here",
            body: "Paste it in the field below, leave the model as gpt-4.1-mini, then Encrypt and save. We store it encrypted and never show the full key again.",
          },
        ];

  return (
    <main className="mx-auto max-w-xl px-4 py-12 pb-24">
      <h1 className="font-display text-3xl font-medium">{t(locale, "settings")}</h1>
      <section className="mt-8 rounded-2xl border border-border bg-surface p-5">
        <h2 className="font-medium">{t(locale, "openaiSection")}</h2>
        <p className="mt-2 text-sm text-muted">{t(locale, "openaiHelp")}</p>
        <ol className="mt-5 grid gap-3">
          {steps.map((s) => (
            <li key={s.n} className="flex gap-3 rounded-xl border border-border bg-elevated p-3">
              <span className="grid size-7 shrink-0 place-items-center rounded-md bg-surface text-sm font-medium">
                {s.n}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium">{s.title}</p>
                <p className="mt-1 text-sm text-muted">{s.body}</p>
                {"href" in s && s.href && (
                  <a
                    href={s.href}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-flex h-9 items-center rounded-lg border border-border bg-surface px-3 text-xs"
                  >
                    {s.cta}
                  </a>
                )}
              </div>
            </li>
          ))}
        </ol>
        <p className="mt-4 text-sm text-subtle">
          {locale === "ko"
            ? "추천 클립은 키 없이 바로 연습할 수 있습니다. 직접 붙인 YouTube 링크의 문제를 만들 때만 키가 필요합니다."
            : "Featured clips work without a key. You only need a key to generate questions for a YouTube link you paste."}
        </p>
        <p className="mt-2 text-sm text-subtle">
          {profile?.hasOpenAiKey
            ? locale === "ko"
              ? "키가 저장되어 있습니다. 새 키를 넣으면 교체됩니다."
              : "A key is saved. Paste a new one to replace it."
            : t(locale, "needKey")}
        </p>
        <label className="mt-4 block text-sm text-muted">{t(locale, "keyPlaceholder")}</label>
        <input
          type="password"
          autoComplete="off"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="sk-proj-..."
          className="mt-1 h-11 w-full rounded-lg border border-border bg-elevated px-3 text-sm"
        />
        <label className="mt-4 block text-sm text-muted">{t(locale, "model")}</label>
        <input
          value={model}
          onChange={(e) => setModel(e.target.value)}
          className="mt-1 h-11 w-full rounded-lg border border-border bg-elevated px-3 text-sm"
        />
        <p className="mt-2 text-xs text-subtle">
          {locale === "ko"
            ? "기본값 gpt-4.1-mini. gpt-4o-mini, gpt-5-mini 등 OpenAI 모델명만 입력하세요. Grok 모델은 사용하지 않습니다."
            : "Default gpt-4.1-mini. OpenAI model ids only — never Grok."}
        </p>
        <Button
          className="mt-5"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setMsg(null);
            void saveOpenAiSettings({ data: { apiKey: key, model } })
              .then((p) => {
                setProfile(p);
                setKey("");
                setMsg(t(locale, "keySaved"));
                if (p?.hasOpenAiKey) runPing();
              })
              .catch((e: Error) => setMsg(e.message))
              .finally(() => setBusy(false));
          }}
        >
          {locale === "ko" ? "암호화해서 저장" : "Encrypt and save"}
        </Button>
        {msg && <p className="mt-3 text-sm text-muted">{msg}</p>}
        <Button
          className="mt-3"
          variant="secondary"
          disabled={pingBusy || !profile?.hasOpenAiKey}
          onClick={runPing}
        >
          {t(locale, "testKey")}
        </Button>
        {ping && <p className="mt-3 text-sm text-muted">{ping}</p>}
      </section>
      <p className="mt-6 text-sm text-subtle">{t(locale, "sttHint")}</p>
    </main>
  );
}
