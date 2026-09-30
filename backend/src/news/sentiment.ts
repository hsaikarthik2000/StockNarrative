type SentimentCue = { phrase: string; weight: number };

const positiveCues: SentimentCue[] = [
  { phrase: 'record high', weight: 1.5 },
  { phrase: 'all time high', weight: 1.5 },
  { phrase: 'strong growth', weight: 1.4 },
  { phrase: 'surge', weight: 1.3 },
  { phrase: 'rally', weight: 1.2 },
  { phrase: 'outperform', weight: 1.2 },
  { phrase: 'upgrade', weight: 1.2 },
  { phrase: 'profit', weight: 1 },
  { phrase: 'profits', weight: 1 },
  { phrase: 'growth', weight: 1 },
  { phrase: 'gains', weight: 1 },
  { phrase: 'gain', weight: 1 },
  { phrase: 'rose', weight: 1 },
  { phrase: 'rises', weight: 1 },
  { phrase: 'rise', weight: 1 },
  { phrase: 'climbs', weight: 1 },
  { phrase: 'climb', weight: 1 },
  { phrase: 'jumps', weight: 1 },
  { phrase: 'jumped', weight: 1 },
  { phrase: 'beat estimates', weight: 1.2 },
  { phrase: 'dividend', weight: 0.6 },
  { phrase: 'buyback', weight: 0.8 },
  { phrase: 'rebound', weight: 1 },
  { phrase: 'higher', weight: 0.6 },
  { phrase: 'up', weight: 0.6 },
];

const negativeCues: SentimentCue[] = [
  { phrase: 'record low', weight: 1.5 },
  { phrase: 'sharp decline', weight: 1.4 },
  { phrase: 'sharp fall', weight: 1.4 },
  { phrase: 'downgrade', weight: 1.2 },
  { phrase: 'slump', weight: 1.3 },
  { phrase: 'crash', weight: 1.5 },
  { phrase: 'losses', weight: 1 },
  { phrase: 'loss', weight: 1 },
  { phrase: 'declines', weight: 1 },
  { phrase: 'decline', weight: 1 },
  { phrase: 'dropped', weight: 1 },
  { phrase: 'drops', weight: 1 },
  { phrase: 'drop', weight: 1 },
  { phrase: 'fell', weight: 1 },
  { phrase: 'falls', weight: 1 },
  { phrase: 'fall', weight: 1 },
  { phrase: 'missed estimates', weight: 1.2 },
  { phrase: 'weak', weight: 1 },
  { phrase: 'concerns', weight: 0.8 },
  { phrase: 'concern', weight: 0.8 },
  { phrase: 'probe', weight: 0.8 },
  { phrase: 'investigation', weight: 0.8 },
  { phrase: 'lower', weight: 0.6 },
  { phrase: 'down', weight: 0.6 },
];

export function scoreNewsHeadline(title: string): { score: number; label: string } | null {
  const words = title.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const positiveScore = scoreCues(words, positiveCues);
  const negativeScore = scoreCues(words, negativeCues);
  const total = positiveScore + negativeScore;
  if (total === 0) return null;

  const score = Math.max(-1, Math.min(1, (positiveScore - negativeScore) / 2));
  return { score, label: sentimentLabel(score) };
}

function scoreCues(words: string[], cues: SentimentCue[]) {
  return cues.reduce((total, cue) => {
    const phraseWords = cue.phrase.split(' ');
    for (let index = 0; index <= words.length - phraseWords.length; index += 1) {
      if (phraseWords.every((word, offset) => words[index + offset] === word)) total += cue.weight;
    }
    return total;
  }, 0);
}

function sentimentLabel(score: number) {
  if (score >= 0.75) return 'strongly_positive';
  if (score >= 0.2) return 'positive';
  if (score <= -0.75) return 'strongly_negative';
  if (score <= -0.2) return 'negative';
  return 'neutral';
}