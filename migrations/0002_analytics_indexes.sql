-- 기간별 회원 증가 집계용 인덱스
CREATE INDEX IF NOT EXISTS users_created_idx ON users(created_at DESC, id DESC);
