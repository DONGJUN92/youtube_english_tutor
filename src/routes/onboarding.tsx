import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell } from "@/components/app-shell";
import { AuthGate } from "@/components/auth-gate";
import { Button } from "@/components/ui/button";
import { t, useLocaleStore } from "@/lib/i18n";
import { upsertOnboarding } from "@/lib/user-data";
import type { AgeBand } from "@/lib/schema";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/onboarding")({ component: OnboardingPage });

const AGES: AgeBand[] = ["child", "teen", "college", "adult"];

function OnboardingPage() {
  return (
    <AppShell>
      <AuthGate>
        <Onboarding />
      </AuthGate>
    </AppShell>
  );
}

function Onboarding() {
  const locale = useLocaleStore((s) => s.locale);
  const setLocale = useLocaleStore((s) => s.setLocale);
  const navigate = useNavigate();
  const [age, setAge] = useState<AgeBand>("adult");
  const [busy, setBusy] = useState(false);

  return (
    <main className="mx-auto max-w-xl px-4 py-12 pb-24">
      <h1 className="font-display text-4xl font-medium">{t(locale, "onboardingTitle")}</h1>
      <p className="mt-2 text-muted">{t(locale, "onboardingBody")}</p>
      <div className="mt-8 grid gap-2">
        {AGES.map((a) => (
          <button
            key={a}
            type="button"
            onClick={() => setAge(a)}
            className={cn(
              "rounded-xl border px-4 py-4 text-left",
              age === a ? "border-accent bg-elevated" : "border-border bg-surface",
            )}
          >
            <span className="font-medium">{t(locale, a)}</span>
          </button>
        ))}
      </div>
      <div className="mt-8 flex gap-2">
        <Button
          variant={locale === "ko" ? "primary" : "secondary"}
          onClick={() => setLocale("ko")}
        >
          한국어
        </Button>
        <Button
          variant={locale === "en" ? "primary" : "secondary"}
          onClick={() => setLocale("en")}
        >
          English
        </Button>
      </div>
      <Button
        className="mt-8 w-full"
        size="lg"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void upsertOnboarding({ data: { locale, ageBand: age } })
            .then(() => navigate({ to: "/" }))
            .finally(() => setBusy(false));
        }}
      >
        {t(locale, "next")}
      </Button>
    </main>
  );
}
