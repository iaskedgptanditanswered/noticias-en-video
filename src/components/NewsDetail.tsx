import { Img, staticFile, spring, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import type { Theme } from '../themes/types';
import type { NewsItem } from '../data/types';

interface NewsDetailProps {
  theme: Theme;
  news: NewsItem;
  index: number;
}

export const NewsDetail: React.FC<NewsDetailProps> = ({ theme, news, index }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const headerProgress = spring({ frame, fps, config: { damping: 22 }, durationInFrames: 25 });
  const summaryProgress = spring({ frame: frame - 12, fps, config: { damping: 20 }, durationInFrames: 25 });

  const numbers = ['01', '02', '03'];

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        backgroundColor: theme.background,
        display: 'flex',
        flexDirection: 'column',
        padding: '50px 80px',
        boxSizing: 'border-box',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      {/* Noticia header — viene del zoom */}
      <div
        style={{
          backgroundColor: theme.primary,
          borderRadius: 20,
          padding: '30px 40px',
          marginBottom: 48,
          display: 'flex',
          alignItems: 'center',
          gap: 28,
          transform: `scale(${interpolate(headerProgress, [0, 1], [0.95, 1])})`,
          opacity: headerProgress,
        }}
      >
        <div style={{ fontSize: 76, fontWeight: 900, color: 'white', minWidth: 72, lineHeight: 1 }}>
          {numbers[index]}
        </div>
        <div style={{ fontSize: 48, fontWeight: 800, color: 'white', lineHeight: 1.25 }}>
          {news.title}
        </div>
      </div>

      {/* Summary */}
      <div
        style={{
          fontSize: 39,
          color: theme.text,
          lineHeight: 1.6,
          marginBottom: 48,
          paddingLeft: 8,
          opacity: summaryProgress,
          transform: `translateY(${interpolate(summaryProgress, [0, 1], [20, 0])}px)`,
          borderLeft: `4px solid ${theme.accent}`,
          paddingRight: 8,
        }}
      >
        {news.summary}
      </div>

      {/* Bullets */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24, flex: 1 }}>
        {news.bullets.map((bullet, i) => (
          <BulletPoint
            key={i}
            text={bullet}
            delay={20 + i * 10}
            theme={theme}
            frame={frame}
            fps={fps}
          />
        ))}
      </div>

      {/* Footer logo pequeño */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', marginTop: 24 }}>
        <Img
          src={staticFile(theme.logoFile)}
          style={{ height: 36, objectFit: 'contain', opacity: 0.5 }}
        />
      </div>
    </div>
  );
};

interface BulletPointProps {
  text: string;
  delay: number;
  theme: Theme;
  frame: number;
  fps: number;
}

const BulletPoint: React.FC<BulletPointProps> = ({ text, delay, theme, frame, fps }) => {
  const progress = spring({ frame: frame - delay, fps, config: { damping: 18 }, durationInFrames: 25 });

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 20,
        opacity: progress,
        transform: `translateX(${interpolate(progress, [0, 1], [-24, 0])}px)`,
      }}
    >
      <div style={{
        width: 36,
        height: 36,
        borderRadius: '50%',
        backgroundColor: theme.accent + '25',
        border: `2px solid ${theme.accent}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 28,
        flexShrink: 0,
        marginTop: 2,
      }}>
        ✓
      </div>
      <div style={{
        fontSize: 38,
        color: theme.text,
        lineHeight: 1.4,
        fontWeight: 500,
      }}>
        {text}
      </div>
    </div>
  );
};
