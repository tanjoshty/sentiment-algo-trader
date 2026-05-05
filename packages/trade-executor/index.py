import os
import psycopg2
from alpaca.trading.client import TradingClient
from alpaca.trading.requests import MarketOrderRequest
from alpaca.trading.enums import OrderSide, TimeInForce

def handler (event, context):
  # 1. Setup Clients
  trading_client = TradingClient(os.environ['ALPACA_API_KEY'], os.environ['ALPACA_API_SECRET'], paper=True)

  conn = psycopg2.connect(
    host=os.environ['DB_HOST'],
    database='tradingdb',
    user='dbadmin',
    password=os.environ['DB_PASSWORD']
  )

  # 2. Run Aggregation Query
  cur = conn.cursor()
  query = """
    SELECT ticker, AVG(sentiment_score)
    FROM news_sentiment
    WHERE timestamp > NOW() - INTERVAL '30 minutes'
    GROUP BY ticker
    HAVING COUNT(*) >= 3 AND AVG(sentiment_score) > 0.75;
  """
  cur.execute(query)
  trades_to_make = cur.fetchall()

  # 3. Execute Trades
  for ticker, score in trades_to_make:
    print(f"Executing Bullish trade for {ticker} based on score: {score}")

    market_order_data = MarketOrderRequest(
      symbol=ticker,
      qty=1,
      side=OrderSide.BUY,
      time_in_force=TimeInForce.DAY
    )
    trading_client.submit_order(order_data=market_order_data)
  
  cur.close()
  conn.close()