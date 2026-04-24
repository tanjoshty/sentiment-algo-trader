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
      CREATE TABLE IF NOT EXISTS news_sentiment (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        article_url TEXT UNIQUE NOT NULL,
        title TEXT NOT NULL,
        summary TEXT,
        ticker VARCHAR(10) NOT NULL,
        sentiment_score NUMERIC(4, 3),
        sentiment_label VARCHAR(20),
        published_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_news_ticker ON news_sentiment(ticker);
    `);

    console.log("Schema initialization complete.");
  } catch (err) {
    console.error("Failed to initialize database:", err);
    throw err;
  } finally {
    await client.end();
  }
};