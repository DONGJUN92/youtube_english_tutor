import { RedirectToSignIn } from "@/lib/auth/gates";
import { useAppUser } from "@/lib/device/session";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, isPending } = useAppUser();
  if (isPending) {
    return (
      <div className="grid min-h-[60vh] place-items-center">
        <div className="h-10 w-40 animate-pulse rounded-full bg-elevated" />
      </div>
    );
  }
  if (!user) return <RedirectToSignIn />;
  return <>{children}</>;
}
