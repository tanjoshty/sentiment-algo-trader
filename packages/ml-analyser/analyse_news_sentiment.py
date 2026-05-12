from sentiment_service import get_sentiment

def main(article_data):
    try:
        # Delegate the LLM call to the service
        analysis = get_sentiment({
            "title": article_data.get('title'),
            "summary": article_data.get('summary'),
            "ticker": article_data.get('ticker')
        })

        if not analysis:
            return None
        
        # Map back to the structure the Database Handler expects
        # Note: We use .get(..., 0) to prevent crashes on missing LLM keys
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