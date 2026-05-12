import os
import json
import re
from openai import OpenAI
from dotenv import load_dotenv

load_dotenv()

client = OpenAI(
    api_key=os.environ.get("DEEPSEEK_API_KEY"),
    base_url="https://api.deepseek.com"
)

def get_sentiment(article_content):
    response = client.chat.completions.create(
        model="deepseek-reasoner", 
        messages=[
            {
                "role": "system", 
                "content": (
                    "You are an expert financial analyst. Analyse the sentiment and potential market impact of the news for the specific ticker. "
                    "Ignore any pre-existing sentiment scores in the input. "
                    "Use a scale from -1.0 (Extremely Bearish) to 1.0 (Extremely Bullish). "
                    "Reference Thresholds: x <= -0.35: Bearish; -0.15 to 0.15: Neutral; x >= 0.35: Bullish. "
                    "CRITICAL: Avoid returning exactly 0.0. Most news has a subtle positive or negative implication for a specific stock. "
                    "Be decisive and use granular values (e.g. 0.05, -0.08, 0.12) to capture the nuance. Truly neutral news is rare. "
                    "Return ONLY a JSON object with 'sentiment_score' (float) and 'relevance_score' (float)."
                )
            },
            {"role": "user", "content": json.dumps(article_content)}
        ],
        stream=False # DeepSeek-R1 can take 10-30s to 'think', so stream=False is fine for a Lambda
    )

    full_content = response.choices[0].message.content
    
    # R1 includes <think> tags. Pull the JSON block out.
    json_match = re.search(r'\{.*\}', full_content, re.DOTALL)
    if json_match:
        return json.loads(json_match.group())
    return None
