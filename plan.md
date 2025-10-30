# Langy Build Plan

## Interface Build
- [x] Establish Vue + Tailwind end-user layout with mock session data
- [x] Add flip gating plus loading/error states for dynamic cards
- [ ] Add responsive refinements for narrow/mobile viewports
- [ ] Wire real study data (sentences, focus words, queue ordering)
- [ ] Integrate audio playback hook and pronunciation cues

## Knowledge Model Foundations
- [ ] Draft Bayesian knowledge model specification
- [ ] Define data schema for words, sentences, and user state snapshots
- [x] Explore word frequency dataset ingestion strategy (sampled 1k-term corpus wired into UI debug grid)
- [x] Clean zh_cn_full corpus (Chinese-only filter) and regenerate tapered 1k sample for UI preload
- [ ] Fold sampled corpus into persistent user model storage
- [ ] Calibrate priors using frequency data once backend available
- [ ] Document sentence-level evidence propagation rules

## Application Logic
- [x] Stand up local OpenAI proxy for dynamic card generation
- [x] Add adaptive frequency stepping tied to learner responses
- [ ] Select backend framework and API contract for study/session APIs
- [ ] Prototype sentence generation and tokenization workflow (OpenAI + Jieba)
- [ ] Add request retry/backoff strategy and caching layer for generation API
- [ ] Outline spaced repetition scheduling logic tied to learner confidence signals
- [ ] Persist session progress and streak tracking

## QA & Polish
- [ ] Add unit/UI smoke tests for card interactions
- [ ] Document product decisions and onboarding copy
