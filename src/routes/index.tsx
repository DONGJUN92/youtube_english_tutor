import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { ChevronLeft, ChevronRight } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { useAppUser } from "@/lib/device/session";
import { relativeTimeFrom, t, useLocaleStore } from "@/lib/i18n";
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
    { video_id: string; title: string | null; thumbnail: string | null; position_sec: number; first_seen_at?: string; updated_at?: string }[]
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
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
        <span>
          {profile.placementDone
            ? `${t(locale, "yourLevel")} · ${profile.cefrLevel ?? "A2"} · ${t(locale, profile.ageBand)}`
            : `${t(locale, "practiceLevel")} · ${profile.preferredCefr ?? "A2"} · ${t(locale, profile.ageBand)}`}
        </span>
        {!profile.placementDone && (
          <Link to="/placement" className="text-accent underline">
            {t(locale, "startPlacement")}
          </Link>
        )}
      </p>
      <h1 className="mt-2 max-w-3xl font-display text-3xl font-medium leading-tight sm:text-5xl">{t(locale, "heroTitle")}</h1>
      <form
        className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-stretch"
        onSubmit={(e) => {
          e.preventDefault();
          go(url);
        }}
      >
        <label className="block min-w-0 flex-1">
          <span className="mb-2 block text-sm font-medium text-fg">YouTube URL</span>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={t(locale, "paste")}
            autoComplete="url"
            className="h-14 w-full rounded-2xl border-2 border-white/45 bg-zinc-800 px-5 text-base text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)] placeholder:text-white/55 focus:border-white focus:outline-none"
          />
        </label>
        <Button type="submit" size="pill" className="h-14 shrink-0 sm:mt-7 sm:self-auto">
          {t(locale, "start")}
        </Button>
      </form>
      {err && <p className="mt-2 text-sm text-accent">{err}</p>}
      <p className="mt-3 text-xs text-subtle">{t(locale, "seededHint")}</p>

      {continueWatching.length > 0 && (
        <Rail title={t(locale, "continueRail")} nav>
          {continueWatching.map((item) => (
            <VideoCard
              key={item.video_id}
              videoId={item.video_id}
              title={item.title ?? item.video_id}
              subtitle={relativeTimeFrom(item.first_seen_at || item.updated_at, locale)}
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

function Rail({ title, children, nav = false }: { title: string; children: React.ReactNode; nav?: boolean }) {
  const locale = useLocaleStore((s) => s.locale);
  const scroller = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; left: number; moved: boolean; pointer: number | null }>({
    x: 0,
    left: 0,
    moved: false,
    pointer: null,
  });
  const [dragging, setDragging] = useState(false);

  function scrollByCards(dir: -1 | 1) {
    const el = scroller.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.min(el.clientWidth * 0.85, 560), behavior: "smooth" });
  }

  return (
    <section className="mt-10">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-xl">{title}</h2>
        {nav && (
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              aria-label={t(locale, "railPrev")}
              className="grid size-10 place-items-center rounded-full border border-border bg-surface text-fg hover:border-accent"
              onClick={() => scrollByCards(-1)}
            >
              <ChevronLeft className="size-5" />
            </button>
            <button
              type="button"
              aria-label={t(locale, "railNext")}
              className="grid size-10 place-items-center rounded-full border border-border bg-surface text-fg hover:border-accent"
              onClick={() => scrollByCards(1)}
            >
              <ChevronRight className="size-5" />
            </button>
          </div>
        )}
      </div>
      <div
        ref={scroller}
        className={`rail mt-4 ${dragging ? "is-dragging" : ""}`}
        onPointerDown={(e) => {
          if (e.pointerType === "mouse" && e.button !== 0) return;
          const el = scroller.current;
          if (!el) return;
          drag.current = { x: e.clientX, left: el.scrollLeft, moved: false, pointer: e.pointerId };
          setDragging(true);
          el.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const el = scroller.current;
          if (!el || drag.current.pointer !== e.pointerId) return;
          const dx = e.clientX - drag.current.x;
          if (Math.abs(dx) > 6) drag.current.moved = true;
          if (drag.current.moved) {
            el.scrollLeft = drag.current.left - dx;
          }
        }}
        onPointerUp={(e) => {
          if (drag.current.pointer !== e.pointerId) return;
          drag.current.pointer = null;
          setDragging(false);
        }}
        onPointerCancel={() => {
          drag.current.pointer = null;
          setDragging(false);
        }}
        onClickCapture={(e) => {
          if (drag.current.moved) {
            e.preventDefault();
            e.stopPropagation();
            drag.current.moved = false;
          }
        }}
      >
        {children}
      </div>
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
