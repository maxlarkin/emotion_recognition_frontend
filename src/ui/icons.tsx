// Line icons from the EmoSense mockups (24×24 viewBox, currentColor stroke).
import type { ReactNode } from "react";

function Icon({ size = 18, width = 1.8, children }: { size?: number; width?: number; children: ReactNode }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={width} strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}

export const LogoIcon = () => (
  <Icon size={22}>
    <circle cx="12" cy="12" r="9" />
    <path d="M8.5 14.5c1 1.2 2.2 1.8 3.5 1.8s2.5-.6 3.5-1.8" />
    <path d="M9 9.5h.01M15 9.5h.01" />
  </Icon>
);
export const ChevronIcon = ({ size = 14 }: { size?: number }) => (
  <Icon size={size} width={2}>
    <path d="M6 9l6 6 6-6" />
  </Icon>
);
export const BellIcon = () => (
  <Icon size={17}>
    <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z" />
    <path d="M10 20a2 2 0 0 0 4 0" />
  </Icon>
);
export const PlusIcon = () => (
  <Icon size={16} width={2}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);
export const SearchIcon = () => (
  <Icon size={15} width={2}>
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-3.5-3.5" />
  </Icon>
);
export const GearIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </Icon>
);
export const AlertIcon = () => (
  <Icon size={16} width={2}>
    <path d="M12 3l9.5 17h-19z" />
    <path d="M12 10v4M12 17h.01" />
  </Icon>
);
export const CameraIcon = ({ size = 32 }: { size?: number }) => (
  <Icon size={size} width={1.6}>
    <rect x="3" y="6" width="13" height="12" />
    <path d="M16 10l5-3v10l-5-3" />
  </Icon>
);
export const CameraOffIcon = () => (
  <Icon size={40} width={1.6}>
    <rect x="3" y="6" width="13" height="12" rx="2" />
    <path d="M16 10l5-3v10l-5-3" />
    <path d="M3 3l18 18" />
  </Icon>
);
export const UploadIcon = () => (
  <Icon size={28} width={1.6}>
    <path d="M12 16V4M7 9l5-5 5 5" />
    <path d="M4 16v4h16v-4" />
  </Icon>
);
export const PlayIcon = () => (
  <Icon size={16} width={2}>
    <path d="M7 5l12 7-12 7z" />
  </Icon>
);
export const PauseIcon = () => (
  <Icon size={16} width={2}>
    <path d="M8 5v14M16 5v14" />
  </Icon>
);
