-- Mirrors FullAssessmentResult.sq's new training_location column (Gym/Rumah question asked
-- before equipment_preference).
alter table public.full_assessment_result
    add column if not exists training_location text;
