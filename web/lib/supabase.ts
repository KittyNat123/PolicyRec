// =====================================================================
// Supabase 서버 클라이언트
// =====================================================================
// 이 파일은 "서버 전용"입니다. 절대 클라이언트(브라우저)로 import 되면 안 됩니다.
// SERVICE_KEY는 RLS(Row Level Security)를 무시하고 모든 데이터에 접근할 수 있는
// 강력한 권한 키이기 때문에, 노출되면 DB 전체가 위험해집니다.
//
// Next.js의 Route Handler (/api/*) 안에서만 사용하세요.
// =====================================================================

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

// 환경변수 누락 시 조기에 실패하도록 — 배포 후 의문의 500 에러를 미리 막아줍니다.
if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error(
    "환경변수 SUPABASE_URL / SUPABASE_SERVICE_KEY가 설정되지 않았습니다. " +
      "web/.env.local 파일을 확인하세요."
  );
}

export const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    // 서버 환경에서는 사용자 세션을 저장할 일이 없으므로 비활성화
    persistSession: false,
  },
});
