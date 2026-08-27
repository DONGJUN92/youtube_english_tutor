import { useEffect, useId, useRef } from "react";

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
  destroy: () => void;
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
  onReady?: (player: YtPlayer) => void;
  onTime?: (sec: number) => void;
};

export function YoutubePlayer({ videoId, onReady, onTime }: Props) {
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
          origin: window.location.origin,
        },
        events: {
          onReady: (e) => {
            playerRef.current = e.target;
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

type ClipJob = { player: YtPlayer; videoId: string; start: number; end: number };

let clipTimer: number | undefined;
let pendingClip: Omit<ClipJob, "player"> | null = null;
let activePlayer: YtPlayer | null = null;

function flushPending(player: YtPlayer) {
  activePlayer = player;
  if (!pendingClip) return;
  const job = pendingClip;
  pendingClip = null;
  playClip(player, job.start, job.end, job.videoId);
}

export function playClip(player: YtPlayer | null, start: number, end: number, videoId?: string) {
  const s = Math.max(0, Number(start) || 0);
  const e = Math.max(s + 0.6, Number(end) || s + 8);
  if (!player) {
    if (videoId) pendingClip = { videoId, start: s, end: e };
    return;
  }
  activePlayer = player;
  if (clipTimer) window.clearInterval(clipTimer);
  clipTimer = undefined;

  const run = (p: YtPlayer) => {
    try {
      if (videoId && typeof p.loadVideoById === "function") {
        p.loadVideoById({ videoId, startSeconds: s, endSeconds: e });
      } else {
        p.seekTo(s, true);
        p.playVideo();
      }
    } catch {
      try {
        p.seekTo(s, true);
        p.playVideo();
      } catch {
        return;
      }
    }

    let armed = false;
    const began = Date.now();
    clipTimer = window.setInterval(() => {
      try {
        const t = p.getCurrentTime();
        if (!armed) {
          if (t >= s - 0.4 && t < e + 0.6) armed = true;
          else if (Date.now() - began > 900) {
            p.seekTo(s, true);
            p.playVideo();
            armed = true;
          }
          return;
        }
        if (t >= e - 0.08 || Date.now() - began > (e - s) * 1000 + 2500) {
          p.pauseVideo();
          if (clipTimer) window.clearInterval(clipTimer);
          clipTimer = undefined;
        }
      } catch {
        if (clipTimer) window.clearInterval(clipTimer);
        clipTimer = undefined;
      }
    }, 80);
  };

  run(player);
}

export function getActivePlayer() {
  return activePlayer;
}
