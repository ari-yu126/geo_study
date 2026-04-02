// Fetch models list from Generative Language API using API key (no key printed).
// Usage: source .env.local && node test/fetch-models.js

(async () => {
  try {
    const key = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_GENAI_API_KEY;
    if (!key) {
      console.error('NO_KEY');
      process.exit(1);
    }
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`;
    const res = await fetch(url, { method: 'GET' });
    const text = await res.text();
    console.log('STATUS', res.status);
    console.log(text);
  } catch (err) {
    console.error('ERROR', err && err.message ? err.message : String(err));
    process.exit(2);
  }
})();

