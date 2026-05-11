import os
import json
import re
from openai import OpenAI

client = OpenAI(
    api_key=os.environ.get("DEEPSEEK_API_KEY"),
    base_url="https://api.deepseek.com"
)

def main(article_data):
    try:
        # Switching to deepseek-reasoner (R1) as per sentiment_service.py style
        response = client.chat.completions.create(
            model="deepseek-reasoner",
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a financial analyst. Analyse the sentiment of the article title and summary for the specific ticker provided. "
                        "Ignore the sentiment score that is already there. "
                        "Return ONLY a JSON object with 'sentiment_score' (a float) and 'relevance_score' (a float). "
                        "Logic: x <= -0.35: Bearish; -0.35 < x <= -0.15: Somewhat-Bearish; "
                        "-0.15 < x < 0.15: Neutral; 0.15 <= x < 0.35: Somewhat-Bullish; x >= 0.35: Bullish."
                    )
                },
                {"role": "user", "content": json.dumps(article_data)},
            ],
            stream=False
        )

        full_content = response.choices[0].message.content
        
        # Extract JSON block using regex as R1 includes reasoning tags that break standard JSON parsing
        json_match = re.search(r'\{.*\}', full_content, re.DOTALL)
        if not json_match:
            return None
        analysis = json.loads(json_match.group())
        
        return {
            "article_id": article_data['article_id'],
            "ticker": article_data['ticker'],
            "av_sentiment_score": article_data['av_score'],
            "llm_sentiment_score": analysis.get("sentiment_score", 0),
            "relevance_score": analysis.get("relevance_score", 0),
            "published_at": article_data['published_at']
        }
    except Exception as e:
        print(f"DeepSeek API error: {str(e)}")
        return None