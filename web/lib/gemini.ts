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
사용자의 상황에 맞는 정책을 추천하고, 신청 방법과 필요 서류까지 짧게 안내하라.
만약 상세 링크가 없다면, 대안 방법이나 추가 정보를 안내하라.

[신청 가이드 규칙 — 매우 중요]
- 검색 결과에 적혀 있는 "신청방법", "제출서류" 값만 사용하라. 절대 추측·창작하지 마라.
- 검색 결과에 "(정보 없음 ...)"으로 표시된 항목은 그 문구 그대로 받아들이고,
  신청방법이 없으면 "신청방법은 공고문/상세 링크 확인 필요",
  제출서류가 없으면 "제출서류는 공고문 확인 필요"라고 답하라.
- 서류 이름이나 신청 절차를 임의로 만들어내지 마라. 일반 상식이라도 추측은 금지다.
- 신청방법이 길면 핵심 한두 가지(예: "온라인 신청 (xx포털)")로 줄여 말하라.

[개인 맞춤 추천 요청 규칙 — 매우 중요]
사용자가 "나에게 맞는", "나랑 맞는", "추천", "맞춤" 같은 개인 맞춤형 추천을 요청했는데
대화 히스토리(시스템 컨텍스트 포함)에 다음 정보가 부족하면, 추천을 시도하지 말고
필요한 정보를 먼저 친절하게 물어라:
  - 거주 지역 (시·도 단위)
  - 나이 (또는 청년/중장년 등 연령대)
  - 관심 분야 (창업, 주거, 취업, 교육, 자금 지원 등)
  - 현재 상황 (구직 중/창업 준비 중/재직 중/학생 등)

질문 예시 형식:
"더 정확한 추천을 위해 몇 가지만 알려주세요!
1. 어디에 거주하세요? (예: 서울, 경기도, 대구 등)
2. 나이가 어떻게 되세요? (또는 연령대)
3. 어떤 분야가 궁금하세요? (창업/주거/취업/자금 등)
이 중 알려주시는 만큼 더 적합한 정책을 찾아드릴게요."

이미 일부 정보가 있으면, 부족한 정보만 콕 집어서 추가 질문하라.
정보 없이 여러 카테고리 정책을 나열하는 식의 답변은 절대 하지 마라.

[답변 길이 규칙]
- 인사/짧은 질문/단순 확인 질문에는 1~2문장으로 짧게 답하라.
- 정책 추천이나 비교 같은 정보성 질문은 핵심만 5~8줄로 정리하라.
- 불필요한 도입부("좋은 질문입니다", "안녕하세요" 등)는 생략하고 본론부터 시작하라.
- 마크다운 굵게(**) 표기는 사용하지 마라.
- 필요할 때만 길게 쓰고, 답변이 길어질 것 같으면 가장 중요한 정보부터 위로 배치하라.
한국어로 답하라.
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

// 로그인 사용자의 프로필 컨텍스트 (저장된 필터 + 회원 정보)
export type RagUserContext = {
  loginId?: string | null;
  region?: string | null;
  category?: string | null;
  targetAge?: number | null;
  userType?: string | null;
};

export type SelfQueryFilters = {
  region: string | null;
  target_age: number | null;
  category: string | null;
  semantic_query: string;
  confidence: number;
  applied: boolean;
  reason?: string;
};

