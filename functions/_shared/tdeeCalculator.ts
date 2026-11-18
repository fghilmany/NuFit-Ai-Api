// Port of shared/.../usecase/mealplan/CalculateTdeeAndMacros.kt -- same formula, same constants.
// Chat AI needed TDEE/macro grounding (2026-11-18 BeginFit comparison: without this, the LLM
// computed calories/macros freehand in prose, diverging from the app's own Meal Plan numbers for
// the same user). Keep these two files' constants and formula in sync manually if either changes --
// no shared module between Kotlin and Deno here.
const PROTEIN_G_PER_KG = 1.8;
const FAT_CALORIE_SHARE = 0.25;
const KCAL_PER_G_FAT = 9;
const KCAL_PER_G_CARB = 4;
const FAT_LOSS_MULTIPLIER = 0.85;
const MUSCLE_GAIN_MULTIPLIER = 1.10;

const ACTIVITY_MULTIPLIER: Record<string, number> = {
  SEDENTARY: 1.2,
  LIGHT: 1.375,
  MODERATE: 1.55,
  ACTIVE: 1.725,
  VERY_ACTIVE: 1.9,
};

const GOAL_MULTIPLIER: Record<string, number> = {
  FAT_LOSS: FAT_LOSS_MULTIPLIER,
  MUSCLE_GAIN: MUSCLE_GAIN_MULTIPLIER,
};

export interface TdeeMacroInput {
  heightCm: number;
  weightKg: number;
  age: number;
  gender: "MALE" | "FEMALE" | string;
  activityLevel: string;
  goal?: string | null;
}

export interface MacroTarget {
  calories: number;
  proteinG: number;
  carbG: number;
  fatG: number;
}

export class TdeeInputIncompleteError extends Error {}

export function calculateTdeeAndMacros(input: TdeeMacroInput): MacroTarget {
  const { heightCm, weightKg, age, gender, activityLevel, goal } = input;
  if (!heightCm || !weightKg || !age || !gender || !activityLevel) {
    throw new TdeeInputIncompleteError("Data tubuh/aktivitas belum lengkap");
  }

  const activityMultiplier = ACTIVITY_MULTIPLIER[activityLevel];
  if (!activityMultiplier) throw new TdeeInputIncompleteError(`Unknown activityLevel: ${activityLevel}`);

  const bmr = gender === "MALE"
    ? 10 * weightKg + 6.25 * heightCm - 5 * age + 5
    : 10 * weightKg + 6.25 * heightCm - 5 * age - 161;
  const tdee = bmr * activityMultiplier;

  const goalMultiplier = goal ? (GOAL_MULTIPLIER[goal] ?? 1.0) : 1.0;
  const calories = tdee * goalMultiplier;

  const proteinG = PROTEIN_G_PER_KG * weightKg;
  const fatG = (calories * FAT_CALORIE_SHARE) / KCAL_PER_G_FAT;
  const carbG = (calories - proteinG * KCAL_PER_G_CARB - fatG * KCAL_PER_G_FAT) / KCAL_PER_G_CARB;

  return {
    calories: Math.round(calories),
    proteinG: Math.round(proteinG),
    carbG: Math.round(carbG),
    fatG: Math.round(fatG),
  };
}
