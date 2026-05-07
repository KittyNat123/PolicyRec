-- saved_chats 테이블 생성 DDL
-- 보미님께서 Supabase SQL Editor에서 적용해 주세요.
-- 적용 전제: users(login_id), announcements(id) 테이블이 이미 존재합니다.
-- content에는 사용자가 저장한 챗봇 대화 전체 텍스트를 저장합니다.

CREATE TABLE IF NOT EXISTS saved_chats (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  login_id VARCHAR NOT NULL REFERENCES users(login_id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  ann_ids BIGINT[] NOT NULL DEFAULT '{}'::BIGINT[],
  created_dt TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_saved_chats_login_date
ON saved_chats (login_id, created_dt DESC);

-- PostgREST/Supabase API 스키마 캐시 갱신
NOTIFY pgrst, 'reload schema';
