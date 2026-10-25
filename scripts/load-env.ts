// Imported first by the benchmark scripts, before any module that reads process.env at load time
// (the model name, the Qloo base URL): keys from .env.local when it exists. Variables already set in
// the environment win.
try {
  process.loadEnvFile(".env.local");
} catch {
  // no .env.local: the keys come from the environment
}
