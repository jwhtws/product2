CREATE INDEX IF NOT EXISTS idx_activity_events_type_created
  ON activity_events(event_type, created_at);
