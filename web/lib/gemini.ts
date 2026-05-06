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
const CHAT_MODELS = [
  "gemini-3-flash-preview",
  "gemini-3.1-flash-lite-preview",
  "gemini-2.5-flash-lite",
] as const;
const EMBEDDING_DIMENSION = 768;
const POLICY_SYSTEM_INSTRUCTION = `
너는 정부 지원사업 추천 전문가다.
사용자의 상황에 맞는 정책을 추천하고,
가능하면 신청 방법까지 설명하라.
만약 상세 링크가 없다면, 대안 방법이나 추가 정보를 안내하라.
한국어로 짧고 실용적으로 답하라.
`.trim();

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

export type RagPolicyContext = {
  title: string;
  summary: string | null;
  provider: string | null;
  region: string | null;
  s_category: string | null;
  target_group: string | null;
  target_tags: string[] | null;
  support_type: string | null;
  application_method?: string | null;
  required_documents?: string | null;
  additional_conditions?: string | null;
  apply_start_dt: string | null;
  apply_end_dt: string | null;
  detail_url: string | null;
};

export type RagHistoryMessage = {
  role: "user" | "assistant";
  content: string;
};

async function generateWithFallback(prompt: string, maxOutputTokens = 700) {
  let lastError: unknown = null;
  for (const model of CHAT_MODELS) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: {
          systemInstruction: POLICY_SYSTEM_INSTRUCTION,
          temperature: 0.3,
          maxOutputTokens,
        },
      });

      const text = response.text?.trim();
      if (text) return text;
      lastError = new Error(`${model} 답변 응답이 비어있습니다.`);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Gemini 답변 생성에 실패했습니다.");
}

function formatRecentHistory(history: RagHistoryMessage[]) {
  return history
    .slice(-8)
    .map((message) => `${message.role === "user" ? "사용자" : "챗봇"}: ${message.content}`)
    .join("\n");
}

function compactPolicy(policy: RagPolicyContext, index: number) {
  return [
    `[${index + 1}] ${policy.title}`,
    policy.provider ? `기관: ${policy.provider}` : null,
    policy.region ? `지역: ${policy.region}` : null,
    policy.s_category ? `분야: ${policy.s_category}` : null,
    policy.support_type ? `지원유형: ${policy.support_type}` : null,
    policy.target_group ? `대상: ${policy.target_group}` : null,
    policy.target_tags?.length ? `대상태그: ${policy.target_tags.join(", ")}` : null,
    policy.apply_start_dt ? `시작일: ${policy.apply_start_dt}` : null,
    policy.apply_end_dt ? `마감일: ${policy.apply_end_dt}` : null,
    policy.summary ? `요약: ${policy.summary}` : null,
    policy.application_method ? `신청방법: ${policy.application_method}` : null,
    policy.required_documents ? `제출서류: ${policy.required_documents}` : null,
    policy.additional_conditions ? `추가조건: ${policy.additional_conditions}` : null,
    policy.detail_url
      ? `상세링크: ${policy.detail_url}`
      : "상세링크: 없음. 공식 링크가 없으므로 공고명 검색이 필요함",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function generatePolicyAnswer({
  question,
  policies,
  history,
}: {
  question: string;
  policies: RagPolicyContext[];
  history: RagHistoryMessage[];
}): Promise<string> {
  const recentHistory = formatRecentHistory(history);
  const context =
    policies.length > 0
      ? policies.map(compactPolicy).join("\n\n")
      : "검색된 정책 없음";

  const prompt = `
규칙:
- 아래 검색 결과에 있는 정책만 근거로 답한다.
- 확실하지 않은 내용은 추정하지 말고 "확인 필요"라고 말한다.
- 상세 링크가 없는 정책은 공식 링크가 없다고 설명하고, 신청 방법/제공 기관/공고명 검색 같은 대안 확인 방법을 안내한다.
- 답변은 3~6문장 정도로 쓰고, 마지막에 추천 정책명을 1~3개만 짧게 나열한다.
- 사용자가 비교/조건을 물으면 조건에 맞는 이유를 간단히 말한다.

최근 대화:
${recentHistory || "없음"}

현재 질문:
${question}

검색 결과:
${context}
`.trim();

  return generateWithFallback(prompt, 700);
}

export async function generateGeneralPolicyReply({
  question,
  history,
}: {
  question: string;
  history: RagHistoryMessage[];
}): Promise<string> {
  const recentHistory = formatRecentHistory(history);
  const prompt = `
사용자가 정책 검색 조건을 아직 말하지 않았거나 가벼운 인사/잡담을 했다.
정책을 억지로 추천하지 말고, 자연스럽게 응답한 뒤 어떤 정보를 주면 추천할 수 있는지 안내하라.

좋은 답변 예시:
"안녕하세요! 궁금한 걸 물어보세요. 지역, 나이, 관심 분야나 창업 단계가 있으면 더 잘 맞는 정책을 추천해드릴게요."

최근 대화:
${recentHistory || "없음"}

사용자 메시지:
${question}
`.trim();

  return generateWithFallback(prompt, 300);
}
