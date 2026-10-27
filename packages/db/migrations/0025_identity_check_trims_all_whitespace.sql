-- 0025 (S2L-1c): the identity CHECK on lead_events trims ALL whitespace, not only spaces. From the V audit of #129 (P3).
--
-- 0023's lead_value_identity_free ran btrim(p), which strips spaces only. A bare 10 or 11 digit phone number padded with a tab,
-- a newline, a carriage return, a no-break space or an ideographic space was stored by the database, while the JS scan
-- (String.prototype.trim) refused it. The same value now gets the same answer in both layers: the trim removes the characters
-- JavaScript's trim() removes (line terminators, ASCII whitespace, Unicode space separators, the BOM).
--
-- Only the function body changes (same name, same signature, same owner), so the CHECK constraints that call it are untouched.
-- The cases live in db/test/lead-identity-cases.json and run against both layers. 0023 is not edited.
CREATE OR REPLACE FUNCTION lead_value_identity_free(p text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog AS $$
DECLARE s text; d int;
BEGIN
  IF p IS NULL THEN RETURN true; END IF;
  s := regexp_replace(p, '^[\t\n\v\f\r    -     　﻿]+|[\t\n\v\f\r    -     　﻿]+$', '', 'g');
  IF s ~ '[^[:space:]@"]+@[^[:space:]@"]+\.[A-Za-z]{2,}' THEN RETURN false; END IF;
  IF s ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN RETURN true; END IF;
  d := length(regexp_replace(s, '[^0-9]', '', 'g'));
  IF s ~ '^[+(]?[0-9][0-9 ()./+-]*$' THEN
    IF s ~ '^[0-9]+$' THEN RETURN d NOT IN (10, 11); END IF;
    RETURN d < 7;
  END IF;
  RETURN true;
END $$;
