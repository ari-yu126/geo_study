// Runtime Gemini smoke test - dynamic import to avoid ESM issues.
// This script loads env from shell (do not print env) and attempts a minimal generateContent call.
// Usage (from project root): source .env.local && node test/run-gemini.js

(async () => {
  try {
    const key = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_GENAI_API_KEY;
    if (!key) {
      console.error('NO_KEY');
      process.exit(1);
    }

    const mod = await import('@google/generative-ai');
    const { GoogleGenerativeAI } = mod;
    const client = new GoogleGenerativeAI(key);
    const model = client.getGenerativeModel({ model: process.env.GENERATIVE_MODEL ?? 'gemini-2.5-flash-lite' });

    const prompt = 'Respond in JSON: {\"hello\":\"world\"}';
    const res = await model.generateContent([{ text: prompt }]);
    const text = await res.response.text();
    console.log('OK_RESPONSE_START');
    console.log(text);
    console.log('OK_RESPONSE_END');
  } catch (err) {
    console.error('ERROR', err && err.message ? err.message : String(err));
    process.exit(2);
  }
})();

