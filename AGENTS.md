# GLOBAL DESIGN & ENGINEERING RULES (APPLY TO ALL CHATS)

## 1. UI/UX & Visual Design Standards
- **Zero "AI Slop" Aesthetics:** Never use generic neon purple/cyan gradients, cluttered borders, or boxy default templates. Default to clean Apple macOS / editorial minimalism: deep neutral backgrounds (`#0D0D0F`), subtle translucent surfaces (`rgba(28, 28, 30, 0.72)` + `backdrop-filter: blur(32px)`), `1px solid rgba(255, 255, 255, 0.08)` borders, and one intentional accent color.
- **Typography & Spacing:** Use an 8px spacing system, fluid `clamp()` sizing for hero text, tight letter-spacing (`-0.025em` to `-0.04em`) on headings, `font-variant-numeric: tabular-nums` for timers/codes/metrics, and multi-script font fallbacks (`'SF Pro Display', 'Inter', 'Noto Sans Devanagari', 'Noto Sans Gurmukhi', sans-serif`).
- **Motion & Tactile Feel:** Animate only GPU-composited properties (`transform`, `opacity`, `filter`). Use spring easing (`cubic-bezier(0.22, 1.25, 0.36, 1)`) for state transitions, `scale(0.95)` press feedback on interactive buttons, and dark frosted skeleton loaders instead of plain spinners.
- **Multi-Language Safety:** Always use Unicode-aware regex (`\p{L}`, `\p{N}` with `/gu`) when parsing text so Hindi, Punjabi, and non-Latin scripts never break.

## 2. Developer & Code Safety Rules
- **Non-Destructive Edits:** When asked to redesign UI or add a visual feature, NEVER alter, delete, or break existing audio playback, API fetching, WebSocket sync, IPC bridges, or backend logic unless explicitly instructed.
- **Complete, Production-Ready Code:** Never leave `// TODO`, placeholder data, or truncated snippets. Handle loading, empty, and error states cleanly.
- **Resource & Lifecycle Hygiene:** Always clean up `useEffect` listeners, timers, `requestAnimationFrame` loops, Three.js geometries/materials, and Electron IPC listeners on unmount.
- **Root-Cause First:** When debugging, trace the exact failing file, line, and runtime state first—never guess or apply blind workarounds.
