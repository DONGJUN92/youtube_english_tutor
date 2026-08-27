import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { signOut as betterSignOut, authEnabled } from "@/lib/auth/client";
import { useCurrentUserState, type AppUser, type CurrentUserState } from "@/lib/auth/use-current-user";
import { getCloudSession, signOutCloud } from "@/lib/server/cloud-auth";
import { readStoredUser, signOutDevice, writeStoredUser } from "./auth";
import { computeDeviceMode } from "./mode";

type Mode = "unknown" | "device" | "better";

type DeviceSessionApi = CurrentUserState & {
  mode: Mode;
  setUser: (user: AppUser | null) => void;
};

const DeviceSessionContext = createContext<DeviceSessionApi>({
  user: null,
  isPending: true,
  mode: "unknown",
  setUser: () => undefined,
});

export function DeviceSessionProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<Mode>("unknown");
  const [user, setUserState] = useState<AppUser | null>(null);

  useEffect(() => {
    const device = computeDeviceMode();
    setMode(device ? "device" : "better");
    if (!device) return;
    setUserState(readStoredUser());
    void getCloudSession()
      .then((cloud) => {
        if (cloud) {
          writeStoredUser(cloud);
          setUserState(cloud);
        }
      })
      .catch(() => undefined);
  }, []);

  const value = useMemo<DeviceSessionApi>(
    () => ({
      user,
      isPending: mode === "unknown",
      mode,
      setUser: (next) => {
        writeStoredUser(next);
        setUserState(next);
      },
    }),
    [user, mode],
  );

  return <DeviceSessionContext.Provider value={value}>{children}</DeviceSessionContext.Provider>;
}

export function useDeviceSession(): DeviceSessionApi {
  return useContext(DeviceSessionContext);
}

/** Unified session: device-local on Vercel, Better Auth in preview/dev. */
export function useAppUser(): CurrentUserState {
  const device = useDeviceSession();
  const better = useCurrentUserState();
  if (device.mode === "unknown") return { user: null, isPending: true };
  if (device.mode === "device") return { user: device.user, isPending: false };
  return better;
}

export async function signOutApp(): Promise<void> {
  if (computeDeviceMode()) {
    signOutDevice();
    try {
      await signOutCloud();
    } catch {
      /* cookie clear is best-effort */
    }
    window.location.href = "/";
    return;
  }
  if (authEnabled) {
    await betterSignOut("/");
    return;
  }
  window.location.href = "/";
}
