import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import axios from "axios";
import { Article } from "./types";

const sqs = new SQSClient({});

export const handler = async (event: any) => {
  const API_KEY = process.env.ALPHA_VANTAGE_KEY;
  const QUEUE_URL = process.env.QUEUE_URL;
  const url = `https://www.alphavantage.co/query?function=NEWS_SENTIMENT&tickers=GOOGL&limit=5&apikey=${API_KEY}`;

  try {
    const articles = await getNewsArticles(url);
    
    if (!articles || articles.length === 0) {
      console.log("No new articles found.");
      return { statusCode: 200, body: "No news to process." };
    }

    // Map each article to a promise for parallel execution
    const pushPromises = articles.map((article: Article) => {
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

const getNewsArticles = async (url: string) => {
  try {
    const response = await axios.get(url);
    
    // Check if Alpha Vantage returned an error message instead of data
    if (response.data.Information || response.data.Note) {
       console.warn("Alpha Vantage Notice:", response.data.Information || response.data.Note);
       return [];
    }

    return response.data.feed || [];
  } catch (error) {
    console.error('API Fetch Error: ', error);
    throw error;
  }
}