// Small line icons for navigation. Original drawings (some shapes adapted from
// the ISC-licensed Lucide set); filled when active, as Apple's tab bars do.

export type IconName = "home" | "trips" | "giving" | "people" | "settings" | "person" | "bell";

export function Icon({ name, active = false, size = 24 }: { name: IconName; active?: boolean; size?: number }) {
  const fill = active ? "currentColor" : "none";
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <svg aria-hidden width={size} height={size} viewBox="0 0 24 24" {...common}>
      {name === "home" && <path fill={fill} d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" />}
      {name === "trips" && (
        <path
          fill={fill}
          d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"
        />
      )}
      {name === "giving" && <path fill={fill} d="M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7z" />}
      {name === "people" && (
        <>
          <circle cx="9" cy="7" r="4" fill={fill} />
          <path d="M2 21v-1.5A4.5 4.5 0 0 1 6.5 15h5a4.5 4.5 0 0 1 4.5 4.5V21" fill={fill} />
          <path d="M16 3.1a4 4 0 0 1 0 7.8M22 21v-1.5a4.5 4.5 0 0 0-3-4.2" />
        </>
      )}
      {name === "settings" && (
        <>
          <path
            strokeWidth={active ? 2.2 : 1.8}
            d="M12.2 2h-.4a2 2 0 0 0-2 2v.2a2 2 0 0 1-1 1.7l-.4.3a2 2 0 0 1-2 0l-.2-.1a2 2 0 0 0-2.7.7l-.2.4a2 2 0 0 0 .7 2.7l.2.1a2 2 0 0 1 1 1.7v.5a2 2 0 0 1-1 1.7l-.2.1a2 2 0 0 0-.7 2.7l.2.4a2 2 0 0 0 2.7.7l.2-.1a2 2 0 0 1 2 0l.4.3a2 2 0 0 1 1 1.7v.2a2 2 0 0 0 2 2h.4a2 2 0 0 0 2-2v-.2a2 2 0 0 1 1-1.7l.4-.3a2 2 0 0 1 2 0l.2.1a2 2 0 0 0 2.7-.7l.2-.4a2 2 0 0 0-.7-2.7l-.2-.1a2 2 0 0 1-1-1.7v-.5a2 2 0 0 1 1-1.7l.2-.1a2 2 0 0 0 .7-2.7l-.2-.4a2 2 0 0 0-2.7-.7l-.2.1a2 2 0 0 1-2 0l-.4-.3a2 2 0 0 1-1-1.7V4a2 2 0 0 0-2-2z"
          />
          <circle cx="12" cy="12" r="3" strokeWidth={active ? 2.2 : 1.8} />
        </>
      )}
      {name === "person" && (
        <>
          <circle cx="12" cy="8" r="4" fill={fill} />
          <path d="M4 21a8 8 0 0 1 16 0z" fill={fill} />
        </>
      )}
      {name === "bell" && (
        <>
          <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" fill={fill} />
          <path d="M10.3 21a1.9 1.9 0 0 0 3.4 0" />
        </>
      )}
    </svg>
  );
}
