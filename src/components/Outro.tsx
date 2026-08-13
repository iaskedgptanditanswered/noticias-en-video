/**
 * Outro — duration = readFrames + 150 frames
 *
 * All "reading" phases are relative to readFrames (default 300 = 10 s).
 * Fixed logo-exit phases always occupy the last 150 frames.
 *
 * InsAIghts: logo spins → exits up
 * H2NewsWeb: logo dissolves → bubbles rise
 */

import React from 'react';
import { Img, staticFile, useCurrentFrame } from 'remotion';
import type { Theme } from '../themes/types';
import type { NewsData } from '../data/types';

// ─── Helpers ──────────────────────────────────────────────────────────────────
function clamp(v: number, lo: number, hi: number) { return Math.min(hi, Math.max(lo, v)); }
function pg(f: number, s: number, e: number) { return clamp((f - s) / (e - s), 0, 1); }
function easeOut(t: number) { return 1 - (1 - t) ** 3; }
function easeIn(t: number)  { return t ** 3; }
function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }

// ─── Logo anchor constants ────────────────────────────────────────────────────
const LOGO_TOP_PADDING = 56;
const LOGO_READ_D  = 160;
const LOGO_READ_CY = LOGO_TOP_PADDING + LOGO_READ_D / 2;   // 136
const LOGO_END_D   = 320;
const LOGO_END_CY  = 540;

// ─── Bubble field (H2NewsWeb only) ────────────────────────────────────────────
const BUBBLE_PARAMS: ReadonlyArray<[number,number,number,number,number,number,number]> = [
  // dx, size, speed, sineAmp, sineFreq, delay, colorIdx
  [   0, 56,  9.5,  30, 0.08,  0, 0],
  [ -90, 36,  7.2,  20, 0.12,  3, 1],
  [  70, 44,  8.8, -25, 0.10,  1, 2],
  [ -50, 28, 11.0,  15, 0.15,  5, 3],
  [ 110, 40,  7.5,  35, 0.09,  2, 4],
  [-130, 32,  9.0, -20, 0.11,  4, 2],
  [  30, 64,  8.0,  10, 0.07,  0, 1],
  [ -70, 24, 12.5, -30, 0.14,  6, 3],
  [  90, 36,  8.5,  25, 0.09,  3, 2],
  [ -20, 48,  7.8, -15, 0.13,  1, 4],
  [ 150, 20, 10.5,  18, 0.16,  7, 0],
  [-160, 28,  9.2, -22, 0.11,  2, 2],
  [  60, 40,  8.3,  28, 0.08,  5, 1],
  [ -40, 52,  7.0, -12, 0.12,  0, 3],
  [ 120, 32, 11.8,  20, 0.15,  4, 2],
  [-100, 44,  8.7, -28, 0.09,  3, 1],
  [  10, 36,  9.8,  22, 0.13,  6, 4],
  [ -80, 60,  7.5,  -8, 0.07,  1, 2],
  [ 140, 24, 10.2,  15, 0.14,  2, 3],
  [ -30, 40,  8.4,  32, 0.10,  7, 0],
  [  50, 28, 12.0, -20, 0.16,  4, 2],
  [-110, 36,  9.1,  18, 0.11,  3, 1],
  [  80, 48,  7.9, -25, 0.08,  5, 4],
  [ -60, 20, 13.0,  12, 0.17,  8, 3],
  [  20, 44,  8.1, -18, 0.09,  1, 1],
  // ─── 2x Bubble Density additions ───
  [ -45, 42,  8.2, -22, 0.11,  9, 1],
  [  55, 34,  9.0,  18, 0.13, 11, 2],
  [-115, 26, 11.5, -15, 0.16, 14, 3],
  [  95, 30,  7.8,  30, 0.08, 10, 4],
  [ -15, 50,  8.6, -10, 0.09, 12, 0],
  [ 135, 22, 10.2,  22, 0.14, 15, 2],
  [-145, 38,  9.4, -26, 0.12, 11, 1],
  [  45, 58,  7.6,  12, 0.07,  8, 3],
  [ -85, 30, 10.8, -32, 0.15, 13, 4],
  [ 105, 46,  8.2,  18, 0.10,  9, 2],
  [ -35, 34,  9.6, -14, 0.11, 16, 1],
  [  75, 42,  8.0,  24, 0.09, 10, 0],
  [-125, 54,  7.2, -18, 0.08, 12, 3],
  [  25, 28, 12.2,  16, 0.17, 18, 4],
  [ -65, 36,  8.8, -28, 0.13, 15, 2],
  [ 115, 50,  7.9,  34, 0.09, 11, 1],
  [ -95, 24, 11.0, -12, 0.14, 17, 3],
  [  35, 40,  9.2,  20, 0.10, 13, 0],
  [ -75, 48,  8.4, -16, 0.12, 14, 2],
  [ 125, 32, 10.0,  28, 0.15, 19, 4],
  [ -55, 60,  7.0, -20, 0.07,  8, 1],
  [  85, 28, 11.8,  14, 0.16, 21, 3],
  [-135, 44,  8.5, -30, 0.11, 16, 2],
  [  65, 32,  9.5,  26, 0.13, 18, 0],
  [ -25, 52,  7.5, -10, 0.08, 12, 4],
];

