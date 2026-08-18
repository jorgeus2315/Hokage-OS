interface IconProps {
  className?: string;
  style?: React.CSSProperties;
}

const base = {
  viewBox: '0 0 24 24',
  width: 20,
  height: 20,
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.4,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

// ── Edificios (glifos únicos, sin emojis) ──

export function IconTower({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M12 2 3 7l9 4 9-4-9-5Z" />
      <path d="M5 10.5V17l7 4 7-4v-6.5" />
      <path d="M12 11v10" />
      <path d="M8.5 8.5 12 11l3.5-2.5" />
    </svg>
  );
}

export function IconLab({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M9 2h6" />
      <path d="M10 2v6.2L4.8 18.4A2 2 0 0 0 6.6 21h10.8a2 2 0 0 0 1.8-2.6L14 8.2V2" />
      <path d="M7.5 15h9" />
      <circle cx="10.5" cy="18" r="0.6" fill="currentColor" stroke="none" />
      <circle cx="14" cy="17" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconStudio({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M4 20 17 7" />
      <path d="M14 4l6 6" />
      <path d="M13.5 7.5l3 3" />
      <path d="M4 20l1.2-4.4L9.4 17 4 20Z" />
    </svg>
  );
}

export function IconShop({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M3 9l1.5-5h15L21 9" />
      <path d="M4 9v11h16V9" />
      <path d="M9 20v-6h6v6" />
      <path d="M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0" />
    </svg>
  );
}

export function IconBank({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M3 10 12 4l9 6" />
      <path d="M4 10h16v2H4z" />
      <path d="M6 12v7M11 12v7M13 12v7M18 12v7" />
      <path d="M3 21h18" />
    </svg>
  );
}

export function IconWorkshop({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M14.5 3.5a4 4 0 0 0-5 5L3 15v3l3 3h3l6.5-6.5a4 4 0 0 0 5-5l-3 3-2.5-.5-.5-2.5 3-3Z" />
    </svg>
  );
}

export function IconTerminal({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="m7 9 4 3-4 3" />
      <path d="M13 15h4" />
    </svg>
  );
}

// ── Navegación ──

export function IconMap({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Z" />
      <path d="M9 4v14M15 6v14" />
    </svg>
  );
}

export function IconComms({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M4 5h16v11H8l-4 4V5Z" />
      <path d="M8 9h8M8 12h5" />
    </svg>
  );
}

export function IconMissions({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="12" cy="9" r="6" />
      <path d="M9 14.5 7 22l5-3 5 3-2-7.5" />
    </svg>
  );
}

export function IconAlert({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M12 3 2 20h20L12 3Z" />
      <path d="M12 10v4" />
      <circle cx="12" cy="17" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconCrew({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="8.5" cy="8" r="3" />
      <circle cx="16.5" cy="9" r="2.4" />
      <path d="M3 20v-1.5A4.5 4.5 0 0 1 7.5 14h2A4.5 4.5 0 0 1 14 18.5V20" />
      <path d="M15 14.5a3.8 3.8 0 0 1 6 3.1V20" />
    </svg>
  );
}

export function IconVenture({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <polygon points="12,2 22,7 22,17 12,22 2,17 2,7" />
      <path d="M12 2v20M2 7l10 5 10-5" />
    </svg>
  );
}

// ── Secciones de edificio ──

export function IconChat({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M4 5h16v11H9l-5 4V5Z" />
    </svg>
  );
}

export function IconFeed({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M4 4v16" />
      <path d="M4 4a10 10 0 0 1 10 10" />
      <path d="M4 10a6 6 0 0 1 6 6" />
      <circle cx="5" cy="19" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconStats({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M4 20V10M11 20V4M18 20v-7" />
      <path d="M2 20h20" />
    </svg>
  );
}

export function IconPipeline({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="5" cy="6" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="19" cy="18" r="2" />
      <path d="M7 6h5.5M12 8v2M14 12h3.5" />
    </svg>
  );
}

export function IconOutput({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M6 3h9l3 3v15H6V3Z" />
      <path d="M15 3v3h3" />
      <path d="M9 12h6M9 15.5h6M9 8.5h3" />
    </svg>
  );
}

// ── Estados / acciones ──

export function IconCheck({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="m8 12.5 2.5 2.5L16 9.5" />
    </svg>
  );
}

export function IconPlay({ className }: IconProps) {
  return (
    <svg {...base} className={className} fill="currentColor" stroke="none">
      <path d="M7 5v14l12-7L7 5Z" />
    </svg>
  );
}

export function IconChevron({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="m9 5 7 7-7 7" />
    </svg>
  );
}

export function IconBack({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="m15 5-7 7 7 7" />
    </svg>
  );
}

export function IconMedal({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="12" cy="14" r="6" />
      <path d="M9 3h6l-2 6h-2L9 3Z" />
      <path d="M10.5 12.5 12 11l1.5 1.5-.6 2-1-.5-1 .5-.4-2Z" fill="currentColor" stroke="none" />
    </svg>
  );
}

const GLYPHS: Record<string, (p: IconProps) => JSX.Element> = {
  tower: IconTower,
  lab: IconLab,
  studio: IconStudio,
  shop: IconShop,
  bank: IconBank,
  workshop: IconWorkshop,
  terminal: IconTerminal,
};

export function IconTarget({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function BuildingGlyph({ glyph, className }: { glyph: string; className?: string }) {
  const Cmp = GLYPHS[glyph] || IconTower;
  return <Cmp className={className} />;
}

export function IconConfig({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={20} height={20} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className={className}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

const SECTION_ICONS: Record<string, (p: IconProps) => JSX.Element> = {
  chat: IconChat,
  feed: IconFeed,
  stats: IconStats,
  pipeline: IconPipeline,
  outputs: IconOutput,
  terminal: IconTerminal,
  alerts: IconAlert,
  config: IconConfig,
  system: IconWorkshop,
  finance: IconBank,
  trends: IconOutput,
  gallery: IconStudio,
};

export function SectionIcon({ section, className }: { section: string; className?: string }) {
  const Cmp = SECTION_ICONS[section] || IconChat;
  return <Cmp className={className} />;
}

export function IconMemory({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M4 4v16" />
      <path d="M4 4h16" />
      <path d="M4 20h16" />
      <path d="M12 8v8" />
      <path d="M8 12h8" />
    </svg>
  );
}

export function IconTool({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
  );
}

export function IconSend({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M4 12 20 4l-6 16-3-7-7-1Z" />
      <path d="m11 13 6-9" />
    </svg>
  );
}
