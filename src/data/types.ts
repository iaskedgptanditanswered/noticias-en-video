export interface NewsItem {
  title: string;
  summary: string;
  bullets: [string, string, string];
}

export interface NewsData {
  theme: 'insaights' | 'h2newsweb';
  date: string;
  news: [NewsItem, NewsItem, NewsItem];
  pattern: string;
  debate: string;
  /** Seconds each news segment stays on screen. Default: 7 */
  secsPerNews?: number;
  /** Seconds the pattern+debate cards stay visible in the outro. Default: 10 */
  secsOutroCards?: number;
}
