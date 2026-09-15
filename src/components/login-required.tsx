import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { t, useLocaleStore } from "@/lib/i18n";
import { safeLoginNext } from "@/lib/youtube";

const NEXT_KEY = "tubeshadow.login-next";

export function rememberLoginNext(path?: string) {
  const safe = safeLoginNext(path);
  try {
    if (safe) window.sessionStorage.setItem(NEXT_KEY, safe);
    else window.sessionStorage.removeItem(NEXT_KEY);
  } catch {
    /* ignore */
  }
}

export function takeLoginNext(searchNext?: string | null): string | undefined {
  let stored: string | null = null;
  try {
    stored = window.sessionStorage.getItem(NEXT_KEY);
    window.sessionStorage.removeItem(NEXT_KEY);
  } catch {
    stored = null;
  }
  return safeLoginNext(searchNext) ?? safeLoginNext(stored);
}

export function loginHref(nextPath?: string) {
  const safe = safeLoginNext(nextPath);
  return safe ? `/login?next=${encodeURIComponent(safe)}` : "/login";
}

export function LoginRequiredDialog({
  open,
  body,
  nextPath,
  autoGo = false,
  onDismiss,
}: {
  open: boolean;
  body: string;
  nextPath?: string;
  autoGo?: boolean;
  onDismiss?: () => void;
}) {
  const locale = useLocaleStore((s) => s.locale);
  const went = useRef(false);

  function go() {
    if (went.current) return;
    went.current = true;
    rememberLoginNext(nextPath);
    window.location.assign(loginHref(nextPath));
  }

  useEffect(() => {
    if (!open) {
      went.current = false;
      return;
    }
    if (!autoGo) return;
    const id = window.setTimeout(go, 1600);
    return () => window.clearTimeout(id);
  }, [open, autoGo, nextPath]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-bg/80 px-4">
      <div
        className="w-full max-w-md rounded-2xl border border-border bg-surface p-6"
        role="dialog"
        aria-modal="true"
        aria-labelledby="login-required-title"
      >
        <h2 id="login-required-title" className="font-display text-2xl">
          {t(locale, "loginRequiredTitle")}
        </h2>
        <p className="mt-3 text-sm text-muted">{body}</p>
        <div className="mt-6 grid gap-2">
          <Button className="w-full" onClick={go}>
            {t(locale, "goToLogin")}
          </Button>
          {onDismiss ? (
            <Button className="w-full" variant="secondary" onClick={onDismiss}>
              {t(locale, "later")}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