const SELF_QUERY_CONFIDENCE_THRESHOLD = 0.7;
const SELF_QUERY_SYSTEM_INSTRUCTION = `
너는 정책 검색 서비스의 Self-Query 필터 추출기다.
사용자의 자연어 질문에서 검색 필터로 쓸 수 있는 메타데이터만 추출한다.
반드시 JSON만 출력한다. 설명, 마크다운, 코드블록은 출력하지 않는다.

추출 대상:
- region: 지역. 허용값 중 하나 또는 null.
- target_age: 사용자의 정확한 나이 숫자 또는 null.
- category: 정책 카테고리. 허용값 중 하나 또는 null.
- semantic_query: 필터 표현을 제거하거나 완화한 검색용 질의문.
- confidence: 0부터 1 사이 숫자.

허용 region:
["전국","서울특별시","부산광역시","대구광역시","인천광역시","광주광역시","대전광역시","울산광역시","세종특별자치시","경기도","강원특별자치도","충청북도","충청남도","전북특별자치도","전라남도","경상북도","경상남도","제주특별자치도"]

허용 category:
["창업","경영","기술","인력/일자리","판로/수출","자금","교육/멘토링","시설/공간","행사/네트워크","주거","복지/문화","기타"]

정규화 규칙:
- "서울" → "서울특별시", "대구" → "대구광역시", "경기" → "경기도", "충남" → "충청남도", "전북" → "전북특별자치도"처럼 DB 값으로 변환한다.
- "취업", "일자리", "구직", "채용", "인턴" → "인력/일자리"
- "창업", "스타트업", "예비창업" → "창업"
- "자금", "지원금", "융자", "대출", "보조금" → "자금"
- "주거", "월세", "전세", "임대" → "주거"
- "교육", "멘토링", "강의" → "교육/멘토링"
- 정확한 나이가 없고 "청년", "20대", "대학생"만 있으면 target_age는 null.
- 질문이 예시, 비교, 부정 맥락이면 필터로 확정하지 않는다.
- 확신이 낮으면 null을 사용한다.
`.trim();

const ALLOWED_SELF_QUERY_REGIONS = [
  "전국",
  "서울특별시",
  "부산광역시",
  "대구광역시",
  "인천광역시",
  "광주광역시",
  "대전광역시",
  "울산광역시",
  "세종특별자치시",
  "경기도",
  "강원특별자치도",
  "충청북도",
  "충청남도",
  "전북특별자치도",
  "전라남도",
  "경상북도",
  "경상남도",
  "제주특별자치도",
] as const;

const ALLOWED_SELF_QUERY_CATEGORIES = [
  "창업",
  "경영",
  "기술",
  "인력/일자리",
  "판로/수출",
  "자금",
  "교육/멘토링",
  "시설/공간",
  "행사/네트워크",
  "주거",
  "복지/문화",
  "기타",
] as const;

const REGION_ALIASES: Record<string, string> = {
  서울: "서울특별시",
  부산: "부산광역시",
  대구: "대구광역시",
  인천: "인천광역시",
  광주: "광주광역시",
  대전: "대전광역시",
  울산: "울산광역시",
  세종: "세종특별자치시",
  경기: "경기도",
  강원: "강원특별자치도",
  충북: "충청북도",
  충남: "충청남도",
  전북: "전북특별자치도",
  전남: "전라남도",
  경북: "경상북도",
  경남: "경상남도",
  제주: "제주특별자치도",
};

const CATEGORY_ALIASES: Record<string, string> = {
  취업: "인력/일자리",
  일자리: "인력/일자리",
  구직: "인력/일자리",
  채용: "인력/일자리",
  인턴: "인력/일자리",
  스타트업: "창업",
  예비창업: "창업",
  지원금: "자금",
  융자: "자금",
  대출: "자금",
  보조금: "자금",
  월세: "주거",
  전세: "주거",
  임대: "주거",
  교육: "교육/멘토링",
  멘토링: "교육/멘토링",
  강의: "교육/멘토링",
};

const SELF_QUERY_CACHE_MAX = 200;
const selfQueryCache = new Map<string, SelfQueryFilters>();

function cloneSelfQueryFilters(value: SelfQueryFilters): SelfQueryFilters {
  return { ...value };
}

function rememberSelfQueryFilters(
  query: string,
  value: SelfQueryFilters
): SelfQueryFilters {
  if (!selfQueryCache.has(query) && selfQueryCache.size >= SELF_QUERY_CACHE_MAX) {
    const oldestKey = selfQueryCache.keys().next().value;
    if (oldestKey) selfQueryCache.delete(oldestKey);
  }
  selfQueryCache.set(query, cloneSelfQueryFilters(value));
  return value;
}

