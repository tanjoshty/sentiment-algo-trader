import json
from handler import handler

# Mock SQS event
test_event = {
  "Records": [
    {
      "body": json.dumps({
        "article_id": "b1666848-1b44-4097-9285-5d6c680b3532",
        "title": "Musk offered Tesla board seat to OpenAI's Altman, Shivon Zilis says (TSLA:NASDAQ)",
        "summary": "Former OpenAI board member Shivon Zilis testified that Elon Musk offered OpenAI CEO Sam Altman a board seat at Tesla. This offer was reportedly part of an attempt by Musk to merge OpenAI into Tesla. The potential merger and ongoing legal disputes could impact the future valuations and IPOs of OpenAI and SpaceX, as well as investor confidence.",
        "ticker": "TSLA",
        "av_score": -0.064483,
        "published_at": "20260507T173831"
      })
    }
  ]
}

if __name__ == "__main__":
  print("🚀 Starting local test for ml-analyser...")
  # Note: Ensure your .env is configured with DB and DeepSeek credentials
  result = handler(test_event, None)
  print("✅ Result:", result)