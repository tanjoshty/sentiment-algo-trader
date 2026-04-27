import json
import os
import psycopg2
from analyse_news_sentiment import main as analyse_sentiment

def handler(event, context):
  # Move connection outside the loop
  conn = None
  try:
      conn = psycopg2.connect(
          host=os.environ.get("DB_HOST"),
          database="tradingdb",
          user="dbadmin",
          password=os.environ.get("DB_PASSWORD"),
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
  # Fixed typo: 'article_url'
  query = """
  INSERT INTO news_sentiment (
      article_url, title, summary, ticker, sentiment_score, sentiment_label,
      av_sentiment_score, llm_sentiment_score, llm_sentiment_label, published_at
  ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
  ON CONFLICT (article_url) DO NOTHING;
  """
  cur.execute(query, (
      data['article_url'], data['title'], data['summary'], data['ticker'],
      data['sentiment_score'], data['sentiment_label'],
      data['av_sentiment_score'], data['llm_sentiment_score'], data['llm_sentiment_label'],
      data['published_at']
  ))