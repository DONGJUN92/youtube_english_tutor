import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { useAppUser } from "@/lib/device/session";
import { t, useLocaleStore } from "@/lib/i18n";
import { getMyProfile, listProgress, type PublicProfile } from "@/lib/user-data";
import { FEATURED_CATALOG, extractYoutubeId, thumbnailUrl } from "@/lib/youtube";
import { APP_NAME_KO } from "@/lib/brand";

export const Route = createFileRoute("/")({ component: HomePage });

function HomePage() {
  const { user, isPending } = useAppUser();
  return (
    <AppShell>
      {isPending ? (
        <div className="mx-auto max-w-6xl px-4 py-16">
          <div className="h-48 animate-pulse rounded-2xl bg-surface" />
        </div>
      ) : user ? (
        <HomeApp />
      ) : (
        <Landing />
      )}
    </AppShell>
  );
}

function Landing() {
  const locale = useLocaleStore((s) => s.locale);
  const hero = FEATURED_CATALOG[0];
  return (
    <main>
      <section className="relative isolate min-h-96 overflow-hidden">
        <img
          src={thumbnailUrl(hero.videoId)}
          alt=""
          className="absolute inset-0 h-full w-full object-cover opacity-40"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-bg via-bg/80 to-bg/30" />
        <div className="absolute inset-0 bg-gradient-to-t from-bg via-transparent to-bg/40" />
        <div className="relative mx-auto max-w-6xl px-4 pb-16 pt-14 sm:pt-20">
          <p className="text-sm font-medium tracking-wide text-accent">{APP_NAME_KO}</p>
          <h1 className="mt-3 max-w-3xl font-display text-4xl font-medium sm:text-6xl">{t(locale, "heroTitle")}</h1>
          <p className="mt-4 max-w-xl text-base text-muted sm:text-lg">{t(locale, "heroBody")}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/login" className="inline-flex h-12 items-center rounded-full bg-accent px-6 text-sm font-medium text-accent-fg">
              {t(locale, "signIn")}
            </Link>
            <a href="#catalog" className="inline-flex h-12 items-center rounded-full border border-border-strong bg-bg/40 px-6 text-sm">
              {t(locale, "recommended")}
            </a>
          </div>
        </div>
      </section>
      <section id="catalog" className="mx-auto max-w-6xl px-4 pb-24 pt-4">
        <h2 className="font-display text-xl">{t(locale, "recommended")}</h2>
        <div className="rail mt-4">
          {FEATURED_CATALOG.map((c) => (
            <Link
              key={c.videoId}
              to="/watch/$videoId"
              params={{ videoId: c.videoId }}
              className="w-56 shrink-0 overflow-hidden rounded-xl border border-border bg-surface"
            >
              <img src={thumbnailUrl(c.videoId)} alt="" className="aspect-video w-full object-cover" />
              <div className="p-3">
                <p className="text-sm font-medium">{locale === "ko" ? c.titleKo : c.titleEn}</p>
                <p className="mt-1 text-xs text-muted">{locale === "ko" ? c.reasonKo : c.reasonEn}</p>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}

function HomeApp() {
  const locale = useLocaleStore((s) => s.locale);
  const navigate = useNavigate();
  const [profile, setProfile] = useState<PublicProfile | null | undefined>(undefined);
  const [url, setUrl] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [continueWatching, setContinueWatching] = useState<
    { video_id: string; title: string | null; thumbnail: string | null; position_sec: number }[]
  >([]);

  useEffect(() => {
    void getMyProfile()
      .then(setProfile)
      .catch(() => setProfile(null));
    void listProgress()
      .then(setContinueWatching)
      .catch(() => setContinueWatching([]));
  }, []);

  if (profile === undefined) {
    return <div className="mx-auto max-w-6xl px-4 py-16"><div className="h-40 animate-pulse rounded-2xl bg-surface" /></div>;
  }
  if (!profile) {
    return <NavigateOnboarding to="/onboarding" />;
  }

  const catalog = FEATURED_CATALOG.filter((c) => c.ages.includes(profile.ageBand));

  function go(raw: string) {
    const id = extractYoutubeId(raw);
    if (!id) {
      setErr(t(locale, "invalidUrl"));
      return;
    }
    void navigate({ to: "/watch/$videoId", params: { videoId: id } });
  }

  return (
    <main className="mx-auto max-w-6xl px-4 pb-24 pt-8">
      <p className="text-sm text-muted">
        {profile.placementDone
          ? `${t(locale, "yourLevel")} · ${profile.cefrLevel ?? "A2"} · ${t(locale, profile.ageBand)}`
          : `${t(locale, "practiceLevel")} · ${profile.preferredCefr ?? "A2"} · ${t(locale, profile.ageBand)}`}
        {!profile.placementDone && (
          <Link to="/placement" className="ml-2 text-accent underline">
            {t(locale, "startPlacement")}
          </Link>
        )}
      </p>
      <h1 className="mt-2 max-w-3xl font-display text-4xl font-medium sm:text-5xl">{t(locale, "heroTitle")}</h1>
      <form
        className="mt-6 flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          go(url);
        }}
      >
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={t(locale, "paste")}
          className="h-12 flex-1 rounded-full border border-border-strong bg-elevated px-5 text-sm text-fg placeholder:text-subtle"
        />
        <Button type="submit" size="pill">
          {t(locale, "start")}
        </Button>
      </form>
      {err && <p className="mt-2 text-sm text-accent">{err}</p>}
      <p className="mt-3 text-xs text-subtle">{t(locale, "seededHint")}</p>

      {continueWatching.length > 0 && (
        <Rail title={t(locale, "continueRail")}>
          {continueWatching.map((item) => (
            <VideoCard
              key={item.video_id}
              videoId={item.video_id}
              title={item.title ?? item.video_id}
              subtitle={`${item.position_sec}s`}
              thumb={item.thumbnail}
            />
          ))}
        </Rail>
      )}

      <Rail title={`${t(locale, "recommended")} · ${profile.cefrLevel ?? ""}`}>
        {catalog.map((c) => (
          <VideoCard
            key={c.videoId}
            videoId={c.videoId}
            title={locale === "ko" ? c.titleKo : c.titleEn}
            subtitle={locale === "ko" ? c.reasonKo : c.reasonEn}
          />
        ))}
      </Rail>
    </main>
  );
}

function NavigateOnboarding({ to }: { to: "/onboarding" | "/placement" }) {
  const navigate = useNavigate();
  useEffect(() => {
    void navigate({ to });
  }, [navigate, to]);
  return <div className="mx-auto max-w-6xl px-4 py-16"><div className="h-40 animate-pulse rounded-2xl bg-surface" /></div>;
}

function Rail({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="font-display text-xl">{title}</h2>
      <div className="rail mt-4">{children}</div>
    </section>
  );
}

function VideoCard({
  videoId,
  title,
  subtitle,
  thumb,
}: {
  videoId: string;
  title: string;
  subtitle?: string;
  thumb?: string | null;
}) {
  return (
    <Link
      to="/watch/$videoId"
      params={{ videoId }}
      className="w-56 shrink-0 overflow-hidden rounded-xl border border-border bg-surface"
    >
      <img src={thumb || thumbnailUrl(videoId)} alt="" className="aspect-video w-full object-cover" />
      <div className="p-3">
        <p className="line-clamp-2 text-sm font-medium">{title}</p>
        {subtitle && <p className="mt-1 line-clamp-2 text-xs text-muted">{subtitle}</p>}
      </div>
    </Link>
  );
}
