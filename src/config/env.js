const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..', '..');

function loadEnvFile(rootDir = ROOT_DIR) {
  const envPath = path.join(rootDir, '.env');
  if (!fs.existsSync(envPath)) return {};

  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  const env = {};

  for (const line of lines) {
    if (!line || line.trim().startsWith('#')) continue;
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!match) continue;

    const key = match[1];
    let value = match[2];
    const isWrapped = (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"));
    if (isWrapped) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }

  return env;
}

function applyEnv(env) {
  for (const [key, value] of Object.entries(env)) {
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

module.exports = {
  ROOT_DIR,
  loadEnvFile,
  applyEnv
};
