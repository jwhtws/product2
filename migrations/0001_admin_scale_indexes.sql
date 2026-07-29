-- product1의 D1 스키마 기준 저장소에도 동일하게 반영해야 한다.
CREATE INDEX IF NOT EXISTS reviews_created_idx ON reviews(created_at DESC, id DESC);
