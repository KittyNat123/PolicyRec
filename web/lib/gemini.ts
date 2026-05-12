import { GoogleGenAI } from "@google/genai";

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  throw new Error(
    "환경변수 GEMINI_API_KEY가 설정되지 않았습니다. web/.env.local 파일을 확인해주세요."
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
사용자의 상황에 맞는 정책을 추천하고, 검색 결과에 있는 정보만 근거로 설명한다.

중요 규칙:
- 검색 결과에 없는 신청 방법, 제출 서류, 자격 조건을 만들어내지 않는다.
- 사용자의 저장된 프로필이나 대화 맥락이 있으면 자연스럽게 반영한다.
- 지역, 나이, 관심 분야, 현재 상황이 부족하면 바로 추천을 나열하기보다 필요한 정보를 먼저 물어본다.
- 정책 추천은 1~3개만 고르고, 왜 맞는지 짧게 설명한다.
- 답변은 한국어로 한다.
- 굵은 마크다운은 쓰지 않는다.

추천 답변 형식:
정책명 (기관)
- 추천 이유: 사용자 조건과 맞는 핵심 이유
- 신청 방법: 검색 결과에 있는 신청 방법. 없으면 공고문 상세 링크 확인 필요
- 제출 서류: 검색 결과에 있는 제출 서류. 없으면 공고문 확인 필요
- 상세 링크: 링크가 있으면 확인 안내, 없으면 공고명으로 검색 필요
`.trim();

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
  창업자금: "자금",
  지원금: "자금",
  투자: "자금",
  대출: "자금",
  보조금: "자금",
  월세: "주거",
  전세: "주거",
  주택: "주거",
  교육: "교육/멘토링",
  멘토링: "교육/멘토링",
  강의: "교육/멘토링",
};

const SELF_QUERY_CONFIDENCE_THRESHOLD = 0.7;
const SELF_QUERY_CACHE_MAX = 200;
const selfQueryCache = new Map<string, SelfQueryFilters>();

export async function getQueryEmbedding(query: string): Promise<number[]> {
  const response = await ai.models.embedContent({
    model: EMBEDDING_MODEL,
    contents: query,
    config: {
      taskType: "RETRIEVAL_QUERY",
      outputDimensionality: EMBEDDING_DIMENSION,
    },
  });

  const embedding = response.embeddings?.[0]?.values;
  if (!embedding) {
    throw new Error("Gemini embedding 응답이 비어 있습니다.");
  }
  if (embedding.length !== EMBEDDING_DIMENSION) {
    throw new Error(
      `embedding 차원이 예상과 다릅니다. 기대: ${EMBEDDING_DIMENSION}, 실제: ${embedding.length}`
    );
  }
  return embedding;
}

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
  const systemInstruction = `
너는 정책 검색용 self-query 필터 추출기다.
사용자 질문에서 명확한 검색 필터만 추출하고 JSON만 출력한다.

출력 JSON:
{
  "region": "허용 region 중 하나 또는 null",
  "target_age": "정확한 숫자 나이 또는 null",
  "category": "허용 category 중 하나 또는 null",
  "semantic_query": "필터 표현을 덜어낸 자연어 검색문",
  "confidence": 0부터 1 사이 숫자
}

허용 region:
${JSON.stringify(ALLOWED_SELF_QUERY_REGIONS)}

허용 category:
${JSON.stringify(ALLOWED_SELF_QUERY_CATEGORIES)}

정규화 예:
- 서울 -> 서울특별시
- 부산 -> 부산광역시
- 취업, 구직, 일자리 -> 인력/일자리
- 스타트업, 예비창업 -> 창업
- 지원금, 대출, 보조금 -> 자금

주의:
- "청년", "중장년"처럼 정확한 나이가 아닌 표현만 있으면 target_age는 null이다.
- 확신이 낮으면 confidence를 낮게 준다.
`.trim();

  let lastError: unknown = null;
  for (const model of CHAT_MODELS) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: `사용자 질문:\n${query}`,
        config: {
          systemInstruction,
          temperature: 0,
          maxOutputTokens: 320,
          responseMimeType: "application/json",
        },
      });
      const text = response.text?.trim();
      if (text) return stripJsonFence(text);
      lastError = new Error(`${model} self-query 응답이 비어 있습니다.`);
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
  if (userContext.category) parts.push(`- 관심 분야: ${userContext.category}`);
  if (userContext.targetAge !== null && userContext.targetAge !== undefined) {
    parts.push(`- 나이: ${userContext.targetAge}세`);
  }
  if (userContext.userType) parts.push(`- 사용자 유형: ${userContext.userType}`);
  if (parts.length === 0) return "";
  return `사용자 프로필/필터:\n${parts.join("\n")}`;
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
    policy.support_type ? `지원 유형: ${policy.support_type}` : null,
    policy.target_group ? `대상: ${policy.target_group}` : null,
    policy.target_tags?.length ? `대상 태그: ${policy.target_tags.join(", ")}` : null,
    policy.apply_start_dt ? `시작일: ${policy.apply_start_dt}` : null,
    policy.apply_end_dt ? `마감일: ${policy.apply_end_dt}` : null,
    policy.summary ? `요약: ${policy.summary}` : null,
    policy.application_method
      ? `신청 방법: ${policy.application_method}`
      : "신청 방법: 공고문 상세 링크 확인 필요",
    policy.required_documents
      ? `제출 서류: ${policy.required_documents}`
      : "제출 서류: 공고문 확인 필요",
    policy.additional_conditions ? `추가 조건: ${policy.additional_conditions}` : null,
    policy.detail_url
      ? `상세 링크: ${policy.detail_url}`
      : "상세 링크: 없음. 공고명으로 검색 필요",
  ]
    .filter(Boolean)
    .join("\n");
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
      const text = response.text?.trim();
      if (text) return text;
      lastError = new Error(`${model} 답변이 비어 있습니다.`);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Gemini 답변 생성에 실패했습니다.");
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
아래 정보만 근거로 답변해줘.

${userInfo ? `${userInfo}\n\n` : ""}최근 대화:
${recentHistory || "없음"}

현재 질문:
${question}

검색 결과:
${context}

답변 지침:
- 검색 결과가 없으면 지역, 나이, 관심 분야, 현재 상황 중 부족한 정보를 먼저 물어봐.
- 검색 결과가 있으면 실제 지원 가능성을 판단하는 데 필요한 마감일, 대상, 신청 방법을 우선 설명해.
- 사용자의 저장 조건과 현재 질문 조건이 다르면 현재 질문 조건을 더 우선하되, 그 사실을 짧게 알려줘.
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
사용자가 정책 추천 챗봇에게 일반 질문을 했다.
짧고 친절하게 답하고, 정확한 추천을 위해 필요한 정보 2~3가지를 알려줘.

최근 대화:
${recentHistory || "없음"}

사용자 질문:
${question}
`.trim();

  return generateWithFallback(prompt, 1200);
}
