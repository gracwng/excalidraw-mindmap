/** Icons drawn in the same 1.25px-stroke, rounded style Excalidraw uses (Tabler-like). */
import type { ReactNode } from "react";

function Icon({ children, size = 16 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const PlusIcon = () => (
  <Icon>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);
export const SearchIcon = () => (
  <Icon>
    <circle cx="10" cy="10" r="7" />
    <path d="m21 21-6-6" />
  </Icon>
);
export const UploadIcon = () => (
  <Icon>
    <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2M7 9l5-5 5 5M12 4v12" />
  </Icon>
);
export const DownloadIcon = () => (
  <Icon>
    <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2M7 11l5 5 5-5M12 4v12" />
  </Icon>
);
export const ImageIcon = () => (
  <Icon>
    <path d="M15 8h.01" />
    <rect x="4" y="4" width="16" height="16" rx="3" />
    <path d="m4 15 4-4a3 5 0 0 1 3 0l5 5" />
    <path d="m14 14 1-1a3 5 0 0 1 3 0l2 2" />
  </Icon>
);
export const PencilIcon = () => (
  <Icon>
    <path d="M4 20h4L18.5 9.5a2.83 2.83 0 0 0-4-4L4 16v4M13.5 6.5l4 4" />
  </Icon>
);
export const CopyIcon = () => (
  <Icon>
    <rect x="8" y="8" width="12" height="12" rx="2" />
    <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
  </Icon>
);
export const TrashIcon = () => (
  <Icon>
    <path d="M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3" />
  </Icon>
);
export const OpenIcon = () => (
  <Icon>
    <path d="M12 6H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6M11 13l9-9M15 4h5v5" />
  </Icon>
);
export const ArrowLeftIcon = () => (
  <Icon>
    <path d="M5 12h14M5 12l6 6M5 12l6-6" />
  </Icon>
);
export const SunIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="4" />
    <path d="M3 12h1M12 3v1M20 12h1M12 20v1M5.6 5.6l.7.7M18.4 5.6l-.7.7M17.7 17.7l.7.7M6.3 17.7l-.7.7" />
  </Icon>
);
export const MoonIcon = () => (
  <Icon>
    <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z" />
  </Icon>
);
export const CheckIcon = () => (
  <Icon size={14}>
    <path d="m5 12 5 5L20 7" />
  </Icon>
);
export const AlertIcon = () => (
  <Icon size={14}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 8v4M12 16h.01" />
  </Icon>
);
export const GridIcon = () => (
  <Icon>
    <rect x="4" y="4" width="6" height="6" rx="1" />
    <rect x="14" y="4" width="6" height="6" rx="1" />
    <rect x="4" y="14" width="6" height="6" rx="1" />
    <rect x="14" y="14" width="6" height="6" rx="1" />
  </Icon>
);
export const CloudIcon = () => (
  <Icon>
    <path d="M7 18a4.6 4.4 0 0 1 0-9 5 4.5 0 0 1 11 2h1a3.5 3.5 0 0 1 0 7z" />
  </Icon>
);
export const CloudCheckIcon = () => (
  <Icon>
    <path d="M11 18.004H6.657C4.085 18 2 15.993 2 13.517s2.085-4.482 4.657-4.482c.393-1.762 1.794-3.2 3.675-3.773 1.88-.572 3.956-.193 5.444 1 1.488 1.19 2.162 3.007 1.77 4.769h.99c1.388 0 2.585.82 3.138 2.007" />
    <path d="m15 19 2 2 4-4" />
  </Icon>
);
export const CloudOffIcon = () => (
  <Icon>
    <path d="M9.58 5.548c.24-.11.492-.207.752-.286 1.88-.572 3.956-.193 5.444 1 1.488 1.19 2.162 3.007 1.77 4.769h.99c1.913 0 3.464 1.56 3.464 3.486 0 .957-.383 1.824-1.003 2.454M18 18H6.657C4.085 18 2 15.993 2 13.517s2.085-4.482 4.657-4.482c.13-.582.37-1.128.7-1.62M3 3l18 18" />
  </Icon>
);
export const RefreshIcon = () => (
  <Icon>
    <path d="M20 11A8.1 8.1 0 0 0 4.5 9M4 5v4h4M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4" />
  </Icon>
);
export const LogoutIcon = () => (
  <Icon>
    <path d="M14 8V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2v-2M9 12h12l-3-3M18 15l3-3" />
  </Icon>
);
