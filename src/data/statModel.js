export const sliderConfig = [
  {
    key: 'threePointPct',
    label: '3-Point %',
    min: 0,
    max: 100,
    default: 35,
    unit: '%',
    direction: 1,
    average: 35,
    weight: 0.25,
  },
  {
    key: 'fgPct',
    label: 'Field Goal %',
    min: 0,
    max: 100,
    default: 45,
    unit: '%',
    direction: 1,
    average: 46,
    weight: 0.30,
  },
  {
    key: 'turnovers',
    label: 'Turnovers',
    min: 0,
    max: 30,
    default: 14,
    unit: '',
    direction: -1,
    average: 14,
    weight: 0.20,
  },
  {
    key: 'rebounds',
    label: 'Rebounds',
    min: 0,
    max: 60,
    default: 40,
    unit: '',
    direction: 1,
    average: 40,
    weight: 0.15,
  },
  {
    key: 'ftPct',
    label: 'Free Throw %',
    min: 0,
    max: 100,
    default: 75,
    unit: '%',
    direction: 1,
    average: 77,
    weight: 0.10,
  },
];

// Returns win probability 0-100 as an integer.
// Each stat is normalized relative to its average (how far above/below average),
// then weighted and summed. Result is clamped so defaults produce ~50%.
export function calcWinProb(values) {
  let score = 0;

  for (const config of sliderConfig) {
    const val = values[config.key];
    const range = config.max - config.min;
    const deviation = ((val - config.average) / (range / 2)) * config.direction;
    score += deviation * config.weight;
  }

  const prob = 50 + score * 50;
  return Math.round(Math.max(0, Math.min(100, prob)));
}

export function defaultValues() {
  return Object.fromEntries(sliderConfig.map((c) => [c.key, c.default]));
}
