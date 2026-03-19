import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API config endpoint
  app.get("/api/config", (req, res) => {
    const dgKey = process.env.DEEPGRAM_API_KEY;
    const gemKey = process.env.GEMINI_API_KEY;
    
    // Check if keys are placeholders
    const isDgPlaceholder = !dgKey || 
      dgKey === "YOUR_DEEPGRAM_API_KEY_HERE" || 
      dgKey === "MY_DEEPGRAM_API_KEY" ||
      dgKey === "null" ||
      dgKey === "undefined" ||
      dgKey.trim() === "";

    const isGemPlaceholder = !gemKey || 
      gemKey === "YOUR_GEMINI_API_KEY_HERE" || 
      gemKey === "MY_GEMINI_API_KEY" || 
      gemKey.trim() === "" || 
      gemKey === "null" || 
      gemKey === "undefined";
    
    // Most Gemini keys are at least 30 chars, but let's be lenient
    const isGemTooShort = gemKey && gemKey.length < 5;
    const finalGemPlaceholder = isGemPlaceholder || isGemTooShort;

    // Detect if running in AI Studio (Build mode)
    const isAIStudio = !!process.env.AISTUDIO_BUILD || !!process.env.GEMINI_API_KEY;

    res.json({
      hasDeepgramKey: !isDgPlaceholder,
      hasGeminiKey: !finalGemPlaceholder,
      deepgramApiKey: isDgPlaceholder ? null : dgKey,
      geminiApiKey: finalGemPlaceholder ? null : gemKey,
      isAIStudio: isAIStudio,
      envKeys: {
        hasGeminiEnv: !!process.env.GEMINI_API_KEY,
        hasDeepgramEnv: !!process.env.DEEPGRAM_API_KEY
      }
    });
  });

  // Translation endpoint
  app.post("/api/translate", async (req, res) => {
    const { text, sourceLang, targetLang, apiKey: clientApiKey } = req.body;
    const rawApiKey = clientApiKey || process.env.GEMINI_API_KEY;
    const apiKey = typeof rawApiKey === 'string' ? rawApiKey.trim() : rawApiKey;

    const isPlaceholder = !apiKey || 
      apiKey === 'YOUR_GEMINI_API_KEY_HERE' || 
      apiKey === 'MY_GEMINI_API_KEY' || 
      apiKey === 'null' || 
      apiKey === 'undefined' ||
      apiKey.length < 5;

    if (isPlaceholder) {
      return res.status(400).json({ error: "Gemini API key is missing or invalid. Please check your configuration." });
    }

    try {
      const { GoogleGenAI, ThinkingLevel } = await import("@google/genai");
      const ai = new GoogleGenAI({ apiKey });
      
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Act as a professional real-time interpreter. 
Translate the following speech from ${sourceLang} to ${targetLang}.
- Maintain the original tone and intent.
- Remove speech fillers (um, uh, like, etc.) unless they are critical for meaning.
- Output ONLY the translated text.
- Do not include any meta-commentary or notes.

Speech to translate:
"${text}"`,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW }
        }
      });
      
      const translatedText = response.text || "";
      res.json({ translatedText });
    } catch (error: any) {
      console.error("Translation error:", error);
      const errorMessage = error?.message || "Translation failed";
      res.status(500).json({ error: errorMessage });
    }
  });

  // Test Gemini API endpoint
  app.post("/api/test-gemini", async (req, res) => {
    const { apiKey: clientApiKey } = req.body;
    const rawApiKey = clientApiKey || process.env.GEMINI_API_KEY;
    const apiKey = typeof rawApiKey === 'string' ? rawApiKey.trim() : rawApiKey;

    if (!apiKey || apiKey.length < 5) {
      return res.status(400).json({ error: "Invalid API key" });
    }

    try {
      const { GoogleGenAI } = await import("@google/genai");
      const ai = new GoogleGenAI({ apiKey });
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: "Say 'OK'",
      });
      
      if (response.text) {
        res.json({ success: true });
      } else {
        res.status(500).json({ error: "Empty response from API" });
      }
    } catch (error: any) {
      console.error("Test Gemini error:", error);
      res.status(500).json({ error: error?.message || "Connection failed" });
    }
  });

  // Proxy for Deepgram if needed, or just provide the key to the frontend if the user is okay with it for a "demo"
  // But better to keep it hidden. We'll use a simple "isDemo" flag.
  
  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
