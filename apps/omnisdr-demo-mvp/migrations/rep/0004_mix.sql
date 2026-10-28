-- Allowance mix (Christian 2026-10-28): the voice-minutes and texts split chosen on a pilot quote. JSON of
-- { position, minutes, texts, threads, plan }. Price, allowance and pay are not stored here and never change with it.
ALTER TABLE deals ADD COLUMN mix TEXT;
