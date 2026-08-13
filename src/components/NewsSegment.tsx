/**
 * NewsSegment — 7 s per news item (210 frames @ 30 fps)
 *
 * Timeline:
 *   0–10   Pill N highlights (border + tint)
 *   8–28   Others slide RIGHT off-screen           (easeIn)
 *  22–42   Content drawer opens (slides DOWN)      (easeOut)
 *  22–42   Pill N transitions to solid             (easeOut)
 *  42–175  Reading phase (static)
 * 175–195  Content drawer closes (slides UP)       (easeIn)
 * 188–210  Others slide LEFT back into place       (easeOut)
 */

import React from 'react';
import { Img, staticFile, useCurrentFrame } from 'remotion';
import type { Theme } from '../themes/types';
import type { NewsItem } from '../data/types';

// ─── Layout constants (1080 × 1080) ────────────────────────────────────────
export const PH = 48;   // horizontal padding
export const PV = 40;   // vertical padding
export const PILL_H = 90;
export const PILL_GAP = 22;

// Header (absolute-positioned, starts at PV from top of screen):
//   logo row     : 120 px  (logo 100 px, centred)     ← bigger logo
//   gap A        : 20  px  (above divider)
//   divider      : 3   px
//   gap B        : 40  px  (below divider)
//   label row    : 22  px  (font-size 22, line-height 1)
//   implicit gap : 54  px  (to first pill — comes from absolute positioning)
//   TOTAL        : 259 px
//
// This places pill 1 (second news) at y≈453, giving more canvas to content.
export const HEADER_H = 259;

// Logo sizes exported so the iris transition can originate from the correct point
export const LOGO_ROW_H = 120;   // height of the logo row div
export const LOGO_IMG_H = 100;   // visible logo image height
// Logo circle centre Y during news segments = PV + LOGO_ROW_H / 2
export const LOGO_CENTER_Y = PV + LOGO_ROW_H / 2;  // 100

export const PILL_Y = [
  PV + HEADER_H,                              // 353
  PV + HEADER_H + PILL_H + PILL_GAP,          // 465
  PV + HEADER_H + 2 * (PILL_H + PILL_GAP),    // 577
] as const;

const PILL_BOTTOM = PILL_Y.map((y) => y + PILL_H);     // [443, 555, 667]
const CONTENT_TOP = PILL_BOTTOM.map((b) => b + 16);    // [459, 571, 683]
const CONTENT_AVAIL = CONTENT_TOP.map((ct) => 1080 - ct - PV); // [581, 469, 357]

// ─── Animation timing ────────────────────────────────────────────────────────
// Fixed entry/exit phases (frames): entry=42f, exit=35f. Reading fills the middle.
function calcT(segFrames: number) {
  return {
    EXIT_START:      8,
    EXIT_END:        24,
    SLIDE_UP_START:  24,
    SLIDE_UP_END:    40,
    DRAWER_IN_START: 40,
    DRAWER_IN_END:   56,
    READ_END:        segFrames - 50,
    DRAWER_OUT_END:  segFrames - 34,
    SLIDE_DOWN_END:  segFrames - 18,
    RETURN_START:    segFrames - 18,
    RETURN_END:      segFrames,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function clamp(v: number, lo: number, hi: number) { return Math.min(hi, Math.max(lo, v)); }
function prog(f: number, s: number, e: number) { return clamp((f - s) / (e - s), 0, 1); }
function easeIn(t: number) { return t * t * t; }
function easeOut(t: number) { return 1 - easeIn(1 - t); }

const NUMS = ['01', '02', '03'];

// ─── Shared Header ────────────────────────────────────────────────────────────
// Exported so Overview and Outro can reuse the identical markup.
export const SegmentHeader: React.FC<{ theme: Theme; date: string }> = ({ theme, date }) => (
  <div style={{ position: 'absolute', top: PV, left: PH, right: PH }}>
    {/* Logo — centred, big */}
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: LOGO_ROW_H }}>
      <Img
        src={staticFile(theme.logoFile)}
        style={{
          height: LOGO_IMG_H,
          objectFit: 'contain',
          transform: theme.id === 'h2newsweb' ? 'scale(2.0)' : theme.id === 'insaights' ? 'scale(1.5)' : 'none',
        }} />
    </div>
    {/* Gap A */}
    <div style={{ height: 20 }} />
    {/* Brand-colour divider */}
    <div style={{ height: 3, backgroundColor: theme.primary, borderRadius: 2 }} />
    {/* Gap B */}
    <div style={{ height: 40 }} />
    {/* "NOTICIAS DE HOY · fecha" on one line */}
    <div style={{
      fontSize: 22,
      fontWeight: 700,
      color: theme.textLight,
      letterSpacing: 3,
      textTransform: 'uppercase',
      lineHeight: 1,
    }}>
      Noticias de hoy
      <span style={{
        marginLeft: 12,
        fontWeight: 400,
        letterSpacing: 0,
        textTransform: 'none',
        fontSize: 21,
      }}>
        · {date}
      </span>
    </div>
  </div>
);

