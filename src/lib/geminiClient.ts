import { GoogleGenerativeAI } from '@google/generative-ai';

const apiKey =
  process.env.GEMINI_API_KEY ?? process.env.GOOGLE_GENAI_API_KEY ?? '';

console.log('[GEMINI KEY]', !!process.env.GOOGLE_GENAI_API_KEY, !!process.env.GEMINI_API_KEY);

const genAI = apiKey ? new GoogleGenerativeAI(apiKey) : null;

export const geminiFlash = genAI
  ? genAI.getGenerativeModel({ model: 'gemini-2.0-flash' })
  : null;
