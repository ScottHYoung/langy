const fs = require('fs');
const path = require('path');
const { ROOT_DIR } = require('../config');

const LOG_DIR = path.join(ROOT_DIR, 'logs');
const API_USAGE_LOG = path.join(LOG_DIR, 'api-usage.log');

function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

function logApiUsage(entry) {
  try {
    ensureLogDir();
    const payload = {
      timestamp: new Date().toISOString(),
      ...entry
    };
    fs.appendFile(API_USAGE_LOG, JSON.stringify(payload) + '\n', (error) => {
      if (error) {
        console.error('Unable to append API usage log entry:', error);
      }
    });
  } catch (error) {
    console.error('Failed to log API usage:', error);
  }
}

module.exports = {
  logApiUsage,
  API_USAGE_LOG
};
