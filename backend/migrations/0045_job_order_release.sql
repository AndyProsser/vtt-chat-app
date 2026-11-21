-- One table's sessions are processed in the order they were recorded (the queue holds a session's job while an
-- earlier session of the same campaign has a job that is queued, running or failed). That keeps campaign memory in
-- order: session 3's tale must know what session 2 added. An operator who decides a failed earlier job should no
-- longer hold the later ones back "releases" it (`vtt-admin jobs release <job-id>`), and this flag records that.
ALTER TABLE jobs ADD COLUMN order_released BOOLEAN NOT NULL DEFAULT false;
