import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { Bookmark, Home, Settings } from "@/components/icons";
import { signOutApp, useAppUser } from "@/lib/device/session";
import { t, useLocaleStore } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export function AppShell({ children }: { children: React.ReactNode }) {
  const locale = useLocaleStore((s) => s.locale);
  const setLocale = useLocaleStore((s) => s.setLocale);
  const { user, isPending } = useAppUser();

  return (
    <div className="min-h-screen bg-bg text-fg">
      <header className="sticky top-0 z-30 border-b border-border bg-bg/90 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4">
          <Link to="/" className="flex items-center gap-2">
            <span className="grid size-7 place-items-center rounded-md bg-accent text-accent-fg">
              <PlayMark />
            </span>
            <span className="font-display text-sm font-semibold tracking-tight">
              {t(locale, "app")}
            </span>
          </Link>
          <nav className="hidden items-center gap-1 sm:flex">
            <NavLink to="/" icon={<Home className="size-4" />} label={t(locale, "home")} />
            <NavLink to="/saved" icon={<Bookmark className="size-4" />} label={t(locale, "saved")} />
            <NavLink to="/settings" icon={<Settings className="size-4" />} label={t(locale, "settings")} />
          </nav>
          <div className="flex items-center gap-2">
            <div className="flex rounded-full border border-border p-0.5 text-xs">
              <button
                type="button"
                className={cn(
                  "rounded-full px-2.5 py-1",
                  locale === "ko" ? "bg-elevated text-fg" : "text-muted",
                )}
                onClick={() => setLocale("ko")}
              >
                KO
              </button>
              <button
                type="button"
                className={cn(
                  "rounded-full px-2.5 py-1",
                  locale === "en" ? "bg-elevated text-fg" : "text-muted",
                )}
                onClick={() => setLocale("en")}
              >
                EN
              </button>
            </div>
            {isPending ? (
              <div className="size-8 animate-pulse rounded-full bg-elevated" />
            ) : user ? (
              <AccountChip
                label={user.displayName ?? user.primaryEmail ?? "Account"}
                image={user.profileImageUrl}
              />
            ) : (
              <Link
                to="/login"
                className="rounded-full bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg"
              >
                {t(locale, "signIn")}
              </Link>
            )}
          </div>
        </div>
      </header>
      {children}
      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-3 border-t border-border bg-bg/95 pb-[env(safe-area-inset-bottom)] sm:hidden">
        <TabLink to="/" label={t(locale, "home")} />
        <TabLink to="/saved" label={t(locale, "saved")} />
        <TabLink to="/settings" label={t(locale, "settings")} />
      </nav>
    </div>
  );
}

function AccountChip({ label, image }: { label: string; image: string | null }) {
  const [signingOut, setSigningOut] = useState(false);
  return (
    <div className="flex max-w-[40vw] items-center gap-2 sm:max-w-none">
      {image ? (
        <img src={image} alt="" className="h-8 w-8 rounded-full object-cover" />
      ) : (
        <span className="grid h-8 w-8 place-items-center rounded-full bg-elevated text-sm font-medium">
          {label.charAt(0).toUpperCase()}
        </span>
      )}
      <span className="hidden truncate text-sm font-medium sm:inline">{label}</span>
      <button
        type="button"
        disabled={signingOut}
        onClick={() => {
          setSigningOut(true);
          void signOutApp().catch(() => setSigningOut(false));
        }}
        className="text-sm text-muted underline-offset-4 hover:underline disabled:cursor-wait"
      >
        {signingOut ? "…" : "Out"}
      </button>
    </div>
  );
}

function NavLink({ to, icon, label }: { to: string; icon: React.ReactNode; label: string }) {
  return (
    <Link
      to={to}
      className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-muted hover:bg-elevated hover:text-fg"
      activeProps={{ className: "text-fg bg-elevated" }}
    >
      {icon}
      {label}
    </Link>
  );
}

function TabLink({ to, label }: { to: string; label: string }) {
  return (
    <Link
      to={to}
      className="grid h-12 place-items-center text-xs text-muted"
      activeProps={{ className: "text-fg" }}
    >
      {label}
    </Link>
  );
}

function PlayMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-3.5 fill-current" aria-hidden="true">
      <path d="M8 5.5v13l11-6.5L8 5.5z" />
    </svg>
  );
}