export function hasSelfQueryFilterSignal(query: string) {
  const compact = query.replace(/\s/g, "");
  if (!compact) return false;
  if (/(?:만)?\d{1,3}(?:세|살)/.test(compact)) return true;

  const tokens = [
    ...ALLOWED_SELF_QUERY_REGIONS,
    ...Object.keys(REGION_ALIASES),
    ...ALLOWED_SELF_QUERY_CATEGORIES,
    ...Object.keys(CATEGORY_ALIASES),
  ];
  return tokens.some((token) => compact.includes(token.replace(/\s/g, "")));
}

function emptySelfQueryResult(query: string, reason: string): SelfQueryFilters {
  return {
    region: null,
    target_age: null,
    category: null,
    semantic_query: query,
    confidence: 0,
    applied: false,
    reason,
  };
}

function stripJsonFence(text: string) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) return fenced[1].trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
  return trimmed;
}

function normalizeAllowedValue(
  value: unknown,
  allowed: readonly string[],
  aliases: Record<string, string>
) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const normalized = aliases[trimmed] ?? trimmed;
  return allowed.includes(normalized) ? normalized : null;
}

function normalizeTargetAge(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  return rounded >= 0 && rounded <= 120 ? rounded : null;
}

async function generateSelfQueryJson(query: string) {
  let lastError: unknown = null;
  for (const model of CHAT_MODELS) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: `사용자 질문:\n${query}`,
        config: {
          systemInstruction: SELF_QUERY_SYSTEM_INSTRUCTION,
          temperature: 0,
          maxOutputTokens: 320,
          responseMimeType: "application/json",
        },
      });
      const text = response.text?.trim();
      if (text) {
        const jsonText = stripJsonFence(text);
        try {
          JSON.parse(jsonText);
          return jsonText;
        } catch (error) {
          lastError = error;
          continue;
        }
      }
      lastError = new Error(`${model} self-query response was empty.`);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Self-query extraction failed.");
}

export async function extractSelfQueryFilters(
  query: string
): Promise<SelfQueryFilters> {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) return emptySelfQueryResult("", "empty_query");
  const cached = selfQueryCache.get(normalizedQuery);
  if (cached) return cloneSelfQueryFilters(cached);

  try {
    const text = await generateSelfQueryJson(normalizedQuery);
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const confidence =
      typeof parsed.confidence === "number" && Number.isFinite(parsed.confidence)
        ? Math.max(0, Math.min(1, parsed.confidence))
        : 0;
    const semanticQuery =
      typeof parsed.semantic_query === "string" &&
      parsed.semantic_query.trim().length >= 2
        ? parsed.semantic_query.trim()
        : normalizedQuery;

    if (confidence < SELF_QUERY_CONFIDENCE_THRESHOLD) {
      return rememberSelfQueryFilters(normalizedQuery, {
        ...emptySelfQueryResult(normalizedQuery, "low_confidence"),
        semantic_query: normalizedQuery,
        confidence,
      });
    }

    return rememberSelfQueryFilters(normalizedQuery, {
      region: normalizeAllowedValue(
        parsed.region,
        ALLOWED_SELF_QUERY_REGIONS,
        REGION_ALIASES
      ),
      target_age: normalizeTargetAge(parsed.target_age),
      category: normalizeAllowedValue(
        parsed.category,
        ALLOWED_SELF_QUERY_CATEGORIES,
        CATEGORY_ALIASES
      ),
      semantic_query: semanticQuery,
      confidence,
      applied: true,
    });
  } catch (error) {
    console.warn("[gemini] self-query extraction failed:", error);
    return emptySelfQueryResult(normalizedQuery, "extraction_failed");
  }
}

function formatUserContext(userContext?: RagUserContext): string {
  if (!userContext) return "";
  const parts: string[] = [];
  if (userContext.region) parts.push(`- 거주 지역: ${userContext.region}`);
  if (userContext.category) parts.push(`- 관심 카테고리: ${userContext.category}`);
  if (userContext.targetAge !== null && userContext.targetAge !== undefined) {
    parts.push(`- 나이: ${userContext.targetAge}세`);
  }
  if (userContext.userType) parts.push(`- 사용자 유형: ${userContext.userType}`);
  if (parts.length === 0) return "";
  return `사용자 프로필 (저장된 정보):\n${parts.join("\n")}`;
}

