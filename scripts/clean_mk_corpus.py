#!/usr/bin/env python3

"""
Utility script for sampling and cleaning the Macedonian frequency corpus.

Steps performed:
1. Load the raw frequency list (word\tcount or \"word count\") from corpus_raw/mk_full.txt.
2. Randomly sample N records to use as a smoke test (default: 1000).
3. Filter out entries that contain characters outside of the Cyrillic block.
4. Lemmatize the remaining words via simplemma's Macedonian dictionary and aggregate counts by lemma.
5. Persist both the raw sample and the cleaned/aggregated sample for inspection.
6. (Optional) Run the same cleaning pass over the full corpus once the sample looks good.
"""

import argparse
import json
import random
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple


CYRILLIC_RE = re.compile(r"^[\u0400-\u04FF]+$")
DEFAULT_SOURCE = Path("corpus_raw/mk_full.txt")
DEFAULT_RAW_SAMPLE = Path("corpus/mk_sample_raw.json")
DEFAULT_CLEAN_SAMPLE = Path("corpus/mk_sample_clean.json")
DEFAULT_FULL_OUTPUT = Path("corpus/mk_clean.json")


def parse_args() -> argparse.Namespace:
  parser = argparse.ArgumentParser(description="Sample and clean the Macedonian frequency corpus.")
  parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE, help="Path to the raw mk_full.txt file.")
  parser.add_argument("--sample-size", type=int, default=1000, help="How many records to sample for the dry run.")
  parser.add_argument("--seed", type=int, default=42, help="Seed for deterministic sampling.")
  parser.add_argument("--raw-sample-output", type=Path, default=DEFAULT_RAW_SAMPLE, help="Where to write the raw sampled records (JSON).")
  parser.add_argument("--clean-sample-output", type=Path, default=DEFAULT_CLEAN_SAMPLE, help="Where to write the cleaned sample (JSON).")
  parser.add_argument("--full-output", type=Path, default=DEFAULT_FULL_OUTPUT, help="Where to write the cleaned full corpus (JSON).")
  parser.add_argument("--process-all", action="store_true", help="Also run the cleaner across the entire corpus once the sample completes.")
  parser.add_argument("--batch-size", type=int, default=64, help="Reserved for future batching tweaks (unused atm).")
  return parser.parse_args()


def load_corpus_entries(path: Path) -> List[Dict[str, int]]:
  if not path.exists():
    raise FileNotFoundError(f"Corpus file not found: {path}")
  entries: List[Dict[str, int]] = []
  with path.open("r", encoding="utf-8") as handle:
    for line in handle:
      raw = line.strip()
      if not raw:
        continue
      parts = raw.split()
      if len(parts) < 2:
        continue
      try:
        frequency = int(parts[-1])
      except ValueError:
        continue
      word = " ".join(parts[:-1])
      if not word:
        continue
      entries.append({"word": word, "frequency": frequency})
  return entries


def sample_entries(entries: List[Dict[str, int]], sample_size: int, seed: int) -> List[Dict[str, int]]:
  size = min(sample_size, len(entries))
  rng = random.Random(seed)
  return rng.sample(entries, size)


def normalize_token(word: str) -> str:
  token = (word or "").strip().lower()
  token = token.replace("’", "'").replace("`", "'")
  token = token.replace("'", "").replace("-", "").replace("–", "").replace("—", "")
  token = re.sub(r"[^0-9\u0400-\u04FF]+", "", token)
  return token


def is_cyrillic(word: str) -> bool:
  return bool(word) and bool(CYRILLIC_RE.match(word))


class MacedonianLemmatizer:
  def __init__(self) -> None:
    # Import simplemma lazily to avoid paying the startup cost unless we really
    # need to clean data.
    from simplemma import lemmatize  # pylint: disable=import-outside-toplevel

    self._lemmatize = lemmatize
    self._cache: Dict[str, Optional[str]] = {}

  def lemmatize(self, word: str) -> Optional[str]:
    if not word:
      return None
    if word in self._cache:
      return self._cache[word]
    lemma: Optional[str] = None
    try:
      lemma = self._lemmatize(word, "mk")
    except Exception:
      lemma = None
    if lemma:
      lemma = lemma.strip().lower()
    self._cache[word] = lemma
    return lemma


