import { Client } from 'pg';
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

console.log("1. Starting Secret Fetch...");
const secretsClient = new SecretsManagerClient({});

export const handler = async () => {
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
    console.log("Connected to RDS. Initializing Schema...");

    await client.query(`
      -- Enable UUID extension if not present
      CREATE EXTENSION IF NOT EXISTS "pgcrypto";

      CREATE TABLE IF NOT EXISTS news_articles (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        url TEXT UNIQUE NOT NULL, -- The gatekeeper for deduplication
        title TEXT NOT NULL,
        summary TEXT,
        published_at TIMESTAMPTZ, -- Use the actual news date for your 24h baseline
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS ticker_sentiment (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        article_id UUID NOT NULL REFERENCES news_articles(id) ON DELETE CASCADE,
        ticker VARCHAR(10) NOT NULL,
        av_sentiment_score NUMERIC(5, 4), -- Higher precision for decimal math
        llm_sentiment_score NUMERIC(5, 4),
        relevance_score NUMERIC(5, 4),
        timestamp TIMESTAMPTZ NOT NULL, -- Crucial for your hourly "Spike" queries
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS executed_trades (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        alpaca_order_id TEXT UNIQUE NOT NULL, -- Raw string from Alpaca API
        ticker VARCHAR(10) NOT NULL,
        avg_sentiment_1h NUMERIC(5, 4),
        avg_sentiment_24h NUMERIC(5, 4),
        qty INT NOT NULL CHECK (qty >= 1),
        timestamp TIMESTAMPTZ DEFAULT NOW()
      );

      -- Indexes for high-speed sentiment aggregation
      CREATE INDEX IF NOT EXISTS idx_ticker_lookup ON ticker_sentiment(ticker);
      CREATE INDEX IF NOT EXISTS idx_vibe_time ON ticker_sentiment(timestamp);
    `);

    console.log("Schema initialization complete.");
  } catch (err) {
    console.error("Failed to initialize database:", err);
    throw err;
  } finally {
    await client.end();
  }
};