async function generateWithFallback(prompt: string, maxOutputTokens = 5000) {
  let lastError: unknown = null;
  for (const model of CHAT_MODELS) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: {
          systemInstruction: POLICY_SYSTEM_INSTRUCTION,
          temperature: 0,
          maxOutputTokens,
        },
      });

      // 잘림 진단용 로깅: finishReason이 MAX_TOKENS면 토큰 더 늘려야 함
      const candidate = response.candidates?.[0];
      const finishReason = candidate?.finishReason;
      if (finishReason && finishReason !== "STOP") {
        console.warn(
          `[gemini] ${model} finishReason=${finishReason} (응답 잘렸을 수 있음. maxOutputTokens=${maxOutputTokens})`
        );
      }

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
    policy.application_method
      ? `신청방법: ${policy.application_method}`
      : "신청방법: (정보 없음 — 공고문/상세 링크 확인 필요)",
    policy.required_documents
      ? `제출서류: ${policy.required_documents}`
      : "제출서류: (정보 없음 — 공고문 확인 필요)",
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
  userContext,
}: {
  question: string;
  policies: RagPolicyContext[];
  history: RagHistoryMessage[];
  userContext?: RagUserContext;
}): Promise<string> {
  const recentHistory = formatRecentHistory(history);
  const userInfo = formatUserContext(userContext);
  const context =
    policies.length > 0
      ? policies.map(compactPolicy).join("\n\n")
      : "검색된 정책 없음";

  const prompt = `
규칙:
- 아래 검색 결과에 있는 정책만 근거로 답한다.
- 확실하지 않은 내용은 추정하지 말고 "확인 필요"라고 말한다.
- 사용자 프로필 정보가 있으면 자연스럽게 활용해 맞춤 추천한다 (정보가 없으면 무시).
- 사용자 프로필이 없는데 "나에게 맞는", "추천해줘" 같은 맞춤 요청이 오면, 정책 나열 대신 거주지/나이/관심분야를 먼저 물어본다.
- 상세 링크가 없는 정책은 공식 링크가 없다고 설명하고, 신청 방법/제공 기관/공고명 검색 같은 대안 확인 방법을 안내한다.
- 사용자가 비교/조건을 물으면 조건에 맞는 이유를 간단히 말한다.
- 마크다운 굵게 표시는 쓰지 않는다.

[추천 정책 신청 가이드 형식]
정책을 1~3개 추천한다. 각 정책마다 아래 4줄 형식으로만 짧게 적는다:
  • 정책명 (기관)
  • 추천 이유: (사용자 조건과 맞는 점 한 줄)
  • 신청방법: (검색결과의 신청방법 값. "(정보 없음 ...)"이면 "공고문/상세 링크 확인 필요")
  • 제출서류: (검색결과의 제출서류 값을 짧게. "(정보 없음 ...)"이면 "공고문 확인 필요")
  • 상세링크가 있으면 "상세링크 확인" 한 줄, 없으면 "공식 링크 없음 — 공고명으로 검색 필요" 한 줄.
검색결과에 없는 신청 절차나 서류명을 절대 만들어내지 마라.

${userInfo ? userInfo + "\n\n" : ""}최근 대화:
${recentHistory || "없음"}

현재 질문:
${question}

검색 결과:
${context}
`.trim();

  return generateWithFallback(prompt, 5000);
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
정책을 억지로 추천하지 말고 실제 대화처럼 자연스럽게 응답하라.
마크다운 굵게, 정책 목록, 추천 정책명 나열은 하지 않는다.
답변은 2~3문장 이내로 짧게 쓴다.
사용자가 어떤 정보를 줘야 하는지 물으면 지역, 나이, 관심 분야, 창업/취업/주거 같은 상황을 알려달라고 안내한다.

좋은 답변 예시:
"안녕하세요! 궁금한 걸 물어보세요. 지역, 나이, 관심 분야나 창업 단계가 있으면 더 잘 맞는 정책을 추천해드릴게요."

최근 대화:
${recentHistory || "없음"}

사용자 메시지:
${question}
`.trim();

  return generateWithFallback(prompt, 220);
}
