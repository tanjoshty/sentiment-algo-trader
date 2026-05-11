import { Client } from 'pg';
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import axios from "axios";
import { Article } from "./types";

console.log("1. Starting Secret Fetch...");
const secretsClient = new SecretsManagerClient({});

// 1. Initialize the SQS Client
// Tip: AWS SDK v3 automatically picks up credentials if running in Lambda
const sqs = new SQSClient({ 
  region: "ap-southeast-2", // Sydney
});

export const handler = async (event: any) => {
  const API_KEY = process.env.ALPHA_VANTAGE_API_KEY;
  const QUEUE_URL = process.env.QUEUE_URL;

  const secretResponse = await secretsClient.send(
    new GetSecretValueCommand({ SecretId: process.env.SECRET_ID })
  );

  if (!secretResponse.SecretString) {
    throw new Error("SecretString is missing from Secrets Manager response.");
  }

  // RDS secrets are stored as a JSON string: { "username": "...", "password": "..." }
  const { username, password } = JSON.parse(secretResponse.SecretString);

  const client = new Client({
    host: process.env.DB_HOST,
    user: username,
    password: password,
    database: process.env.DB_NAME,
    port: 5432,
    ssl: { rejectUnauthorized: false }
  });

  try {
    console.log(`Connecting to ${process.env.DB_HOST} as user: ${process.env.DB_USER}`);
    await client.connect();
    console.log("Connected to RDS.");

    // Check api_usage_log and update count
    const reservation = await client.query(`
      INSERT INTO api_usage_log (usage_date, call_count)
      VALUES (CURRENT_DATE, 1)
      ON CONFLICT (usage_date)
      DO UPDATE SET call_count = api_usage_log.call_count + 1
      WHERE api_usage_log.call_count < 25
      RETURNING call_count;
    `);

    if (reservation.rowCount === 0) {
      console.log("Quota exceeded for today. Standing down.");
      return;
    }

    const tickers = await client.query(`
      SELECT ticker FROM ticker_status ORDER BY last_polled_at ASC LIMIT 1;
    `);

    const ticker = tickers.rows[0].ticker || '';

    if (!ticker) {
      console.log("No ticker found. Standing down");
      return;
    }

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

    await client.query(`
      UPDATE ticker_status
      SET last_polled_at = NOW()
    `)

    const pushPromises = [];

    for (const article of articles) {
      try {
        const dbResult = await client.query(`
          INSERT INTO news_articles (url, title, summary, published_at)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (url) DO NOTHING
          RETURNING id;
        `, [article.url, article.title, article.summary, article.time_published]);

        if (dbResult.rowCount && dbResult.rowCount > 0) {
          const articleId = dbResult.rows[0].id;

          const messageParams = {
            QueueUrl: QUEUE_URL,
            MessageBody: JSON.stringify({
              article_id: articleId,
              title: article.title,
              summary: article.summary,
              ticker,
              av_score: article.overall_sentiment_score,
              published_at: article.time_published,
            }),
          };

          pushPromises.push(sqs.send(new SendMessageCommand(messageParams)));
        }
      } catch (error) {
        console.error(`Failed to process article ${article.url}`, error);
      }
    }

    await Promise.all(pushPromises);

    return { statusCode: 200, body: `Successfully ingested ${articles.length} articles` };
  } catch (error) {
    console.error("API Call failed, refunding credit:", error);

    // 3. THE REFUND (COMPENSATION)
    await client.query(`
      UPDATE api_usage_log 
      SET call_count = call_count - 1 
      WHERE usage_date = CURRENT_DATE AND call_count > 0;
    `);
    
    throw error;
  }
}