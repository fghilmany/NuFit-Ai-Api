// Translates domain enum names (sent raw over the wire, matching the Kotlin enum's `.name`) to
// plain Indonesian words before they go into an LLM prompt. Without this, the model echoes the
// literal enum token back into generated prose ("fokus CARDIO", "peralatan MACHINE_CABLE")
// instead of writing natural language -- it only ever saw the raw token, so that's what it wrote.
// Unknown values fall through unchanged rather than throwing, since this is cosmetic (prompt
// readability), not a correctness-critical mapping.

const GOAL_LABELS: Record<string, string> = {
  FAT_LOSS: "menurunkan lemak tubuh",
  MUSCLE_GAIN: "membangun otot",
  GENERAL_HEALTH: "menjaga kesehatan & kebugaran",
  STRENGTH: "meningkatkan kekuatan",
  ENDURANCE: "meningkatkan daya tahan",
};

const EQUIPMENT_LABELS: Record<string, string> = {
  BODYWEIGHT: "berat badan sendiri",
  DUMBBELL: "dumbbell",
  BARBELL: "barbell",
  KETTLEBELL: "kettlebell",
  MACHINE_CABLE: "mesin & kabel",
  PULL_UP_BAR: "pull-up bar",
  CARDIO_EQUIPMENT: "alat kardio",
  MEDICINE_BALL: "medicine ball",
  STABILITY_BALL: "stability ball",
  RESISTANCE_BAND: "resistance band",
  ROLLER: "foam roller",
};

const MUSCLE_GROUP_LABELS: Record<string, string> = {
  LEG: "kaki",
  CHEST: "dada",
  BACK: "punggung",
  SHOULDER: "bahu",
  ARM: "lengan",
  CORE: "core/perut",
  GLUTES: "glutes/bokong",
  CARDIO: "kardio",
};

export const goalLabel = (goal: string): string => GOAL_LABELS[goal] ?? goal;
export const equipmentLabel = (equipment: string): string => EQUIPMENT_LABELS[equipment] ?? equipment;
export const muscleGroupLabel = (muscle: string): string => MUSCLE_GROUP_LABELS[muscle] ?? muscle;
