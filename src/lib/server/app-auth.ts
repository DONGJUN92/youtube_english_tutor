import { createMiddleware } from "@tanstack/react-start";

/**
 * Per-user middleware: Better Auth session (preview / grok-sandbox) OR the
 * TubeShadow cloud cookie (Vercel Google / email). Never trusts a client id.
 */
export const appAuthMiddleware = createMiddleware({ type: "function" })
  .client(async ({ next }) => {
    const { getBearerToken } = await import("@/lib/auth/client");
    return next({ sendContext: { bearerToken: getBearerToken() ?? undefined } });
  })
  .server(async ({ next, context }) => {
    const { assertSameSiteRequest } = await import("@/lib/auth/isolation.server");
    const { requireUserId, UnauthorizedError } = await import("@/lib/auth/verify.server");
    const { readCloudSession } = await import("./cloud-session.server");
    assertSameSiteRequest();
    try {
      const userId = await requireUserId(context.bearerToken);
      return next({ context: { userId } });
    } catch (err) {
      if (!(err instanceof UnauthorizedError)) throw err;
      const cloud = await readCloudSession();
      if (!cloud) throw err;
      return next({ context: { userId: cloud.uid } });
    }
  });
