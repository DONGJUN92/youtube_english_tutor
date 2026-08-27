import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { GROK_PROVIDERS, authClient, authEnabled, signIn } from "@/lib/auth/client";
import { APP_NAME_KO, APP_TAGLINE_KO } from "@/lib/brand";
import { signInEmail, signUpEmail } from "@/lib/device/auth";
import { computeDeviceMode } from "@/lib/device/mode";
import { startGrokOAuth } from "@/lib/device/oauth";
import { useDeviceSession } from "@/lib/device/session";
import { t, useLocaleStore } from "@/lib/i18n";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/login")({ component: Login });

function Login() {
  const locale = useLocaleStore((s) => s.locale);
  const navigate = useNavigate();
  const { setUser } = useDeviceSession();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [device, setDevice] = useState(false);

  useEffect(() => {
    setDevice(computeDeviceMode());
  }, []);

  async function onEmail(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (device) {
        const user =
          mode === "signup"
            ? await signUpEmail({ email, password, name: name || email.split("@")[0] })
            : await signInEmail({ email, password });
        setUser(user);
        await navigate({ to: "/" });
        return;
      }
      if (mode === "signup") {
        const res = await authClient.signUp.email({ email, password, name: name || email.split("@")[0] });
        if (res.error) throw new Error(res.error.message);
      } else {
        const res = await authClient.signIn.email({ email, password });
        if (res.error) throw new Error(res.error.message);
      }
      await navigate({ to: "/" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function onOAuth(providerId: string, idp: string) {
    setBusy(true);
    setError(null);
    try {
      if (device) {
        await startGrokOAuth(idp === "google" ? "google" : "twitter");
        return;
      }
      await signIn(providerId, { callbackURL: "/" });
    } catch (err) {
      setError(err instanceof Error ? err.message : t(locale, "oauthFailed"));
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-bg px-5 text-fg">
      <div className="w-full max-w-sm">
        <Link to="/" className="mb-8 flex items-center gap-2">
          <span className="grid size-8 place-items-center rounded-md bg-accent text-accent-fg">
            <svg viewBox="0 0 24 24" className="size-4 fill-current" aria-hidden="true">
              <path d="M8 5.5v13l11-6.5L8 5.5z" />
            </svg>
          </span>
          <span className="font-display text-lg font-semibold">{APP_NAME_KO}</span>
        </Link>
        <h1 className="font-display text-3xl font-medium">{t(locale, "signInTitle")}</h1>
        <p className="mt-2 text-sm text-muted">{t(locale, "signInBody")}</p>
        <p className="mt-1 text-sm text-subtle">{APP_TAGLINE_KO}</p>
        {device && <p className="mt-3 text-sm text-muted">{t(locale, "deviceHint")}</p>}
        <div className="mt-8 grid gap-2">
          {authEnabled ? (
            GROK_PROVIDERS.map((p) => (
              <Button
                key={p.providerId}
                type="button"
                variant={p.idp === "google" ? "primary" : "secondary"}
                size="lg"
                className="w-full"
                disabled={busy}
                onClick={() => void onOAuth(p.providerId, p.idp)}
              >
                {p.idp === "google" ? t(locale, "continueGoogle") : t(locale, "continueX")}
              </Button>
            ))
          ) : (
            <p className="text-sm text-muted">Sign-in is disabled.</p>
          )}
        </div>
        <p className="mt-6 text-center text-xs text-subtle">
          {locale === "ko" ? "또는 이메일" : "or email"}
        </p>
        <form className="mt-3 grid gap-2" onSubmit={onEmail}>
          {mode === "signup" && (
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={locale === "ko" ? "이름" : "Name"}
              className="h-11 rounded-lg border border-border bg-elevated px-3 text-sm"
            />
          )}
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@email.com"
            className="h-11 rounded-lg border border-border bg-elevated px-3 text-sm"
          />
          <input
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={locale === "ko" ? "비밀번호 (8자 이상)" : "Password (8+ chars)"}
            className="h-11 rounded-lg border border-border bg-elevated px-3 text-sm"
          />
          <Button type="submit" variant="outline" size="lg" disabled={busy} className="w-full">
            {mode === "signup"
              ? locale === "ko"
                ? "이메일로 가입"
                : "Create account"
              : locale === "ko"
                ? "이메일로 로그인"
                : "Sign in with email"}
          </Button>
        </form>
        <button
          type="button"
          className="mt-3 w-full text-center text-sm text-muted"
          onClick={() => setMode(mode === "signup" ? "signin" : "signup")}
        >
          {mode === "signup"
            ? locale === "ko"
              ? "이미 계정이 있나요? 로그인"
              : "Have an account? Sign in"
            : locale === "ko"
              ? "처음인가요? 계정 만들기"
              : "New here? Create an account"}
        </button>
        {error && <p className="mt-3 text-sm text-accent">{error}</p>}
      </div>
    </main>
  );
}