const BubbleField: React.FC<{ theme: Theme; frame: number; bubbleStart: number; totalFrames: number }> = ({
  theme, frame, bubbleStart, totalFrames,
}) => {
  const globalFadeStart = totalFrames - 10;
  const globalAlpha = frame < globalFadeStart
    ? 1
    : 1 - pg(frame, globalFadeStart, totalFrames);

  const COLORS = [
    theme.primary,
    theme.accent,
    theme.primary + 'AA',
    theme.accent + 'AA',
    'rgba(255, 255, 255, 0.6)'
  ];

  return (
    <>
      {BUBBLE_PARAMS.map(([dx, size, speed, sineAmp, sineFreq, delay, colorIdx], i) => {
        const t = Math.max(0, frame - bubbleStart - delay);
        if (t <= 0) return null;

        const cy = LOGO_END_CY - t * speed;
        if (cy < -size) return null;

        const cx = 540 + dx + Math.sin(t * sineFreq) * sineAmp;
        const fadeIn  = easeOut(pg(t, 0, 15));
        const fadeOut = cy < 80 ? Math.max(0, cy / 80) : 1;

        const isWhiteBubble = colorIdx === 4;
        const bgGradient = isWhiteBubble
          ? `radial-gradient(circle at 30% 30%, rgba(255, 255, 255, 0.9) 0%, rgba(255, 255, 255, 0.4) 50%, rgba(255, 255, 255, 0.1) 100%)`
          : `radial-gradient(circle at 30% 30%, rgba(255, 255, 255, 0.6) 0%, ${COLORS[colorIdx]} 50%, rgba(0, 0, 0, 0.15) 100%)`;

        return (
          <div key={i} style={{
            position: 'absolute',
            width: size, height: size,
            borderRadius: '50%',
            background: bgGradient,
            left: cx - size / 2,
            top:  cy - size / 2,
            opacity: fadeIn * fadeOut * globalAlpha,
            boxShadow: isWhiteBubble ? 'none' : 'inset -2px -2px 6px rgba(0,0,0,0.1), 0 2px 10px rgba(0,0,0,0.06)',
          }} />
        );
      })}
    </>
  );
};

// ─── Component ────────────────────────────────────────────────────────────────
interface OutroProps {
  theme: Theme;
  data: NewsData;
  /** Frames the cards stay visible before the logo animation begins. Default 300 (10 s). */
  readFrames?: number;
}