def clean_entries(entries: Iterable[Dict[str, int]], lemmatizer: MacedonianLemmatizer) -> Tuple[List[Dict[str, object]], Dict[str, object]]:
  aggregated: Dict[str, Dict[str, object]] = {}
  stats = {
    "total_input_entries": 0,
    "total_input_frequency": 0,
    "filtered_non_cyrillic": 0,
    "lemmatization_failures": 0,
    "retained_entries": 0,
    "retained_frequency": 0,
    "filtered_examples": [],
    "failure_examples": []
  }

  for entry in entries:
    stats["total_input_entries"] += 1
    freq = int(entry["frequency"])
    stats["total_input_frequency"] += freq
    original = entry["word"]
    normalized = normalize_token(original)
    if not is_cyrillic(normalized):
      stats["filtered_non_cyrillic"] += 1
      if len(stats["filtered_examples"]) < 10:
        stats["filtered_examples"].append(original)
      continue
    lemma = lemmatizer.lemmatize(normalized)
    if not lemma:
      stats["lemmatization_failures"] += 1
      if len(stats["failure_examples"]) < 10:
        stats["failure_examples"].append(original)
      continue
    lemma_key = lemma.lower()
    bucket = aggregated.get(lemma_key)
    if not bucket:
      bucket = {
        "lemma": lemma_key,
        "total_frequency": 0,
        "forms": set()
      }
      aggregated[lemma_key] = bucket
    bucket["total_frequency"] += freq
    bucket["forms"].add(original)
    stats["retained_entries"] += 1
    stats["retained_frequency"] += freq

  cleaned = []
  for item in aggregated.values():
    cleaned.append(
      {
        "lemma": item["lemma"],
        "total_frequency": item["total_frequency"],
        "forms": sorted(item["forms"])
      }
    )
  cleaned.sort(key=lambda x: x["total_frequency"], reverse=True)
  stats["unique_lemmas"] = len(cleaned)
  return cleaned, stats


def write_json(path: Path, payload: Dict[str, object]) -> None:
  path.parent.mkdir(parents=True, exist_ok=True)
  with path.open("w", encoding="utf-8") as handle:
    json.dump(payload, handle, indent=2, ensure_ascii=False)


def main() -> None:
  args = parse_args()
  entries = load_corpus_entries(args.source)

  sampled = sample_entries(entries, args.sample_size, args.seed)
  timestamp = datetime.now(timezone.utc).isoformat()
  raw_payload = {
    "source": str(args.source),
    "sample_size": len(sampled),
    "seed": args.seed,
    "generated_at": timestamp,
    "entries": sampled
  }
  write_json(args.raw_sample_output, raw_payload)
  print(f"[mk] Wrote raw sample ({len(sampled)} rows) to {args.raw_sample_output}")

  lemmatizer = MacedonianLemmatizer()
  cleaned_sample, sample_stats = clean_entries(sampled, lemmatizer)
  clean_payload = {
    "source": str(args.source),
    "sample_size": len(sampled),
    "generated_at": timestamp,
    "stats": sample_stats,
    "results": cleaned_sample
  }
  write_json(args.clean_sample_output, clean_payload)
  print(
    "[mk] Clean sample ready — "
    f"{sample_stats['retained_entries']} entries kept, "
    f"{sample_stats['unique_lemmas']} unique lemmas. "
    f"Saved to {args.clean_sample_output}"
  )

  if args.process_all:
    cleaned_full, full_stats = clean_entries(entries, lemmatizer)
    full_payload = {
      "source": str(args.source),
      "sample_size": len(entries),
      "generated_at": datetime.now(timezone.utc).isoformat(),
      "stats": full_stats,
      "results": cleaned_full
    }
    write_json(args.full_output, full_payload)
    print(
      "[mk] Full corpus cleaned — "
      f"{full_stats['retained_entries']} entries mapped to "
      f"{full_stats['unique_lemmas']} lemmas. "
      f"Saved to {args.full_output}"
    )


if __name__ == "__main__":
  main()
