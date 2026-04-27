from sentiment_service import get_sentiment as analyse_sentiment_llm

def main(article_content):
    # 1. Get the LLM's opinion
    llm_result = analyse_sentiment_llm(article_content)
    
    # 2. Extract raw scores
    av_score = float(article_content.get('overall_sentiment_score', 0))
    llm_score = float(llm_result.get('score', 0)) if llm_result else 0
    
    # 3. Calculate the aggregated "Trading Score"
    # Keeping your 40/60 split for the final decision-making score
    final_score = (av_score * 0.4) + (llm_score * 0.6)

    # 4. Return a flat object ready for DB insertion
    return {
        "article_url": article_content.get('url'),
        "title": article_content.get('title'),
        "summary": article_content.get('summary'),
        "ticker": article_content.get('ticker'),
        "sentiment_score": round(final_score, 4),      # The "Aggregated" score
        "sentiment_label": get_label_from_score(final_score), # Helper below
        "av_sentiment_score": av_score,                # Raw AlphaVantage
        "llm_sentiment_score": llm_score,              # Raw DeepSeek
        "llm_sentiment_label": llm_result.get('label') if llm_result else "Unknown",
        "published_at": article_content.get('time_published')
    }

def get_label_from_score(score):
    if score <= -0.35: return "Bearish"
    if score <= -0.15: return "Somewhat-Bearish"
    if score < 0.15: return "Neutral"
    if score < 0.35: return "Somewhat-Bullish"
    return "Bullish"
