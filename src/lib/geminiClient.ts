import { GoogleGenerativeAI } from '@google/generative-ai';

const apiKey =
  process.env.GEMINI_API_KEY ?? process.env.GOOGLE_GENAI_API_KEY ?? '';

if (!apiKey) {
  throw new Error('Gemini API Key is missing. Set GOOGLE_GENAI_API_KEY or GEMINI_API_KEY in .env.local');
}

console.log('[GEMINI KEY]', !!process.env.GOOGLE_GENAI_API_KEY, !!process.env.GEMINI_API_KEY);

const genAI = new GoogleGenerativeAI(apiKey);

export const geminiFlash = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
