import type { SVGProps } from "react";
import { cn } from "@/lib/utils";

type IconProps = SVGProps<SVGSVGElement>;

function I({ className, children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={cn("size-4", className)}
      {...props}
    >
      {children}
    </svg>
  );
}

export function Mic(p: IconProps) {
  return (
    <I {...p}>
      <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <path d="M12 19v3" />
    </I>
  );
}
export function Clock(p: IconProps) {
  return (
    <I {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </I>
  );
}
export function Download(p: IconProps) {
  return (
    <I {...p}>
      <path d="M12 4v12" />
      <path d="m7 12 5 5 5-5" />
      <path d="M5 20h14" />
    </I>
  );
}
export function Volume2(p: IconProps) {
  return (
    <I {...p}>
      <path d="M4 10v4h4l5 4V6L8 10H4Z" />
      <path d="M16 9a5 5 0 0 1 0 6" />
      <path d="M18.5 7a8 8 0 0 1 0 10" />
    </I>
  );
}
export function Bookmark(p: IconProps) {
  return (
    <I {...p}>
      <path d="M7 4h10a1 1 0 0 1 1 1v15l-6-3-6 3V5a1 1 0 0 1 1-1Z" />
    </I>
  );
}
export function Home(p: IconProps) {
  return (
    <I {...p}>
      <path d="M4 11 12 4l8 7" />
      <path d="M6 10v10h12V10" />
    </I>
  );
}
export function Settings(p: IconProps) {
  return (
    <I {...p}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.2a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.2a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.2a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9c.3.6.9 1 1.5 1H21a2 2 0 1 1 0 4h-.2a1.7 1.7 0 0 0-1.5 1Z" />
    </I>
  );
}
export function ChevronLeft(p: IconProps) {
  return (
    <I {...p}>
      <path d="m15 6-6 6 6 6" />
    </I>
  );
}
export function ChevronRight(p: IconProps) {
  return (
    <I {...p}>
      <path d="m9 6 6 6-6 6" />
    </I>
  );
}
export function Check(p: IconProps) {
  return (
    <I {...p}>
      <path d="m5 13 4 4 10-10" />
    </I>
  );
}
export function RotateCcw(p: IconProps) {
  return (
    <I {...p}>
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <path d="M3 5v5h5" />
    </I>
  );
}
export function TriangleAlert(p: IconProps) {
  return (
    <I {...p}>
      <path d="m12 4 9 16H3L12 4Z" />
      <path d="M12 10v4" />
      <path d="M12 17h.01" />
    </I>
  );
}
export function BookOpen(p: IconProps) {
  return (
    <I {...p}>
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H12v16H6.5A2.5 2.5 0 0 0 4 21.5Z" />
      <path d="M20 5.5A2.5 2.5 0 0 0 17.5 3H12v16h5.5A2.5 2.5 0 0 1 20 21.5Z" />
    </I>
  );
}
export function EyeOff(p: IconProps) {
  return (
    <I {...p}>
      <path d="M4 4l16 16" />
      <path d="M10.6 10.6A2 2 0 0 0 13.4 13.4" />
      <path d="M7.1 7.3C5 8.6 3.6 10.5 3 12c1.2 3.2 4.8 7 9 7 1.6 0 3.1-.4 4.4-1.1" />
      <path d="M16.9 16.7C19 15.4 20.4 13.5 21 12c-1.2-3.2-4.8-7-9-7-1.1 0-2.1.2-3.1.5" />
    </I>
  );
}
export function Eye(p: IconProps) {
  return (
    <I {...p}>
      <path d="M3 12c1.2 3.2 4.8 7 9 7s7.8-3.8 9-7c-1.2-3.2-4.8-7-9-7s-7.8 3.8-9 7Z" />
      <circle cx="12" cy="12" r="2.5" />
    </I>
  );
}
