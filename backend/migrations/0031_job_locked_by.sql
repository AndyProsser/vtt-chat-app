-- Which worker holds a running job's lease (WORKER_ID). A restarting worker with the same id takes its
-- own jobs back at once instead of waiting out the lease; leases held by other ids are still honoured.
ALTER TABLE jobs ADD COLUMN locked_by TEXT;
