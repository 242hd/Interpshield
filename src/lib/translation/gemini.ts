/**
 * Gemini Translation Library
 * Uses server endpoint for LLM-based translation.
 */

export const translateText = async (
  text: string, 
  sourceLang: string, 
  targetLang: string,
  apiKey?: string
): Promise<string> => {
  try {
    const response = await fetch('/api/translate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text, sourceLang, targetLang, apiKey }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || 'Translation failed');
    }

    const data = await response.json();
    
    if (!data.translatedText) {
      console.warn('⚠️ [Gemini] Empty response from translation model');
      return text;
    }

    return data.translatedText.trim();
  } catch (error) {
    console.error('❌ [Gemini] Translation error:', error);
    throw error;
  }
};
