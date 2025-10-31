const { ROOT_DIR, loadEnvFile, applyEnv } = require('./env');

const fileEnv = loadEnvFile();
applyEnv(fileEnv);

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
  throw new Error('Missing OPENAI_API_KEY environment variable. Add it to .env or your shell.');
}

const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const PORT = Number.parseInt(process.env.PORT, 10) || 3000;

module.exports = {
  ROOT_DIR,
  OPENAI_API_KEY,
  MODEL,
  PORT
};
