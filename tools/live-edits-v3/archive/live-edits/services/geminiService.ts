
import { GoogleGenAI } from "@google/genai";

const API_KEY = process.env.API_KEY || '';
const ai = new GoogleGenAI({ apiKey: API_KEY });

export const GeminiService = {
  /**
   * Suggests improvements for a block of text.
   */
  improveText: async (text: string): Promise<string> => {
    if (!API_KEY) {
      console.warn("Gemini API Key is missing.");
      return "AI functionality requires an API Key.";
    }

    try {
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: `You are a professional health information editor. 
        Rewrite the following text to be more concise, clear, and accessible to the general public. 
        Keep the medical accuracy but improve readability. 
        Return ONLY the rewritten text, no preamble.
        
        Text: "${text}"`,
      });

      return response.text?.trim() || text;
    } catch (error) {
      console.error("Gemini API Error:", error);
      return text; // Fallback to original
    }
  },

  /**
   * Analyzes the sentiment or potential issues in a comment.
   */
  analyzeComment: async (comment: string): Promise<string> => {
    if (!API_KEY) return "AI Analysis unavailable (No Key)";

    try {
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: `Analyze the following comment left on a health website. 
        Identify if it contains misinformation, urgent medical questions, or general feedback.
        Keep the analysis under 15 words.
        
        Comment: "${comment}"`,
      });
      return response.text?.trim() || "No analysis available.";
    } catch (error) {
      return "Error analyzing comment.";
    }
  },

  /**
   * Checks connection to Gemini API.
   */
  checkConnection: async (): Promise<{ status: 'connected' | 'error'; message: string }> => {
    if (!API_KEY) {
        return { status: 'error', message: 'API Key missing' };
    }
    try {
        await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: 'ping'
        });
        return { status: 'connected', message: 'Service Operational' };
    } catch (error: any) {
        return { status: 'error', message: error.message || 'API Unreachable' };
    }
  },

  /**
   * Generates a clean Product Title from a folder name using AI.
   */
  generateProjectTitle: async (folderName: string): Promise<string> => {
    if (!API_KEY) {
      // Fallback logic if AI is down
      return folderName.replace(/[-_]/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    }

    try {
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: `Convert this folder name into a professional Health Product Title (e.g., 'src_nutrition_v2' -> 'Nutrition & Wellness Portal'). Folder name: "${folderName}". Return ONLY the title.`,
      });
      return response.text?.trim() || folderName;
    } catch (e) {
      console.warn("Gemini title generation failed", e);
      return folderName;
    }
  }
};