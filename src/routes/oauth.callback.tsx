import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { upsertOAuthAccount } from "@/lib/device/auth";
import { clearOAuthStart, readOAuthStart } from "@/lib/device/oauth";
import { useDeviceSession } from "@/lib/device/session";
import { exchangeGooglePkce, exchangeGrokOAuth } from "@/lib/server/device-ai";
import { completeXSignIn } from "@/lib/server/cloud-auth";
import { migrateLocalToCloud } from "@/lib/device/migrate";

export const Route = createFileRoute("/oauth/callback")({ component: OAuthCallback });

function OAuthCallback() {
  const navigate = useNavigate();
  const { setUser } = useDeviceSession();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const err = params.get("error_description") || params.get("error") || params.get("message");
    const code = params.get("code");
    const state = params.get("state");
    const pending = readOAuthStart();

    if (err && !code) {
      setError(err);
      return;
    }
    if (!code || !pending || pending.state !== state) {
      setError("Sign-in was cancelled or the session expired. Please try again.");
      return;
    }

    const exchange =
      pending.idp === "twitter"
        ? completeXSignIn({
            data: { code, verifier: pending.verifier, redirectUri: pending.redirectUri },
          }).then((cloud) => ({ kind: "x" as const, cloud }))
        : (pending.issuer === "google"
            ? exchangeGooglePkce({
                data: {
                  code,
                  verifier: pending.verifier,
                  redirectUri: pending.redirectUri,
                  clientId: pending.clientId,
                },
              })
            : exchangeGrokOAuth({
                data: { code, verifier: pending.verifier, redirectUri: pending.redirectUri },
              })
          ).then((res) => ({ kind: "oauth" as const, res }));

    void exchange
      .then(async (result) => {
        if (result.kind === "x") {
          setUser(result.cloud);
          void migrateLocalToCloud().catch(() => undefined);
        } else {
          if (!result.res.ok) throw new Error(result.res.error);
          const user = await upsertOAuthAccount({
            provider: pending.idp,
            sub: result.res.sub,
            email: result.res.email,
            name: result.res.name,
            image: result.res.image,
          });
          setUser(user);
        }
        clearOAuthStart();
        await navigate({ to: "/" });
      })
      .catch((e: unknown) => {
        const raw = e instanceof Error ? e.message : "Sign-in failed";
        const secretMissing = /client_secret is missing/i.test(raw);
        setError(
          secretMissing
            ? "Google 웹 클라이언트는 코드 교환에 비밀키가 필요합니다. 로그인 화면으로 돌아가 Google로 계속을 다시 눌러 주세요. 팝업으로 로그인됩니다."
            : raw,
        );
      });
  }, [navigate, setUser]);

  return (
    <main className="grid min-h-screen place-items-center bg-bg px-5 text-fg">
      <div className="w-full max-w-sm text-center">
        {error ? (
          <>
            <h1 className="font-display text-2xl">Sign-in failed</h1>
            <p className="mt-3 text-sm text-muted">{error}</p>
            <a href="/login" className="mt-6 inline-flex h-11 items-center rounded-full bg-accent px-5 text-sm text-accent-fg">
              Back to sign in
            </a>
          </>
        ) : (
          <>
            <div className="mx-auto h-10 w-40 animate-pulse rounded-full bg-elevated" />
            <p className="mt-4 text-sm text-muted">Finishing sign-in…</p>
          </>
        )}
      </div>
    </main>
  );
}
