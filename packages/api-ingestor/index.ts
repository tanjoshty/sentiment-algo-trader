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

  try {
    const url = `https://www.alphavantage.co/query?function=NEWS_SENTIMENT&tickers=GOOG,NVDA&apikey=${API_KEY}`;
    const response = await axios.get(url);

    if (response.data.Information || response.data.Note) {
       console.warn("Alpha Vantage Notice:", response.data.Information || response.data.Note);
       return [];
    }

    const articles = response.data.feed as Article[];
    const uniqueArticles = Array.from(new Map(articles.map((a: Article) => [a.url, a])).values());

    const pushPromises = uniqueArticles.map((article: Article) => {
      const messageParams = {
        QueueUrl: QUEUE_URL,
        MessageBody: JSON.stringify({
          title: article.title,
          summary: article.summary,
          url: article.url,
          overall_sentiment_score: article.overall_sentiment_score,
          overall_sentiment_label: article.overall_sentiment_label
        }),
      };
      
      console.log(`Pushing to queue: ${article.title}`);
      return sqs.send(new SendMessageCommand(messageParams));
    });

    await Promise.all(pushPromises);

    return { statusCode: 200, body: `Successfully ingested ${articles.length} articles` };
  } catch (error) {
    console.error('Lambda Handler Error: ', error);
    throw error;
  }
}