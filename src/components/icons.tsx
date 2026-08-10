/* Minimal line-icon set (24px grid, stroke=currentColor) so the UI reads
   premium instead of emoji-grade. */

export function Icon({
  d, size = 22, strokeWidth = 1.8, className = "", filled = false, children,
}: {
  d?: string; size?: number; strokeWidth?: number; className?: string;
  filled?: boolean; children?: React.ReactNode;
}) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"} stroke="currentColor"
      strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
      className={className} aria-hidden
    >
      {d ? <path d={d} /> : children}
    </svg>
  );
}

export const SunIcon = (p: { size?: number; className?: string }) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </Icon>
);

export const KettlebellIcon = (p: { size?: number; className?: string }) => (
  <Icon {...p}>
    <path d="M9 8.5V7a3 3 0 0 1 6 0v1.5" />
    <path d="M12 21a6.5 6.5 0 0 0 4.6-11.1 6.5 6.5 0 0 0-9.2 0A6.5 6.5 0 0 0 12 21Z" />
  </Icon>
);

export const PlateIcon = (p: { size?: number; className?: string }) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="4.5" />
  </Icon>
);

export const TrendIcon = (p: { size?: number; className?: string }) => (
  <Icon {...p}>
    <path d="M3 17l5.2-5.2 3.6 3.6L21 7" />
    <path d="M15.5 7H21v5.5" />
  </Icon>
);

export const ChatIcon = (p: { size?: number; className?: string }) => (
  <Icon {...p}>
    <path d="M21 12a8 8 0 0 1-8 8c-1.4 0-2.8-.3-4-1l-5 1.2L5.2 16A8 8 0 1 1 21 12Z" />
  </Icon>
);

export const CameraIcon = (p: { size?: number; className?: string }) => (
  <Icon {...p}>
    <path d="M4 8h2.5l1.5-2.5h8L17.5 8H20a1.5 1.5 0 0 1 1.5 1.5V18a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 18V9.5A1.5 1.5 0 0 1 4 8Z" />
    <circle cx="12" cy="13.5" r="3.5" />
  </Icon>
);

export const MicIcon = (p: { size?: number; className?: string }) => (
  <Icon {...p}>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3" />
  </Icon>
);

export const SendIcon = (p: { size?: number; className?: string }) => (
  <Icon {...p}>
    <path d="M12 20V5M6 11l6-6 6 6" />
  </Icon>
);

export const BoltIcon = (p: { size?: number; className?: string }) => (
  <Icon {...p}>
    <path d="M13 2 4.5 13.5H11L10 22l8.5-11.5H13L13 2Z" />
  </Icon>
);

export const CalendarIcon = (p: { size?: number; className?: string }) => (
  <Icon {...p}>
    <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
    <path d="M3.5 9.5h17M8 3v4M16 3v4" />
  </Icon>
);

export const BellIcon = (p: { size?: number; className?: string }) => (
  <Icon {...p}>
    <path d="M18 16H6l1.2-2V9.8A4.8 4.8 0 0 1 12 5a4.8 4.8 0 0 1 4.8 4.8V14L18 16Z" />
    <path d="M10 19a2 2 0 0 0 4 0" />
  </Icon>
);

export const TrophyIcon = (p: { size?: number; className?: string }) => (
  <Icon {...p}>
    <path d="M8 4h8v5a4 4 0 0 1-8 0V4Z" />
    <path d="M8 5H4.5v1A3.5 3.5 0 0 0 8 9.5M16 5h3.5v1A3.5 3.5 0 0 1 16 9.5" />
    <path d="M12 13v3.5M8.5 20.5h7M10 20.5v-2h4v2" />
  </Icon>
);

export const ClipboardIcon = (p: { size?: number; className?: string }) => (
  <Icon {...p}>
    <rect x="5.5" y="4.5" width="13" height="16" rx="2" />
    <path d="M9 4.5a3 3 0 0 1 6 0M8.5 10.5h7M8.5 14h7M8.5 17.5h4.5" />
  </Icon>
);

export const CartIcon = (p: { size?: number; className?: string }) => (
  <Icon {...p}>
    <path d="M3 4h2l2.4 11.2A1.5 1.5 0 0 0 8.9 16.5h8.8a1.5 1.5 0 0 0 1.5-1.2L21 7H6" />
    <circle cx="9.5" cy="20" r="1.4" />
    <circle cx="17" cy="20" r="1.4" />
  </Icon>
);

export const PlayIcon = (p: { size?: number; className?: string }) => (
  <Icon {...p}>
    <path d="M8 5.5v13l10-6.5-10-6.5Z" />
  </Icon>
);
