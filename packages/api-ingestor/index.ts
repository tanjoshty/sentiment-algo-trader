import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import axios from "axios";
import { Article } from "./types";

// 1. Initialize the SQS Client
// Tip: AWS SDK v3 automatically picks up credentials if running in Lambda
const sqs = new SQSClient({ 
  region: "ap-southeast-2", // Sydney
});

export const handler = async (event: any) => {
  const API_KEY = process.env.ALPHA_VANTAGE_API_KEY;
  const QUEUE_URL = process.env.QUEUE_URL;
  const ticker = 'GOOG';

  try {
    const url = `https://www.alphavantage.co/query?function=NEWS_SENTIMENT&tickers=${ticker}&limit=5&apikey=${API_KEY}`;
    const response = await axios.get(url);

    if (response.data.Information || response.data.Note) {
       console.warn("Alpha Vantage Notice:", response.data.Information || response.data.Note);
       return [];
    }

    console.log("ticker: ", ticker);
    console.log("url: ", url);
    console.log("response: ", response.data.feed);

    const articles = response.data.feed as Article[];
    const uniqueArticles = Array.from(new Map(articles.map((a: Article) => [a.url, a])).values());
    const topArticles = uniqueArticles.slice(0, 5);

    const pushPromises = topArticles.map((article: Article) => {
      const messageParams = {
        QueueUrl: QUEUE_URL,
        MessageBody: JSON.stringify({
          title: article.title,
          summary: article.summary,
          url: article.url,
          overall_sentiment_score: article.overall_sentiment_score,
          overall_sentiment_label: article.overall_sentiment_label,
          time_published: article.time_published,
          ticker,
        }),
      };
      
      console.log(`Pushing to queue: ${article.title}`);
      return sqs.send(new SendMessageCommand(messageParams));
    });

    await Promise.all(pushPromises);

    return { statusCode: 200, body: `Successfully ingested ${topArticles.length} articles` };
  } catch (error) {
    console.error('Lambda Handler Error: ', error);
    throw error;
  }
}