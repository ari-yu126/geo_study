// List available models via @google/generative-ai
// Usage: source .env.local && node test/list-models.js

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
    const res = await client.listModels();
    console.log('MODELS_START');
    console.log(JSON.stringify(res, null, 2));
    console.log('MODELS_END');
  } catch (err) {
    console.error('ERROR', err && err.message ? err.message : String(err));
    process.exit(2);
  }
})();

