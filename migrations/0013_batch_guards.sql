-- D1 cannot run UPDATE inside WITH, and integer division by zero returns NULL
-- instead of failing the statement. Scan charges and refunds abort a batch by
-- inserting ok = 0, which violates this check and rolls the whole batch back.
CREATE TABLE batch_guards (
  id INTEGER PRIMARY KEY,
  ok INTEGER NOT NULL CHECK (ok = 1)
);
