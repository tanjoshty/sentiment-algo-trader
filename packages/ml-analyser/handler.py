import json
import os
import boto3
import psycopg2
from analyse_news_sentiment import main as analyse_sentiment
from dotenv import load_dotenv

load_dotenv()

def get_db_credentials():
    secret_id = os.environ.get("SECRET_ID")
    if not secret_id:
        # Fallback for local testing
        return "dbadmin", os.environ.get("DB_PASSWORD")
    
    client = boto3.client('secretsmanager')
    response = client.get_secret_value(SecretId=secret_id)
    creds = json.loads(response['SecretString'])
    return creds['username'], creds['password']

def handler(event, context):
  # Move connection outside the loop
  conn = None
  try:
      username, password = get_db_credentials()
      
      conn = psycopg2.connect(
          host=os.environ.get("DB_HOST", "localhost"),
          database=os.environ.get("DB_NAME", "tradingdb"),
          user=username,
          password=password,
          connect_timeout=5
      )
      cur = conn.cursor()

      for record in event['Records']:
          try:
              article_data = json.loads(record['body'])
              print(f"Processing: {article_data.get('title')}")

              processed_data = analyse_sentiment(article_data)

              if processed_data:
                  # Logic moved to a helper that takes the active 'cur'
                  execute_insert(cur, processed_data)
                  print(f"Successfully saved {article_data.get('ticker')} to database.")
          
          except Exception as e:
              print(f"Error processing record: {str(e)}")
              continue
      
      conn.commit() # Commit the whole batch at once
      cur.close()
  except Exception as e:
      print(f"Database connection error: {str(e)}")
      raise e # Let the Lambda fail so SQS retries
  finally:
      if conn:
          conn.close()
  
  return {"statusCode": 200, "body": json.dumps("Processing complete")}

def execute_insert(cur, data):
  query = """
  INSERT INTO ticker_sentiment (
      article_id, ticker, av_sentiment_score, llm_sentiment_score, relevance_score, timestamp
  ) VALUES (%s, %s, %s, %s, %s, %s)
  ON CONFLICT (article_id, ticker) DO NOTHING;
  """
  cur.execute(query, (
      data['article_id'], data['ticker'],
      data['av_sentiment_score'], data['llm_sentiment_score'], data['relevance_score'],
      data['published_at']
  ))