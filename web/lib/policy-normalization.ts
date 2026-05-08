const EMPTY_TEXT_VALUES = new Set([
  "none",
  "null",
  "undefined",
  "nan",
  "n/a",
  "-",
]);

const YOUTH_CODE_LABELS: Record<string, string> = {
  "0013001": "청년",
  "0013003": "청년",
  "0013006": "청년",
  "0013008": "청년",
  "0013009": "청년",
  "0013010": "청년",
  "0049002": "청년",
  "0049003": "청년",
  "0049004": "청년",
  "0049005": "청년",
  "0049006": "청년",
  "0049007": "청년",
  "0049008": "청년",
  "0049009": "청년",
  "0049010": "청년",
};

function isEmptyToken(text: string) {
  return EMPTY_TEXT_VALUES.has(text.trim().toLowerCase());
}

function isEncodedPlaceholder(text: string) {
  const normalized = text.trim();
  if (normalized.length < 16) return false;
  if (/\s/.test(normalized) || /[.@가-힣]/.test(normalized)) return false;
  if (!/[A-Za-z]/.test(normalized) || /^\d+$/.test(normalized)) return false;
  return /^[A-Za-z0-9+/]+={0,2}$/.test(normalized);
}

function cleanDisplayLine(line: string) {
  const trimmed = line.trim();
  if (!trimmed || isEmptyToken(trimmed) || isEncodedPlaceholder(trimmed)) {
    return null;
  }
  if (/^https?:\/\//i.test(trimmed)) return trimmed;

  const labeled = trimmed.match(/^([^:：]{1,40}?)\s*[:：]\s*(.*)$/);
  if (!labeled) return trimmed;

  const label = labeled[1].trim();
  const value = labeled[2].trim();
  if (!value || isEmptyToken(value)) return null;
  if (isEncodedPlaceholder(value)) {
    return label.includes("이메일")
      ? `${label}: 공고문 확인 필요`
      : null;
  }

  return `${label}: ${value}`;
}

export function cleanPolicyText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\r\n?/g, "\n").trim();
  if (!normalized || isEmptyToken(normalized)) return null;

  const lines = normalized
    .split("\n")
    .map(cleanDisplayLine)
    .filter((line): line is string => Boolean(line));

  return lines.length > 0 ? lines.join("\n") : null;
}

function splitLines(text: string | null) {
  return text?.split("\n").map((line) => line.trim()).filter(Boolean) ?? [];
}

function normalizeDocumentHeading(line: string) {
  return line
    .replace(/^[□○●ㆍ\-*\s]*/, "")
    .replace(/^(제출\s*서류|제출서류|구비\s*서류|구비서류)\s*[:：]?\s*/i, "")
    .trim();
}

function splitApplicationDocumentText(applicationMethod: string | null) {
  const lines = splitLines(applicationMethod);
  const documentStart = lines.findIndex((line) =>
    /(제출\s*서류|제출서류|구비\s*서류|구비서류)/i.test(line)
  );

  if (documentStart < 0) {
    return {
      applicationMethod,
      extractedDocuments: null,
    };
  }

  const applicationLines = lines.slice(0, documentStart);
  const documentLines = lines
    .slice(documentStart)
    .map(normalizeDocumentHeading)
    .filter(Boolean);

  return {
    applicationMethod:
      applicationLines.length > 0 ? applicationLines.join("\n") : applicationMethod,
    extractedDocuments:
      documentLines.length > 0 ? documentLines.join("\n") : null,
  };
}

function sameText(left: string | null, right: string | null) {
  if (!left || !right) return false;
  return left.replace(/\s/g, "") === right.replace(/\s/g, "");
}

function looksLikeDocumentList(text: string | null) {
  if (!text) return false;
  return /(제출\s*서류|제출서류|구비\s*서류|구비서류|신청서|사업계획서|동의서|증명서|등록증|등본|명부|완납증명|서식)/.test(
    text
  );
}

export function normalizeApplicationDetails(
  applicationMethodValue: unknown,
  requiredDocumentsValue: unknown
) {
  const applicationText = cleanPolicyText(applicationMethodValue);
  const requiredText = cleanPolicyText(requiredDocumentsValue);
  const split = splitApplicationDocumentText(applicationText);

  let requiredDocuments = requiredText;
  if (!requiredDocuments || sameText(requiredDocuments, applicationText)) {
    requiredDocuments = split.extractedDocuments;
  }
  if (
    sameText(requiredDocuments, split.applicationMethod) ||
    !looksLikeDocumentList(requiredDocuments)
  ) {
    requiredDocuments = null;
  }

  return {
    application_method: split.applicationMethod,
    required_documents: requiredDocuments,
  };
}

export function cleanTargetGroup(
  value: unknown,
  targetTags: string[] | null | undefined
) {
  const text = cleanPolicyText(value);
  const tags = targetTags?.filter(Boolean) ?? [];
  if (!text) return tags.length > 0 ? tags.join(", ") : null;

  const tokens = text
    .split(/[|,]/)
    .map((token) => token.trim())
    .filter(Boolean);
  const allCodes = tokens.length > 0 && tokens.every((token) => /^\d{7}$/.test(token));
  if (!allCodes) return text;

  const labels = Array.from(
    new Set(tokens.map((token) => YOUTH_CODE_LABELS[token]).filter(Boolean))
  );
  if (labels.length > 0) return labels.join(", ");
  return tags.length > 0 ? tags.join(", ") : null;
}

export function cleanDetailUrl(value: unknown) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text || isEmptyToken(text) || /\s/.test(text)) return null;
  return text;
}
