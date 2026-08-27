import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { upsertOAuthAccount } from "@/lib/device/auth";
import { clearOAuthStart, readOAuthStart } from "@/lib/device/oauth";
import { useDeviceSession } from "@/lib/device/session";
import { exchangeGrokOAuth } from "@/lib/server/device-ai";

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

    void exchangeGrokOAuth({
      data: { code, verifier: pending.verifier, redirectUri: pending.redirectUri },
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(res.error);
        const user = await upsertOAuthAccount({
          provider: pending.idp,
          sub: res.sub,
          email: res.email,
          name: res.name,
          image: res.image,
        });
        setUser(user);
        clearOAuthStart();
        await navigate({ to: "/" });
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : "Sign-in failed");
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
