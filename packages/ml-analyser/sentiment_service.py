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
    # Python uses '=' for keyword arguments, not ':'
    # Also, snake_case is the standard naming convention in Python
    response = client.chat.completions.create(
        model="deepseek-reasoner", 
        messages=[
            {
                "role": "system", 
                "content": (
                    "You are a financial analyst. Analyse the sentiment of the article title and summary. Ignore the sentiment score that is already there."
                    "Return ONLY a JSON object with 'score' (a float) and 'label'. "
                    "Logic: x <= -0.35: Bearish; -0.35 < x <= -0.15: Somewhat-Bearish; "
                    "-0.15 < x < 0.15: Neutral; 0.15 <= x < 0.35: Somewhat-Bullish; x >= 0.35: Bullish."
                )
            },
            {"role": "user", "content": json.dumps(article_content)}
        ],
        stream=False # DeepSeek-R1 can take 10-30s to 'think', so stream=False is fine for a Lambda
    )

    full_content = response.choices[0].message.content

    # R1 includes reasoning. We want the final content.
    full_content = response.choices[0].message.content
    
    # Simple regex to pull the JSON block if the model gets chatty
    json_match = re.search(r'\{.*\}', full_content, re.DOTALL)
    if json_match:
        return json.loads(json_match.group())
    return None
