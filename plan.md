# Langy Build Plan

## Interface Build
- [x] Establish Vue + Tailwind end-user layout with mock session data
- [ ] Add responsive refinements for narrow/mobile viewports
- [ ] Wire real study data (sentences, focus words, queue ordering)
- [ ] Integrate audio playback hook and pronunciation cues

## Knowledge Model Foundations
- [ ] Draft Bayesian knowledge model specification
- [ ] Define data schema for words, sentences, and user state snapshots
- [ ] Explore word frequency dataset ingestion strategy

## Application Logic
- [ ] Select backend framework and API contract for study/session APIs
- [ ] Prototype sentence generation and tokenization workflow (OpenAI + Jieba)
- [ ] Outline spaced repetition scheduling logic tied to learner confidence signals
- [ ] Persist session progress and streak tracking

## QA & Polish
- [ ] Add unit/UI smoke tests for card interactions
- [ ] Document product decisions and onboarding copy
