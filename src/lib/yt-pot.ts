import { BotGuardClient, getChallenge } from "bgutils-js/botguard";
import { WebPoMinter } from "bgutils-js/webpo";
import type { WebPoSignalOutput } from "bgutils-js/shared-types";

const YT_REQUEST_KEY = "O43z0dpjhgX20SCx4KAo";
const WAA_KEY = "AIzaSyDyT5W0Jh49F30Pqqtyfdf7pDLFKLJoAnw";

type Minter = { mint: (binding: string) => Promise<string> };

let minterPromise: Promise<Minter> | null = null;
const tokenCache = new Map<string, { at: number; token: string }>();
const TOKEN_TTL_MS = 4 * 60 * 1000;

function waaHeaders(): HeadersInit {
  return {
    "content-type": "application/json+protobuf",
    "x-goog-api-key": WAA_KEY,
    "x-user-agent": "grpc-web-javascript/0.1",
  };
}

async function loadInterpreter(challenge: {
  interpreterJavascript?: { privateDoNotAccessOrElseSafeScriptWrappedValue?: string };
  interpreterUrl?: { privateDoNotAccessOrElseTrustedResourceUrlWrappedValue?: string };
  interpreterHash?: string;
}) {
  const hash = challenge.interpreterHash;
  if (hash && document.getElementById(`bg-${hash}`)) return;
  const inline = challenge.interpreterJavascript?.privateDoNotAccessOrElseSafeScriptWrappedValue;
  if (inline) {
    const script = document.createElement("script");
    if (hash) script.id = `bg-${hash}`;
    script.textContent = inline;
    document.head.appendChild(script);
    return;
  }
  const rawUrl = challenge.interpreterUrl?.privateDoNotAccessOrElseTrustedResourceUrlWrappedValue;
  if (!rawUrl) throw new Error("no BotGuard interpreter");
  const src = rawUrl.startsWith("http") ? rawUrl : `https:${rawUrl}`;
  await new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    if (hash) script.id = `bg-${hash}`;
    script.src = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("interpreter script"));
    document.head.appendChild(script);
  });
}

async function integrityToken(botguardResponse: string): Promise<string> {
  const res = await fetch("https://jnn-pa.googleapis.com/$rpc/google.internal.waa.v1.Waa/GenerateIT", {
    method: "POST",
    headers: waaHeaders(),
    body: JSON.stringify([YT_REQUEST_KEY, botguardResponse]),
  });
  if (!res.ok) throw new Error(`GenerateIT ${res.status}`);
  const json = (await res.json()) as unknown;
  const token = Array.isArray(json) ? json[0] : (json as { integrityToken?: string }).integrityToken;
  if (typeof token !== "string" || token.length < 20) throw new Error("integrity token missing");
  return token;
}

async function createMinter(): Promise<Minter> {
  if (typeof window === "undefined") throw new Error("browser only");
  const challenge = await getChallenge({
    requestKey: YT_REQUEST_KEY,
    fetchFunction: fetch,
  });
  if (!challenge.program || !challenge.globalName) throw new Error("challenge incomplete");
  await loadInterpreter(challenge);
  const bg = await BotGuardClient.create({
    program: challenge.program,
    globalName: challenge.globalName,
    globalObject: window,
  });
  const webPoSignalOutput: WebPoSignalOutput = [];
  const botguardResponse = await bg.snapshot({ webPoSignalOutput }, 10000);
  const token = await integrityToken(botguardResponse);
  const minter = await WebPoMinter.create({ integrityToken: token }, webPoSignalOutput);
  return {
    mint: (binding: string) => minter.mintAsWebsafeString(binding),
  };
}

function getMinter(): Promise<Minter> {
  if (!minterPromise) {
    minterPromise = createMinter().catch((err) => {
      minterPromise = null;
      throw err;
    });
  }
  return minterPromise;
}

/** Mint a YouTube Proof-of-Origin token bound to a video id (or visitor id). Browser only. */
export async function mintYoutubePoToken(binding: string): Promise<string> {
  const hit = tokenCache.get(binding);
  if (hit && Date.now() - hit.at < TOKEN_TTL_MS) return hit.token;
  const minter = await getMinter();
  const token = await minter.mint(binding);
  if (!token || token.length < 20) throw new Error("empty poToken");
  tokenCache.set(binding, { at: Date.now(), token });
  console.info("[tubeshadow-captions] poToken", binding.slice(0, 12), token.length);
  return token;
}
