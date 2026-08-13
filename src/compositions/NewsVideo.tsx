import { AbsoluteFill, Sequence, useCurrentFrame, Audio, staticFile } from 'remotion';
import { Overview } from '../components/Overview';
import { NewsSegment } from '../components/NewsSegment';
import { Outro } from '../components/Outro';
import { getTheme } from '../themes';
import type { Theme } from '../themes/types';
import type { NewsData } from '../data/types';
import { LOGO_CENTER_Y } from '../components/NewsSegment';

const FPS  = 30;
const INTRO = 150;   // 5 s — always fixed
const TRANS = 35;   // iris transition — always fixed

/** Derive per-render durations from data timing fields. */
export function calcDurations(data: NewsData) {
  const segFrames  = Math.round((data.secsPerNews    ?? 7)  * FPS);   // default 7 s
  const readFrames = Math.round((data.secsOutroCards ?? 10) * FPS);   // default 10 s
  const outroFrames = readFrames + 150;  // 150 f of fixed logo animation after cards
  const total = INTRO + 3 * segFrames + outroFrames;
  return { segFrames, readFrames, outroFrames, total };
}

// Default total for the composition registration (overridden by calculateMetadata)
export const TOTAL_DURATION = calcDurations({ theme: 'insaights', date: '', news: [] as any, pattern: '', debate: '' }).total;

// ─── Iris transition ──────────────────────────────────────────────────────────
const IrisTransition: React.FC<{ theme: Theme }> = ({ theme }) => {
  const frame = useCurrentFrame();

  function clamp(v: number, lo: number, hi: number) { return Math.min(hi, Math.max(lo, v)); }
  function pg(f: number, s: number, e: number) { return clamp((f - s) / (e - s), 0, 1); }
  function easeIn(t: number)  { return t * t * t; }
  function easeOut(t: number) { return 1 - easeIn(1 - t); }

  const growProg   = easeIn(pg(frame, 0, 20));
  const circleDiam = 100 + growProg * (2600 - 100);
  const fadeOut    = frame < 18 ? 1 : 1 - easeOut(pg(frame, 18, 35));
  const cx = 540;
  const cy = LOGO_CENTER_Y;

  return (
    <AbsoluteFill style={{ overflow: 'hidden', pointerEvents: 'none' }}>
      <div style={{
        position: 'absolute',
        borderRadius: '50%',
        backgroundColor: theme.primary,
        width:  circleDiam,
        height: circleDiam,
        left:   cx - circleDiam / 2,
        top:    cy - circleDiam / 2,
        opacity: fadeOut,
      }} />
    </AbsoluteFill>
  );
};

// ─── Composition ─────────────────────────────────────────────────────────────
export const NewsVideo: React.FC<{ data: NewsData }> = ({ data }) => {
  const theme = getTheme(data.theme);
  const { segFrames, readFrames, outroFrames, total } = calcDurations(data);

  const TRANS_FROM = INTRO + 3 * segFrames - 10;

  const isInsaights = data.theme === 'insaights';
  const isH2 = data.theme === 'h2newsweb';

  let audioFile = '';
  let audioDurationFrames = 0;

  if (isInsaights) {
    audioFile = 'Morning_Objectives.mp3';
    audioDurationFrames = Math.round(84.27 * FPS);
  } else if (isH2) {
    audioFile = 'Calculated_Growth.mp3';
    audioDurationFrames = Math.round(82 * FPS);
  }

  const audioStartFrom = Math.max(0, audioDurationFrames - total);

  return (
    <AbsoluteFill style={{ backgroundColor: theme.background }}>
      {audioFile && (
        <Audio
          src={staticFile(audioFile)}
          startFrom={audioStartFrom}
          volume={0.4}
        />
      )}
      <Sequence from={0} durationInFrames={INTRO}>
        <AbsoluteFill>
          <Overview theme={theme} date={data.date} news={data.news} />
        </AbsoluteFill>
      </Sequence>
      {([0, 1, 2] as const).map((i) => (
        <Sequence key={i} from={INTRO + i * segFrames} durationInFrames={segFrames}>
          <AbsoluteFill>
            <NewsSegment theme={theme} news={data.news} activeIndex={i} date={data.date} segFrames={segFrames} />
          </AbsoluteFill>
        </Sequence>
      ))}
      <Sequence from={INTRO + 3 * segFrames} durationInFrames={outroFrames}>
        <AbsoluteFill>
          <Outro theme={theme} data={data} readFrames={readFrames} />
        </AbsoluteFill>
      </Sequence>
      <Sequence from={TRANS_FROM} durationInFrames={TRANS}>
        <IrisTransition theme={theme} />
      </Sequence>
    </AbsoluteFill>
  );
};
