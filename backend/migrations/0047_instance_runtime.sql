-- A disposable mirror of the backend's in-memory online-user count (presence.ts), so the records
-- worker can read "is anyone around" without depending on Valkey or the backend process. Never a
-- source of truth for presence itself (presence.ts stays in-memory, rebuilt for free after a
-- restart) -- a fresh install or restore safely defaults this to 0.
CREATE TABLE instance_runtime (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  online_users INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO instance_runtime (id) VALUES (1);
