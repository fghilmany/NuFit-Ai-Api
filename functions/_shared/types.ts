// TypeScript mirrors of the Kotlin DTOs (kotlinx.serialization -- no @SerialName overrides seen,
// so JSON keys equal the Kotlin property names verbatim). Keep these in lockstep with:
//   shared/src/commonMain/kotlin/com/fghilmany/nufitai/data/aicustomplan/model/AiPlanRequestDto.kt
//   shared/src/commonMain/kotlin/com/fghilmany/nufitai/data/aicustomplan/model/AiPlanResponseDto.kt
//   shared/src/commonMain/kotlin/com/fghilmany/nufitai/data/chatai/model/ChatSendRequestDto.kt
//   shared/src/commonMain/kotlin/com/fghilmany/nufitai/data/chatai/model/ChatSendResponseDto.kt
//   shared/src/commonMain/kotlin/com/fghilmany/nufitai/data/mealplan/model/MealPlanRequestDto.kt
//   shared/src/commonMain/kotlin/com/fghilmany/nufitai/data/mealplan/model/MealPlanResponseDto.kt

// ---------- AI Custom Plan ----------

export interface AiPlanFormInputDto {
  goal: string;
  sessionsPerWeek: number;
  sessionDurationMinutes: number;
  equipmentPreference: string[];
  muscleFocus: string[];
  planDurationWeeks: number;
}

export interface FullAssessmentDto {
  age: number | null;
  gender: string | null;
  parQCategoryB: string[];
  equipmentPreference: string[];
  injuryHistory: string[];
  injuryHistoryNote: string | null;
  flagsPostural: string[];
  movementFlags: string[];
  goal: string;
  sessionsPerWeek: number;
  selectedWeekdays: number[];
  sessionDurationMinutes: number;
}

export interface WorkoutHistorySummaryDto {
  cycleCount: number;
  attendanceRate: number;
  averageRpe: number | null;
  completedSessionCount: number;
}

export interface AiPlanRequestDto {
  formInput: AiPlanFormInputDto;
  fullAssessment: FullAssessmentDto;
  workoutHistorySummary: WorkoutHistorySummaryDto;
}

export interface AiPlanExerciseDto {
  exerciseId: string;
  sets: number;
  repRangeOrDuration: string;
  rpeTargetMin: number;
  rpeTargetMax: number;
  restSeconds: number | null;
}

export interface AiPlanDayDto {
  dayNumber: number;
  type: string; // DayType enum name
  templateLetter: string | null;
  mainExercises: AiPlanExerciseDto[];
}

export interface AiPlanConflictDto {
  field: string;
  note: string;
}

export interface AiPlanResponseDto {
  smartGoalSummary: string;
  days: AiPlanDayDto[];
  conflicts: AiPlanConflictDto[];
}

// ---------- Chat ----------

export interface ChatSendRequestDto {
  message: string;
  conversationHistoryLimit: number;
}

export interface ExerciseSuggestionDto {
  exerciseId: string;
  replacesExerciseId: string | null;
}

export interface ChatReplyDto {
  text: string;
  exerciseSuggestion: ExerciseSuggestionDto | null;
  suggestedReplies: string[];
}

export interface ChatQuotaDto {
  used: number;
  max: number;
  resetsAt: string; // ISO-8601, parsed client-side via Instant.parse
}

export interface ChatSendResponseDto {
  reply: ChatReplyDto;
  quota: ChatQuotaDto;
}

// ---------- Meal Plan ----------

export interface MacroTargetDto {
  calories: number;
  proteinG: number;
  carbG: number;
  fatG: number;
}

export interface MealPreferenceDto {
  cuisineThemes: string[];
  mood: string | null;
  allergies: string[];
  scheduleMode: string;
}

export interface MealPlanRequestDto {
  target: MacroTargetDto;
  goal: string;
  preference: MealPreferenceDto;
}

export interface PlannedMealDto {
  slot: string; // MealSlot enum name
  name: string;
  description: string;
  ingredients: string[];
  macros: MacroTargetDto;
  prepMinutes: number;
  tag: string;
}

export interface MealPlanDayDto {
  dayNumber: number;
  meals: PlannedMealDto[];
}

export interface MealPlanResponseDto {
  days: MealPlanDayDto[];
}

// ---------- Shared ----------

export type Capability = "AI_CUSTOM_PLAN" | "CHAT_AI_BASIC" | "CHAT_AI_PRO" | "MEAL_PLAN";
export type Tier = "GUEST" | "LOGGED_IN" | "SUBSCRIBED";

export interface ExerciseRow {
  id: string;
  name: string;
  equipment_category: string;
  movement_pattern: string;
  level: string;
  primary_muscle_group: string;
  target_muscles_primary: string[];
  target_muscles_secondary: string[];
  flag_exclusion: string[];
  flag_priority: string[];
  instructions_id: string | null;
  common_mistakes_id: string | null;
  safety_tips_id: string | null;
}
