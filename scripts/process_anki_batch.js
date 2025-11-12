#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const DEFAULT_WORD_FILE = path.join(ROOT_DIR, 'anki', 'firstbatch.txt');
const GENERATED_DIR = path.join(ROOT_DIR, 'anki', 'generated_sentences');

function printUsage() {
  console.log(
    'Usage: node scripts/process_anki_batch.js [--word-file anki/firstbatch.txt] [--count 20] [--limit N] [--aggregate <file>] [--helpers-output <file>] [--cards-output <file>] [--tts-count 3] [--media-dir anki/media] [--concurrency 3]'
  );
}

function parseArgs() {
  const argv = process.argv.slice(2);
  const options = {
    wordFile: DEFAULT_WORD_FILE,
    count: 20,
    limit: null,
    aggregatePath: null,
    helpersPath: null,
    cardsPath: null,
    ttsCount: 3,
    concurrency: 3,
    mediaDir: path.join(ROOT_DIR, 'anki', 'media'),
    help: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if ((arg === '--word-file' || arg === '-f') && argv[i + 1]) {
      options.wordFile = path.resolve(argv[i + 1]);
      i += 1;
    } else if ((arg === '--count' || arg === '-c') && argv[i + 1]) {
      const value = Number.parseInt(argv[i + 1], 10);
      if (Number.isFinite(value) && value > 0) {
        options.count = value;
      }
      i += 1;
    } else if (arg === '--limit' && argv[i + 1]) {
      const value = Number.parseInt(argv[i + 1], 10);
      if (Number.isFinite(value) && value > 0) {
        options.limit = value;
      }
      i += 1;
    } else if (arg === '--aggregate' && argv[i + 1]) {
      options.aggregatePath = path.resolve(argv[i + 1]);
      i += 1;
    } else if (arg === '--helpers-output' && argv[i + 1]) {
      options.helpersPath = path.resolve(argv[i + 1]);
      i += 1;
    } else if ((arg === '--cards-output' || arg === '-o') && argv[i + 1]) {
      options.cardsPath = path.resolve(argv[i + 1]);
      i += 1;
    } else if ((arg === '--tts-count' || arg === '-t') && argv[i + 1]) {
      const value = Number.parseInt(argv[i + 1], 10);
      if (Number.isFinite(value) && value >= 0) {
        options.ttsCount = value;
      }
      i += 1;
    } else if ((arg === '--media-dir' || arg === '-m') && argv[i + 1]) {
      options.mediaDir = path.resolve(argv[i + 1]);
      i += 1;
    } else if ((arg === '--concurrency' || arg === '-p') && argv[i + 1]) {
      const value = Number.parseInt(argv[i + 1], 10);
      if (Number.isFinite(value) && value > 0) {
        options.concurrency = value;
      }
      i += 1;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    }
  }

  if (!options.aggregatePath || !options.helpersPath || !options.cardsPath) {
    const baseName = path.basename(options.wordFile).replace(/\.[^.]+$/, '');
    if (!options.aggregatePath) {
      options.aggregatePath = path.join(GENERATED_DIR, `${baseName}_examples.json`);
    }
    if (!options.helpersPath) {
      options.helpersPath = path.join(GENERATED_DIR, `helper_notes_${baseName}.json`);
    }
    if (!options.cardsPath) {
      options.cardsPath = path.join(GENERATED_DIR, `${baseName}_cards.txt`);
    }
  }

  return options;
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function extractWordFromLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;
  const columns = trimmed.split(/\s+/).filter(Boolean);
  if (!columns.length) return null;
  if (columns.length === 1) {
    return columns[0];
  }
  if (/^\d+$/.test(columns[0])) {
    return columns[1];
  }
  return columns[0];
}

