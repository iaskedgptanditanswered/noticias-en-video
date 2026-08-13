import { Composition } from 'remotion';
import { NewsVideo, TOTAL_DURATION, calcDurations } from './compositions/NewsVideo';
import sampleData from './data/sample-insaights.json';
import type { NewsData } from './data/types';

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="NewsVideo"
      component={NewsVideo}
      durationInFrames={TOTAL_DURATION}
      fps={30}
      width={1080}
      height={1080}
      defaultProps={{ data: sampleData as NewsData }}
      calculateMetadata={({ props }) => ({
        durationInFrames: calcDurations(props.data).total,
      })}
    />
  );
};
