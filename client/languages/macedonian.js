import { segmentPlainText } from '../utils/segmentation.js';

const MACEDONIAN_TOPICS = [
  'Morning routines in a busy city',
  'Weekend hikes in the mountains',
  'Planning a neighborhood festival',
  'Running a small family bakery',
  'Volunteering at a local library',
  'Preparing for a long train ride',
  'Sharing an apartment with friends',
  'Organizing a film club screening',
  'Keeping a balcony garden alive',
  'Learning to play in a community band',
  'Starting a food truck with neighbors',
  'Training for a charity bike ride',
  'Documenting a remote work week',
  'Hosting a board game night',
  'Practicing yoga in the park',
  'Reopening a historic cinema',
  'Visiting relatives in a small village',
  'Repairing an old summer house',
  'Preparing for a winter road trip',
  'Volunteering at an animal shelter',
  'Organizing a school science fair',
  'Cooking traditional dishes together',
  'Preparing costumes for a theater play',
  'Finding calm during a rainy season',
  'Building a makerspace in town',
  'Planning a budget friendly vacation',
  'Documenting a café renovation',
  'Coaching a youth football team',
  'Training for a half marathon',
  'Setting up a pop-up art show',
  'Helping a friend move apartments',
  'Collecting stories from grandparents',
  'Keeping a travel journal on the bus',
  'Studying for university entrance exams',
  'Practicing mindfulness on the tram',
  'Preparing homemade gifts for holidays',
  'Recording a neighborhood podcast',
  'Organizing a zero-waste workshop',
  'Learning to play a traditional instrument',
  'Teaching kids to ride bicycles'
];

export const macedonianLanguage = {
  id: 'mk',
  label: 'Macedonian',
  shortLabel: 'Macedonian',
  romanizationLabel: 'Latin transliteration',
  scriptLabel: 'Cyrillic',
  corpus: {
    path: 'corpus/mk_clean.json',
    format: 'mk-json'
  },
  segmenter: (text, options = {}) => segmentPlainText(text, options),
  readingTopics: MACEDONIAN_TOPICS,
  card: {
    sentenceLengthLimit: 160,
    romanizationNote:
      'Provide the target word transliterated into the Latin alphabet using standard Macedonian conventions.'
  },
  readingName: 'Macedonian reading passages',
  defaultVoice: 'alloy',
  supportsLocalGlosses: false
};

