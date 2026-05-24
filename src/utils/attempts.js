import { normalizeEmail } from './authStorage.js';

export function getAttemptTimestamp(attempt) {
  return (
    attempt?.completed_at ||
    attempt?.date ||
    attempt?.created_at ||
    ""
  );
}

export function sortAttemptsByTime(attempts = [], order = "desc") {
  const direction = order === "asc" ? 1 : -1;
  return [...attempts].sort((a, b) => {
    const aTime = Date.parse(getAttemptTimestamp(a)) || 0;
    const bTime = Date.parse(getAttemptTimestamp(b)) || 0;
    return (aTime - bTime) * direction;
  });
}

export function buildAttemptPayload(attempt = {}) {
  const nowIso = new Date().toISOString();
  const completedAt = attempt.completed_at || attempt.date || nowIso;
  return {
    ...attempt,
    student_email: normalizeEmail(attempt.student_email),
    completed_at: completedAt,
    date: attempt.date || completedAt
  };
}

export function stripAttemptFields(payload, fields = []) {
  const next = { ...payload };
  fields.forEach((field) => {
    delete next[field];
  });
  return next;
}

export function parseStoredJson(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function normalizeQuestionBreakdown(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    const parsed = parseStoredJson(value, []);
    return Array.isArray(parsed) ? parsed : [];
  }
  return [];
}

export function normalizeAttemptRecord(attempt = {}) {
  if (!attempt || typeof attempt !== "object") return null;
  return {
    ...attempt,
    score: Number(attempt.score ?? 0),
    total_questions: Number(attempt.total_questions ?? attempt.total ?? 0),
    total: Number(attempt.total ?? attempt.total_questions ?? 0),
    correct: Number(attempt.correct ?? 0),
    wrong: Number(attempt.wrong ?? 0),
    time: Number(attempt.time ?? attempt.time_taken_seconds ?? 0),
    time_taken_seconds: Number(attempt.time_taken_seconds ?? attempt.time ?? 0),
    accuracy_percent: Number(attempt.accuracy_percent ?? 0),
    question_breakdown: normalizeQuestionBreakdown(attempt.question_breakdown),
  };
}

export const ADMIN_ATTEMPT_FIELDS = [
  "id",
  "student_email",
  "score",
  "total_questions",
  "total",
  "set_name",
  "completed_at",
  "date",
  "created_at"
].join(",");

export const ATTEMPT_TIMESTAMP_FIELDS = ["completed_at", "date", "created_at"];

export function getAttemptIdentityKey(attempt = {}) {
  if (attempt?.id !== undefined && attempt?.id !== null && attempt.id !== "") {
    return `id:${attempt.id}`;
  }
  return [
    normalizeEmail(attempt?.student_email) || "unknown",
    attempt?.set_id || attempt?.setId || attempt?.set_name || attempt?.setName || "unknown-set",
    getAttemptTimestamp(attempt) || "unknown-time",
    Number(attempt?.score ?? 0),
    Number(attempt?.total_questions ?? attempt?.total ?? 0)
  ].join("|");
}

export function mergeUniqueAttempts(attempts = []) {
  const merged = new Map();
  attempts.forEach((attempt) => {
    const normalized = normalizeAttemptRecord(attempt);
    if (!normalized) return;
    const key = getAttemptIdentityKey(normalized);
    const previous = merged.get(key);
    merged.set(key, previous ? { ...previous, ...normalized } : normalized);
  });
  return Array.from(merged.values());
}

export function parseCountFromContentRange(value, fallback = 0) {
  const match = /\/(\d+)$/.exec(value || "");
  return match ? Number(match[1]) : fallback;
}

export function getLocalDayIsoRange(value = new Date()) {
  const start = new Date(value);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return {
    startIso: start.toISOString(),
    endIso: end.toISOString(),
    startDate: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(start.getDate()).padStart(2, "0")}`,
    endDate: `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}-${String(end.getDate()).padStart(2, "0")}`
  };
}

export function readStoredAttempts() {
  const parsed = parseStoredJson(localStorage.getItem("dronna_attempts"), []);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((attempt) => normalizeAttemptRecord(attempt))
    .filter(Boolean);
}

export function writeStoredAttempts(attempts) {
  localStorage.setItem("dronna_attempts", JSON.stringify(attempts));
}

export function getLastItem(items = []) {
  return Array.isArray(items) && items.length > 0 ? items[items.length - 1] : undefined;
}
