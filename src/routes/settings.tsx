import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { AuthGate } from "@/components/auth-gate";
import { Button } from "@/components/ui/button";
import { signOutApp, useAppUser } from "@/lib/device/session";
import { t, useLocaleStore } from "@/lib/i18n";
import { getMyProfile, saveLearnerSettings, type PublicProfile } from "@/lib/user-data";
import type { AgeBand, CefrLevel } from "@/lib/schema";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/settings")({ component: SettingsPage });

const AGES: AgeBand[] = ["child", "teen", "college", "adult"];
const SPEEDS = [0.75, 1, 1.25, 1.5] as const;
const LEVELS: CefrLevel[] = ["A1", "A2", "B1", "B2", "C1"];

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
  const setLocale = useLocaleStore((s) => s.setLocale);
  const { user } = useAppUser();
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [name, setName] = useState("");
  const [age, setAge] = useState<AgeBand>("adult");
  const [speed, setSpeed] = useState(1);
  const [hints, setHints] = useState(true);
  const [level, setLevel] = useState<CefrLevel>("A2");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    void getMyProfile().then((p) => {
      setProfile(p);
      if (!p) return;
      setName(p.displayName ?? user?.displayName ?? "");
      setAge(p.ageBand);
      setSpeed(p.playbackSpeed || 1);
      setHints(p.showKoHints);
      setLevel((p.cefrLevel as CefrLevel) || (p.preferredCefr as CefrLevel) || "A2");
      if (p.locale !== locale) setLocale(p.locale);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="mx-auto max-w-xl px-4 py-12 pb-24">
      <h1 className="font-display text-3xl font-medium">{t(locale, "settings")}</h1>
      <p className="mt-2 text-sm text-muted">{t(locale, "openaiHelp")}</p>

      <section className="mt-8 rounded-2xl border border-border bg-surface p-5">
        <h2 className="font-medium">{t(locale, "learnerSettings")}</h2>
        <label className="mt-4 block text-sm text-muted">{t(locale, "displayName")}</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-1 h-11 w-full rounded-lg border border-border bg-elevated px-3 text-sm"
        />
        <p className="mt-1 text-xs text-subtle">{t(locale, "displayNameHint")}</p>

        <p className="mt-5 text-sm text-muted">{t(locale, "age")}</p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {AGES.map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => setAge(a)}
              className={cn(
                "h-11 rounded-lg border text-sm",
                age === a ? "border-accent bg-elevated" : "border-border bg-bg",
              )}
            >
              {t(locale, a)}
            </button>
          ))}
        </div>

        <p className="mt-5 text-sm text-muted">{t(locale, "locale")}</p>
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={() => setLocale("ko")}
            className={cn(
              "h-11 flex-1 rounded-lg border text-sm",
              locale === "ko" ? "border-accent bg-elevated" : "border-border bg-bg",
            )}
          >
            한국어
          </button>
          <button
            type="button"
            onClick={() => setLocale("en")}
            className={cn(
              "h-11 flex-1 rounded-lg border text-sm",
              locale === "en" ? "border-accent bg-elevated" : "border-border bg-bg",
            )}
          >
            English
          </button>
        </div>

        <p className="mt-5 text-sm text-muted">{t(locale, "playbackSpeed")}</p>
        <div className="mt-2 grid grid-cols-4 gap-2">
          {SPEEDS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSpeed(s)}
              className={cn(
                "h-11 rounded-lg border text-sm",
                speed === s ? "border-accent bg-elevated" : "border-border bg-bg",
              )}
            >
              {s}×
            </button>
          ))}
        </div>

        <p className="mt-5 text-sm text-muted">{t(locale, "koHints")}</p>
        <button
          type="button"
          onClick={() => setHints((v) => !v)}
          className={cn(
            "mt-2 h-11 w-full rounded-lg border text-sm",
            hints ? "border-accent bg-elevated" : "border-border bg-bg",
          )}
        >
          {t(locale, hints ? "koHintsOn" : "koHintsOff")}
        </button>

        {!profile?.placementDone && (
          <>
            <p className="mt-5 text-sm text-muted">{t(locale, "practiceLevel")}</p>
            <div className="mt-2 grid grid-cols-5 gap-2">
              {LEVELS.map((lv) => (
                <button
                  key={lv}
                  type="button"
                  onClick={() => setLevel(lv)}
                  className={cn(
                    "h-11 rounded-lg border text-sm",
                    level === lv ? "border-accent bg-elevated" : "border-border bg-bg",
                  )}
                >
                  {lv}
                </button>
              ))}
            </div>
            <p className="mt-1 text-xs text-subtle">{t(locale, "practiceLevelHint")}</p>
          </>
        )}

        <Button
          className="mt-6 w-full"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setMsg(null);
            void saveLearnerSettings({
              data: {
                locale,
                ageBand: age,
                displayName: name,
                playbackSpeed: speed,
                showKoHints: hints,
                preferredCefr: profile?.placementDone ? undefined : level,
              },
            })
              .then((p) => {
                setProfile(p);
                setMsg(t(locale, "settingsSaved"));
              })
              .catch((e: Error) => setMsg(e.message))
              .finally(() => setBusy(false));
          }}
        >
          {t(locale, "saveSettings")}
        </Button>
        {msg && <p className="mt-3 text-sm text-muted">{msg}</p>}
        <p className="mt-3 text-xs text-subtle">
          {profile?.hasOpenAiKey ? t(locale, "lessonEngineReady") : t(locale, "lessonEngineMissing")}
        </p>
      </section>

      <section className="mt-6 rounded-2xl border border-border bg-surface p-5">
        <h2 className="font-medium">{t(locale, "placement")}</h2>
        <p className="mt-2 text-sm text-muted">
          {profile?.placementDone
            ? `${t(locale, "yourLevel")} · ${profile.cefrLevel ?? ""}`
            : t(locale, "placementNudgeBody")}
        </p>
        <Link
          to="/placement"
          className="mt-4 inline-flex h-11 items-center rounded-lg bg-accent px-4 text-sm font-medium text-accent-fg"
        >
          {t(locale, profile?.placementDone ? "retakePlacement" : "startPlacement")}
        </Link>
      </section>

      <section className="mt-6 rounded-2xl border border-border bg-surface p-5">
        <h2 className="font-medium">{t(locale, "accountSection")}</h2>
        <p className="mt-2 text-sm text-muted">
          {t(locale, "signedInAs")} · {user?.primaryEmail ?? user?.displayName}
        </p>
        <Button className="mt-4" variant="secondary" onClick={() => void signOutApp()}>
          {t(locale, "logout")}
        </Button>
      </section>
      <p className="mt-6 text-sm text-subtle">{t(locale, "sttHint")}</p>
    </main>
  );
}
