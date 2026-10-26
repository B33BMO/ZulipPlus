import { useId } from 'react';

// The Zulip+ mark: a Z with an unread dot on a sky-to-indigo tile. Mirrors
// public/icon.svg (the source for the app/installer icons); keep the two in
// step. The gradient id is per-instance so several logos can share a page.
export function Logo({ size = 24, className }: { size?: number; className?: string }) {
  const id = `zp-bg-${useId().replace(/:/g, '')}`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={className}
      role="img"
      aria-label="Zulip+"
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#7CC8FF" />
          <stop offset="1" stopColor="#5E6AD2" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="15" fill={`url(#${id})`} />
      <path
        d="M19 22H42L21 44H45"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth="6.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="47.5" cy="16.5" r="6" fill="#F5B14C" stroke={`url(#${id})`} strokeWidth="3" />
    </svg>
  );
}