// ─── Pill ─────────────────────────────────────────────────────────────────────
// Always renders at its natural size (PILL_H).
// For the active pill two layers crossfade; for inactive a single styled div.
interface PillProps {
  index: number;
  title: string;
  theme: Theme;
  isActive: boolean;
  solidState: number; // 0 = highlighted (border+tint), 1 = solid filled
}

const pillBase: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 22,
  borderRadius: 14, padding: '20px 30px',
  boxSizing: 'border-box',
};

const Pill: React.FC<PillProps> = ({ index, title, theme, isActive, solidState }) => {
  if (!isActive) {
    return (
      <div style={{
        ...pillBase,
        backgroundColor: 'white',
        border: '1.5px solid #E5E7EB',
        boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
      }}>
        <span style={{ fontSize: 50, fontWeight: 900, color: theme.primary, minWidth: 56, lineHeight: 1 }}>
          {NUMS[index]}
        </span>
        <span style={{ fontSize: 31, fontWeight: 700, color: theme.text, lineHeight: 1.25, flex: 1 }}>
          {title}
        </span>
      </div>
    );
  }

  // Active pill: crossfade between two layers (Layer 1 is relative to size the container)
  return (
    <div style={{ position: 'relative', borderRadius: 14, overflow: 'hidden' }}>
      {/* Layer 1 — highlighted (tint + border) - relative */}
      <div style={{
        ...pillBase,
        position: 'relative',
        backgroundColor: theme.primary + '18',
        border: `2.5px solid ${theme.primary}`,
        boxShadow: `0 6px 28px ${theme.primary}38`,
        opacity: 1 - solidState,
      }}>
        <span style={{ fontSize: 50, fontWeight: 900, color: theme.primary, minWidth: 56, lineHeight: 1 }}>
          {NUMS[index]}
        </span>
        <span style={{ fontSize: 31, fontWeight: 700, color: theme.text, lineHeight: 1.25, flex: 1 }}>
          {title}
        </span>
      </div>
      {/* Layer 2 — solid filled - absolute overlay */}
      <div style={{
        ...pillBase,
        position: 'absolute',
        inset: 0,
        backgroundColor: theme.primary,
        border: `2.5px solid ${theme.primary}`,
        boxShadow: `0 6px 28px ${theme.primary}55`,
        opacity: solidState,
      }}>
        <span style={{ fontSize: 50, fontWeight: 900, color: 'white', minWidth: 56, lineHeight: 1 }}>
          {NUMS[index]}
        </span>
        <span style={{ fontSize: 31, fontWeight: 700, color: 'white', lineHeight: 1.25, flex: 1 }}>
          {title}
        </span>
      </div>
    </div>
  );
};

