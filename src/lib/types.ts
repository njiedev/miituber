export enum FFLExpression {
  Normal = 0,
  Smile = 1,
  Anger = 2,
  Sorrow = 3,
  Surprise = 4,
  Blink = 5,
  OpenMouth = 6,
  Happy = 7,
  AngerOpenMouth = 8,
  SorrowOpenMouth = 9,
  SurpriseOpenMouth = 10,
  BlinkOpenMouth = 11,
  WinkLeft = 12,
  WinkRight = 13,
  WinkLeftOpenMouth = 14,
  WinkRightOpenMouth = 15,
  Like = 16,
  LikeWinkRight = 17,
  Frustrated = 18,
}

export const FFL_EXPRESSION_LABELS: Record<FFLExpression, string> = {
  [FFLExpression.Normal]: "Normal",
  [FFLExpression.Smile]: "Smile",
  [FFLExpression.Anger]: "Anger",
  [FFLExpression.Sorrow]: "Sorrow",
  [FFLExpression.Surprise]: "Surprise",
  [FFLExpression.Blink]: "Blink",
  [FFLExpression.OpenMouth]: "Open mouth",
  [FFLExpression.Happy]: "Happy",
  [FFLExpression.AngerOpenMouth]: "Anger open mouth",
  [FFLExpression.SorrowOpenMouth]: "Sorrow open mouth",
  [FFLExpression.SurpriseOpenMouth]: "Surprise open mouth",
  [FFLExpression.BlinkOpenMouth]: "Blink open mouth",
  [FFLExpression.WinkLeft]: "Wink left",
  [FFLExpression.WinkRight]: "Wink right",
  [FFLExpression.WinkLeftOpenMouth]: "Wink left open mouth",
  [FFLExpression.WinkRightOpenMouth]: "Wink right open mouth",
  [FFLExpression.Like]: "Like",
  [FFLExpression.LikeWinkRight]: "Like wink right",
  [FFLExpression.Frustrated]: "Frustrated",
};

export type BlendshapeCategory = {
  categoryName: string;
  score: number;
};

export type HeadRotation = {
  pitch: number;
  yaw: number;
  roll: number;
};

export type ExpressionResult = {
  expressionIndex: FFLExpression;
  headRotation: HeadRotation;
  scores: ExpressionScores;
  channels: ExpressionChannels;
};

export type ExpressionScores = {
  mouthOpen: number;
  smile: number;
  blinkLeft: number;
  blinkRight: number;
  anger: number;
  sorrow: number;
  surprise: number;
};

export type ExpressionSignals = {
  mouthOpen: boolean;
  smile: boolean;
  blinkLeft: boolean;
  blinkRight: boolean;
  anger: boolean;
  sorrow: boolean;
  surprise: boolean;
};

export type EyeState = "open" | "blink_both" | "wink_left" | "wink_right";

export type MouthState = "closed" | "open";

export type EmotionState = "normal" | "smile" | "anger" | "sorrow" | "surprise";

export type ExpressionChannels = {
  eyes: EyeState;
  mouth: MouthState;
  emotion: EmotionState;
};
