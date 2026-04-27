import json
from analyse_news_sentiment import main

with open('stub_article.json', 'r') as f:
  mock_article = json.load(f)
  print(f"--- Starting Analysis for {mock_article['ticker']} ---")
  result = main(mock_article)

  # 3. View the results
  print(f"Final Aggregated Score: {result}")