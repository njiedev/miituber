import {
  FFL_EXPRESSION_LABELS,
  FFLExpression,
  type BlendshapeCategory,
  type ExpressionChannels,
} from "./types";

export function formatExpressionScores(scores: {
  smile: number;
  mouthOpen: number;
  blinkLeft: number;
  blinkRight: number;
  anger: number;
  sorrow: number;
  surprise: number;
}) {
  return [
    `smile ${formatScore(scores.smile)}`,
    `mouth ${formatScore(scores.mouthOpen)}`,
    `blink ${formatScore(Math.max(scores.blinkLeft, scores.blinkRight))}`,
    `anger ${formatScore(scores.anger)}`,
    `sad ${formatScore(scores.sorrow)}`,
    `surprise ${formatScore(scores.surprise)}`,
  ].join(", ");
}

export function formatTopBlendshapes(blendshapes: BlendshapeCategory[]) {
  const active = blendshapes
    .filter(({ score }) => score >= 0.05)
    .sort((left, right) => right.score - left.score)
    .slice(0, 5)
    .map(({ categoryName, score }) => `${categoryName} ${formatScore(score)}`);

  return active.length > 0 ? active.join(", ") : "none";
}

export function formatScore(score: number) {
  return score.toFixed(2);
}

export function expressionLabel(expressionIndex: number) {
  const label = FFL_EXPRESSION_LABELS[expressionIndex as FFLExpression];
  return label ? `${expressionIndex} ${label}` : String(expressionIndex);
}

export function formatChannels(channels: ExpressionChannels) {
  return `eyes ${channels.eyes}, mouth ${channels.mouth}, emotion ${channels.emotion}`;
}
