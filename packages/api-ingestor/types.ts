export type Sentiment = 'Bearish' | 'Somewhat-Bearish' | 'Neutral' | 'Somewhat-Bullish' | 'Bullish';

export interface Article {
  title: string,
  url: string,
  time_published: string,
  authors: string[],
  summary: string,
  banner_image: string,
  source: string,
  category_within_source: string,
  source_domain: string,
  topics: string[],
  overall_sentiment_score: number,
  overall_sentiment_label: Sentiment,
  ticker_sentiment: string[],
}