// ─── Content (summary + bullets) ─────────────────────────────────────────────
const ContentView: React.FC<{ theme: Theme; news: NewsItem }> = ({ theme, news }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 22, paddingTop: 8 }}>
    {/* Summary */}
    <div style={{
      fontSize: 29,
      color: theme.text,
      lineHeight: 1.65,
      borderLeft: `4px solid ${theme.accent}`,
      paddingLeft: 18,
    }}>
      {news.summary}
    </div>

    {/* Divider */}
    <div style={{ height: 1, backgroundColor: '#E5E7EB' }} />

    {/* Bullets */}
    {news.bullets.map((b, i) => (
      <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
        <div style={{
          width: 32, height: 32, borderRadius: '50%',
          backgroundColor: theme.accent + '22',
          border: `2px solid ${theme.accent}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 21, color: theme.accent, flexShrink: 0, marginTop: 3,
        }}>✓</div>
        <div style={{ fontSize: 28, color: theme.text, lineHeight: 1.5, fontWeight: 500 }}>
          {b}
        </div>
      </div>
    ))}
  </div>
);

// ─── Main component ───────────────────────────────────────────────────────────
interface NewsSegmentProps {
  theme: Theme;
  news: [NewsItem, NewsItem, NewsItem];
  activeIndex: number;
  date: string;
  segFrames?: number;  // total segment duration in frames (default 210)
}

export const NewsSegment: React.FC<NewsSegmentProps> = ({ theme, news, activeIndex, date, segFrames = 210 }) => {
  const frame = useCurrentFrame(); // local frame via <Sequence>
  const T = calcT(segFrames);

  // ── Others: exit RIGHT, return from RIGHT ────────────────────────────────
  let othersX: number;
  if (frame < T.EXIT_START) {
    othersX = 0;
  } else if (frame < T.EXIT_END) {
    othersX = easeIn(prog(frame, T.EXIT_START, T.EXIT_END)) * 1200;
  } else if (frame < T.RETURN_START) {
    othersX = 1200;
  } else {
    othersX = (1 - easeOut(prog(frame, T.RETURN_START, T.RETURN_END))) * 1200;
  }

  // ── Active pill Y-animation (slide to first pill position PILL_Y[0]) ─────
  let yProg: number;
  if (frame < T.SLIDE_UP_START) {
    yProg = 0;
  } else if (frame < T.SLIDE_UP_END) {
    yProg = easeOut(prog(frame, T.SLIDE_UP_START, T.SLIDE_UP_END));
  } else if (frame < T.READ_END) {
    yProg = 1;
  } else if (frame < T.SLIDE_DOWN_END) {
    yProg = 1 - easeIn(prog(frame, T.READ_END, T.SLIDE_DOWN_END));
  } else {
    yProg = 0;
  }

  // ── Active pill: highlighted → solid ────────────────────────────────────
  let solidState: number;
  if (frame < T.DRAWER_IN_START) {
    solidState = 0;
  } else if (frame < T.DRAWER_IN_END) {
    solidState = easeOut(prog(frame, T.DRAWER_IN_START, T.DRAWER_IN_END));
  } else if (frame < T.READ_END) {
    solidState = 1;
  } else {
    solidState = 1 - easeIn(prog(frame, T.READ_END, T.DRAWER_OUT_END));
  }

  // ── Content drawer: slides down to reveal, up to hide ───────────────────
  let drawerProg: number;
  if (frame < T.DRAWER_IN_START) {
    drawerProg = 0;
  } else if (frame < T.DRAWER_IN_END) {
    drawerProg = easeOut(prog(frame, T.DRAWER_IN_START, T.DRAWER_IN_END));
  } else if (frame < T.READ_END) {
    drawerProg = 1;
  } else {
    drawerProg = 1 - easeIn(prog(frame, T.READ_END, T.DRAWER_OUT_END));
  }

  return (
    <div style={{
      width: 1080, height: 1080,
      backgroundColor: theme.background,
      position: 'relative', overflow: 'hidden',
      fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
      <SegmentHeader theme={theme} date={date} />

      {/* Pills Container */}
      <div style={{
        position: 'absolute',
        top: PV + HEADER_H,
        left: PH, right: PH,
        display: 'flex',
        flexDirection: 'column',
      }}>
        {([0, 1, 2] as const).map((i) => {
          const isActive = i === activeIndex;
          const collapse = isActive ? 1 : 1 - yProg;

          return (
            <div
              key={i}
              style={{
                opacity: collapse,
                maxHeight: isActive ? '1000px' : `${collapse * 250}px`,
                marginBottom: isActive ? 0 : `${collapse * PILL_GAP}px`,
                transform: `translateX(${isActive ? 0 : othersX}px)`,
                overflow: 'hidden',
              }}
            >
              <Pill
                index={i}
                title={news[i].title}
                theme={theme}
                isActive={isActive}
                solidState={isActive ? solidState : 0}
              />

              {isActive && (
                <div style={{
                  height: drawerProg * 700,
                  overflow: 'hidden',
                  marginTop: 16,
                }}>
                  <div style={{ transform: `translateY(${(1 - drawerProg) * -700}px)` }}>
                    <ContentView theme={theme} news={news[activeIndex]} />
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