function readWordList(filePath, limit) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Word file not found: ${filePath}`);
  }
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/);
  const seen = new Set();
  const words = [];
  for (const line of lines) {
    const word = extractWordFromLine(line);
    if (!word || seen.has(word)) continue;
    seen.add(word);
    words.push(word);
    if (limit && words.length >= limit) break;
  }
  return words;
}

function runNodeScript(scriptPath, args, { captureJson = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [scriptPath, ...args], {
      cwd: ROOT_DIR,
      stdio: captureJson ? ['ignore', 'pipe', 'pipe'] : 'inherit'
    });

    let stdoutData = '';
    if (captureJson && child.stdout) {
      child.stdout.on('data', (chunk) => {
        stdoutData += chunk.toString();
      });
    }

    if (captureJson && child.stderr) {
      child.stderr.on('data', (chunk) => {
        process.stderr.write(chunk);
      });
    }

    child.on('error', (error) => reject(error));
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`${path.basename(scriptPath)} exited with code ${code}`));
        return;
      }
      if (captureJson) {
        try {
          const parsed = JSON.parse(stdoutData);
          resolve(parsed);
        } catch (error) {
          reject(
            new Error(
              `Failed to parse JSON output from ${path.basename(scriptPath)}: ${error.message}`
            )
          );
        }
      } else {
        resolve();
      }
    });
  });
}

async function generateSentences(words, count, concurrency) {
  const generatorPath = path.join('scripts', 'generate_card_sentences.js');
  const aggregated = [];
  let modelUsed = null;

  const total = words.length;
  const workerCount = Math.min(Math.max(1, concurrency || 1), total);
  let nextIndex = 0;

  async function runWorker(workerId) {
    while (true) {
      const currentIndex = nextIndex;
      if (currentIndex >= total) break;
      nextIndex += 1;
      const word = words[currentIndex];
      process.stderr.write(
        `\n[batch] (${currentIndex + 1}/${total}) [worker ${workerId}] Generating sentences for ${word}\n`
      );
      const payload = await runNodeScript(
        generatorPath,
        ['--word', word, '--count', String(count)],
        { captureJson: true }
      );
      if (!payload?.results || !Array.isArray(payload.results) || !payload.results.length) {
        throw new Error(`No results returned for word: ${word}`);
      }
      aggregated.push(...payload.results);
      if (!modelUsed && payload.model) {
        modelUsed = payload.model;
      }
    }
  }

  const workers = [];
  for (let i = 0; i < workerCount; i += 1) {
    workers.push(runWorker(i + 1));
  }
  await Promise.all(workers);

  return { modelUsed, aggregated };
}

async function generateHelperNotes(words, helpersPath) {
  const helperScript = path.join('scripts', 'generate_helper_notes.js');
  const args = ['--words', words.join(','), '--output', helpersPath];
  await runNodeScript(helperScript, args);
}

async function buildCards({ aggregatePath, helpersPath, cardsPath, ttsCount, mediaDir }) {
  const builderScript = path.join('scripts', 'build_anki_cards.js');
  const args = [
    '--sentences',
    aggregatePath,
    '--helpers',
    helpersPath,
    '--output',
    cardsPath,
    '--tts-count',
    String(ttsCount),
    '--media-dir',
    mediaDir
  ];
  await runNodeScript(builderScript, args);
}

async function main() {
  const options = parseArgs();
  if (options.help) {
    printUsage();
    process.exit(0);
  }

  const words = readWordList(options.wordFile, options.limit);
  if (!words.length) {
    throw new Error('No words found in the provided list.');
  }

  ensureDir(path.dirname(options.aggregatePath));
  ensureDir(path.dirname(options.helpersPath));
  ensureDir(path.dirname(options.cardsPath));
  ensureDir(options.mediaDir);

  process.stderr.write(
    `[batch] Preparing ${words.length} words from ${options.wordFile} (count per word: ${options.count})\n`
  );

  const { modelUsed, aggregated } = await generateSentences(
    words,
    options.count,
    options.concurrency
  );
  const aggregatePayload = {
    generated_at: new Date().toISOString(),
    model: modelUsed || process.env.OPENAI_MODEL || 'gpt-4o-mini',
    results: aggregated
  };
  fs.writeFileSync(options.aggregatePath, JSON.stringify(aggregatePayload, null, 2), 'utf8');
  process.stderr.write(
    `[batch] Saved ${aggregated.length} sentence variations to ${options.aggregatePath}\n`
  );

  await generateHelperNotes(words, options.helpersPath);
  process.stderr.write(`[batch] Helper notes saved to ${options.helpersPath}\n`);

  await buildCards({
    aggregatePath: options.aggregatePath,
    helpersPath: options.helpersPath,
    cardsPath: options.cardsPath,
    ttsCount: options.ttsCount,
    mediaDir: options.mediaDir
  });
  process.stderr.write(`[batch] Cards written to ${options.cardsPath}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
