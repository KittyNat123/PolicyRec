// =====================================================================
// Gemini 임베딩 클라이언트
// =====================================================================
// 사용자가 입력한 검색어 텍스트를 768차원 숫자 벡터(embedding)로 바꿉니다.
// 이 벡터를 Supabase RPC `match_announcements_hybrid`에 넘기면,
// DB에 저장된 공고 임베딩들과 비교해 의미가 가까운 공고를 찾아줍니다.
//
// 중요: DB 적재 시점(v1.2.3 노트북)과 같은 모델·차원·SDK 패밀리를 써야
//       비교가 의미를 갖습니다. 다른 모델이면 같은 768차원이라도 결과가 엉터리.
//
// 모델: gemini-embedding-001 (768차원)
// task_type:
//   - 적재 시: RETRIEVAL_DOCUMENT (v1.2.3 노트북에서 사용)
//   - 검색 시: RETRIEVAL_QUERY  (여기서 사용)
//   같은 모델이라도 task_type이 다르면 임베딩이 약간 달라서, "검색 vs 문서"
//   대비가 더 정확해집니다.
//
// 이 파일도 서버 전용입니다. GEMINI_API_KEY는 절대 클라이언트로 노출 X.
// =====================================================================

import { GoogleGenAI } from "@google/genai";

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  throw new Error(
    "환경변수 GEMINI_API_KEY가 설정되지 않았습니다. " +
      "web/.env.local 파일을 확인하세요."
  );
}

const ai = new GoogleGenAI({ apiKey });

const EMBEDDING_MODEL = "gemini-embedding-001";
const EMBEDDING_DIMENSION = 768;

/**
 * 검색어 텍스트 → 768차원 벡터.
 *
 * @param query  사용자 입력 텍스트 (예: "25살 청년이 받을 수 있는 창업 지원")
 * @returns      길이 768인 number 배열
 * @throws       응답이 비었거나 차원이 안 맞으면 에러
 */
export async function getQueryEmbedding(query: string): Promise<number[]> {
  const response = await ai.models.embedContent({
    model: EMBEDDING_MODEL,
    contents: query,
    config: {
      taskType: "RETRIEVAL_QUERY",
      outputDimensionality: EMBEDDING_DIMENSION,
    },
  });

  // SDK 응답 구조: { embeddings: [ { values: number[] } ] }
  const embedding = response.embeddings?.[0]?.values;

  if (!embedding) {
    throw new Error("Gemini 임베딩 응답이 비어있습니다.");
  }
  if (embedding.length !== EMBEDDING_DIMENSION) {
    throw new Error(
      `임베딩 차원이 예상과 다릅니다. 기대: ${EMBEDDING_DIMENSION}, 실제: ${embedding.length}`
    );
  }
  return embedding;
}
