# Langy Build Plan

## Interface Playground
- [x] Build Vue + Tailwind shell with representative mock data
- [x] Provide variant selector with differentiated layouts for review
- [x] Iterate on the focus-flow layout per user feedback (aligned prompt/reveal footprint, no front-side definition)
- [ ] Integrate real content pipeline (sentence sourcing, audio hooks)

## Feedback Loop
- [x] Enable structured feedback capture with JSON export
- [x] Auto-save feedback directly into `/feedback/langy-feedback-live.json`
- [x] Auto-load feedback history from `/feedback/langy-feedback-live.json` when present
- [ ] Summarize recurring themes per variant to guide refinements

## Knowledge Model Foundations
- [ ] Draft Bayesian knowledge model specification
- [ ] Define data schema for words, sentences, and user state snapshots
- [ ] Explore word frequency dataset ingestion strategy

## Implementation Roadmap
- [ ] Select backend framework and API contract for the knowledge model
- [ ] Prototype sentence generation and tokenization workflow (OpenAI + Jieba)
- [ ] Outline spaced repetition scheduling logic tied to learner confidence signals
