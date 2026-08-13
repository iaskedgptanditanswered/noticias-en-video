/**
 * Overview — 2 s intro screen.
 * Imports layout constants from NewsSegment so positions match exactly
 * at the frame-60 cut.
 */

import React from 'react';
import { spring, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import type { Theme } from '../themes/types';
import type { NewsItem } from '../data/types';
import { PV, HEADER_H, PH, PILL_H, PILL_GAP, SegmentHeader } from './NewsSegment';

interface OverviewProps {
  theme: Theme;
  date: string;
  news: [NewsItem, NewsItem, NewsItem];
}

const NUMS = ['01', '02', '03'];

export const Overview: React.FC<OverviewProps> = ({ theme, date, news }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <div style={{
      width: 1080, height: 1080,
      backgroundColor: theme.background,
      position: 'relative', overflow: 'hidden',
      fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
      {/* Header — same as NewsSegment */}
      <SegmentHeader theme={theme} date={date} />

      {/* Pills Container — Flexbox stack matching NewsSegment */}
      <div style={{
        position: 'absolute',
        top: PV + HEADER_H,
        left: PH, right: PH,
        display: 'flex',
        flexDirection: 'column',
        gap: PILL_GAP,
      }}>
        {news.map((item, i) => {
          const delay = i * 8;
          const appear = spring({
            frame: frame - delay,
            fps,
            config: { damping: 18 },
            durationInFrames: 25,
          });
          return (
            <div key={i} style={{
              opacity: appear,
              transform: `translateY(${interpolate(appear, [0, 1], [28, 0])}px)`,
            }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 22,
                backgroundColor: 'white',
                border: '1.5px solid #E5E7EB',
                borderRadius: 14,
                padding: '20px 30px',
                minHeight: PILL_H, boxSizing: 'border-box',
                boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
              }}>
                <span style={{ fontSize: 50, fontWeight: 900, color: theme.primary, minWidth: 56, lineHeight: 1 }}>
                  {NUMS[i]}
                </span>
                <span style={{ fontSize: 31, fontWeight: 700, color: theme.text, lineHeight: 1.25, flex: 1 }}>
                  {item.title}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