export const Outro: React.FC<OutroProps> = ({ theme, data, readFrames = 300 }) => {
  const frame = useCurrentFrame();
  const isH2  = theme.id === 'h2newsweb';

  // ── Phase offsets (all relative to readFrames) ────────────────────────────
  const CARDS_FADE_END  = readFrames + 45;   // cards fully gone
  const LOGO_MOVE_START = readFrames + 20;
  const LOGO_MOVE_END   = readFrames + 85;   // logo at canvas centre
  const EXIT_START      = readFrames + 85;   // spin or bubbles begin
  const EXIT_END        = readFrames + 150;  // total outro duration
  const CTA_START       = readFrames + 45;
  const CTA_FADE_END    = readFrames + 65;

  // ── Fade-ins ──────────────────────────────────────────────────────────────
  const logoIn    = easeOut(pg(frame, 0, 25));
  const patternIn = easeOut(pg(frame, 10, 35));
  const debateIn  = easeOut(pg(frame, 20, 45));

  // ── Cards fade out ────────────────────────────────────────────────────────
  const cardOut      = easeOut(pg(frame, readFrames, CARDS_FADE_END));
  const patternAlpha = frame < readFrames ? patternIn : 1 - cardOut;
  const debateAlpha  = frame < readFrames ? debateIn  : 1 - cardOut;

  // ── Logo: move to canvas centre + grow ────────────────────────────────────
  const moveProg = easeOut(pg(frame, LOGO_MOVE_START, LOGO_MOVE_END));
  const logoCY   = lerp(LOGO_READ_CY, LOGO_END_CY, moveProg);
  const logoDiam = lerp(LOGO_READ_D,  LOGO_END_D,  moveProg);
  const glowR    = lerp(24, 80, moveProg);

  // ── InsAIghts: spin + exit up ─────────────────────────────────────────────
  const spinT   = clamp(frame - EXIT_START, 0, 60);
  const spinDeg = 6 * spinT + 0.6 * spinT * spinT;
  const insExitStart = EXIT_END - 20;
  const exitY = !isH2 && frame >= insExitStart
    ? -easeIn(pg(frame, insExitStart, EXIT_END)) * 1600
    : 0;

  // ── H2NewsWeb: logo dissolves when bubbles start ──────────────────────────
  const logoFadeOut = isH2 && frame >= EXIT_START
    ? 1 - easeOut(pg(frame, EXIT_START, EXIT_START + 35))
    : 1;

  const logoOpacity = logoIn * logoFadeOut;

  // ── CTA ───────────────────────────────────────────────────────────────────
  const ctaAlpha =
    frame < CTA_START  ? 0 :
    frame < CTA_FADE_END ? pg(frame, CTA_START, CTA_FADE_END) :
    1;

  return (
    <div style={{
      width: 1080, height: 1080,
      position: 'relative', overflow: 'hidden',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      background: `linear-gradient(145deg, ${theme.secondary} 0%, ${theme.primary}CC 100%)`,
    }}>

      {/* ── Bubbles (H2NewsWeb only) ── */}
      {isH2 && frame >= EXIT_START && (
        <BubbleField theme={theme} frame={frame} bubbleStart={EXIT_START} totalFrames={EXIT_END} />
      )}

      {/* ── Logo ── */}
      <div style={{
        position: 'absolute',
        left: '50%',
        top: logoCY - logoDiam / 2 + exitY,
        width: logoDiam,
        height: logoDiam,
        transform: `translateX(-50%) rotate(${isH2 ? 0 : spinDeg}deg)`,
        opacity: logoOpacity,
      }}>
        <div style={{
          width: '100%', height: '100%',
          borderRadius: '50%',
          backgroundColor: 'white',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: `0 0 ${glowR}px ${theme.accent}90`,
          padding: isH2 ? '0%' : '15%', boxSizing: 'border-box',
        }}>
          <Img
            src={staticFile(theme.logoFile)}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'contain',
              transform: isH2 ? 'scale(1.28)' : 'none',
            }}
          />
        </div>
      </div>

      {/* ── Cards layer ── */}
      <div style={{
        position: 'absolute',
        top: LOGO_TOP_PADDING + LOGO_READ_D + 40,
        bottom: 100,
        left: 52, right: 52,
        display: 'flex', flexDirection: 'column',
        justifyContent: 'center', gap: 28,
      }}>
        <div style={{
          backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 18,
          padding: '22px 28px', borderLeft: '5px solid white',
          opacity: patternAlpha, boxSizing: 'border-box',
        }}>
          <div style={{ fontSize: 18, color: 'white', fontWeight: 800, letterSpacing: 4, textTransform: 'uppercase', marginBottom: 12, opacity: 0.75 }}>
            💡 El patrón de hoy
          </div>
          <div style={{ fontSize: 29, color: 'white', lineHeight: 1.65, fontWeight: 500 }}>
            {data.pattern}
          </div>
        </div>

        <div style={{
          backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 18,
          padding: '22px 28px', borderLeft: `5px solid ${theme.accent}`,
          opacity: debateAlpha, boxSizing: 'border-box',
        }}>
          <div style={{ fontSize: 18, color: theme.accent, fontWeight: 800, letterSpacing: 4, textTransform: 'uppercase', marginBottom: 12 }}>
            🗣️ Debate
          </div>
          <div style={{ fontSize: 29, color: 'white', lineHeight: 1.65, fontStyle: 'italic' }}>
            "{data.debate}"
          </div>
        </div>
      </div>

      {/* ── CTA ── */}
      <div style={{
        position: 'absolute', bottom: 64, left: 0, right: 0,
        textAlign: 'center', opacity: ctaAlpha,
        fontSize: 31, color: 'white', fontWeight: 800,
      }}>
        👆 {theme.ctaText}
      </div>

    </div>
  );
};
