import { useEffect, useId, useRef } from "react";
import { playRange } from "@/lib/clip-timing";

declare global {
  interface Window {
    YT?: {
      Player: new (
        id: string,
        opts: {
          videoId: string;
          playerVars?: Record<string, number | string>;
          events?: {
            onReady?: (e: { target: YtPlayer }) => void;
            onStateChange?: (e: { data: number; target: YtPlayer }) => void;
          };
        },
      ) => YtPlayer;
      PlayerState: { PLAYING: number; PAUSED: number; ENDED: number; CUED: number };
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

export type YtPlayer = {
  playVideo: () => void;
  pauseVideo: () => void;
  seekTo: (sec: number, allowSeekAhead: boolean) => void;
  loadVideoById: (opts: {
    videoId: string;
    startSeconds?: number;
    endSeconds?: number;
  }) => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  getPlayerState: () => number;
  setPlaybackRate: (rate: number) => void;
  destroy: () => void;
  getIframe?: () => HTMLIFrameElement;
  loadModule?: (name: string) => void;
  getOptions?: () => string[];
  getOption?: (module: string, option: string) => unknown;
};

let apiPromise: Promise<void> | null = null;
function loadApi() {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.YT?.Player) return Promise.resolve();
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve) => {
    const existing = document.querySelector('script[src="https://www.youtube.com/iframe_api"]');
    window.onYouTubeIframeAPIReady = () => resolve();
    if (!existing) {
      const s = document.createElement("script");
      s.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(s);
    }
    const t = window.setInterval(() => {
      if (window.YT?.Player) {
        window.clearInterval(t);
        resolve();
      }
    }, 50);
  });
  return apiPromise;
}

type Props = {
  videoId: string;
  playbackRate?: number;
  onReady?: (player: YtPlayer) => void;
  onTime?: (sec: number) => void;
};

export function YoutubePlayer({ videoId, playbackRate = 1, onReady, onTime }: Props) {
  const id = useId().replace(/:/g, "");
  const playerRef = useRef<YtPlayer | null>(null);
  const onReadyRef = useRef(onReady);
  const onTimeRef = useRef(onTime);
  onReadyRef.current = onReady;
  onTimeRef.current = onTime;

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    void loadApi().then(() => {
      if (cancelled || !window.YT) return;
      playerRef.current?.destroy();
      const player = new window.YT.Player(`yt-${id}`, {
        videoId,
        playerVars: {
          rel: 0,
          modestbranding: 1,
          playsinline: 1,
          enablejsapi: 1,
          cc_load_policy: 1,
          origin: window.location.origin,
        },
        events: {
          onReady: (e) => {
            playerRef.current = e.target;
            try {
              if (playbackRate && playbackRate !== 1) e.target.setPlaybackRate(playbackRate);
            } catch {
              /* ignore */
            }
            onReadyRef.current?.(e.target);
            timer = window.setInterval(() => {
              try {
                onTimeRef.current?.(e.target.getCurrentTime());
              } catch {
                /* player gone */
              }
            }, 500);
            flushPending(e.target);
          },
        },
      });
      playerRef.current = player;
    });
    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
      try {
        playerRef.current?.destroy();
      } catch {
        /* ignore */
      }
      playerRef.current = null;
    };
  }, [videoId, id]);

  return (
    <div className="relative overflow-hidden rounded-xl bg-elevated aspect-video">
      <div id={`yt-${id}`} className="absolute inset-0 h-full w-full" />
    </div>
  );
}

type ClipJob = { videoId: string; start: number; end: number };

let clipTimer: number | undefined;
let pendingClip: ClipJob | null = null;
let activePlayer: YtPlayer | null = null;
let clipDone: (() => void) | null = null;

function finishClip() {
  clipDone?.();
  clipDone = null;
}

function runClip(player: YtPlayer, start: number, end: number, videoId?: string) {
  const { start: s, end: e } = playRange(start, end);
  activePlayer = player;
  if (clipTimer) window.clearInterval(clipTimer);
  clipTimer = undefined;

  try {
    if (videoId && typeof player.loadVideoById === "function") {
      player.loadVideoById({ videoId, startSeconds: s, endSeconds: e });
    } else {
      player.seekTo(s, true);
      player.playVideo();
    }
  } catch {
    try {
      player.seekTo(s, true);
      player.playVideo();
    } catch {
      finishClip();
      return;
    }
  }

  let armed = false;
  const began = Date.now();
  clipTimer = window.setInterval(() => {
    try {
      const t = player.getCurrentTime();
      if (!armed) {
        if (t >= s - 0.4 && t < e + 0.6) armed = true;
        else if (Date.now() - began > 900) {
          player.seekTo(s, true);
          player.playVideo();
          armed = true;
        }
        return;
      }
      if (t >= e - 0.08 || Date.now() - began > (e - s) * 1000 + 2500) {
        player.pauseVideo();
        if (clipTimer) window.clearInterval(clipTimer);
        clipTimer = undefined;
        finishClip();
      }
    } catch {
      if (clipTimer) window.clearInterval(clipTimer);
      clipTimer = undefined;
      finishClip();
    }
  }, 80);
}

function flushPending(player: YtPlayer) {
  activePlayer = player;
  if (!pendingClip) return;
  const job = pendingClip;
  pendingClip = null;
  runClip(player, job.start, job.end, job.videoId);
}

export function playClip(player: YtPlayer | null, start: number, end: number, videoId?: string): Promise<void> {
  return new Promise((resolve) => {
    finishClip();
    clipDone = resolve;
    if (!player) {
      if (videoId) pendingClip = { videoId, start, end };
      else finishClip();
      return;
    }
    pendingClip = null;
    runClip(player, start, end, videoId);
  });
}

export function getActivePlayer() {
  return activePlayer;
}
