import { getLastItem } from '../utils/attempts.js';
import { invokeEdgeFunction } from './supabaseClient.js';

export const NUMERICAL_KEYWORDS = [
  "average", "ratio", "percentage", "percent", "profit", "loss", "discount", "time",
  "distance", "speed", "train", "boat", "mixture", "interest", "number", "series",
  "sum", "difference", "product", "age", "work", "clock", "calendar",
  "", "", "", "", "", "", "", "", "",
  "", "", "", "", "", "", "", "", ""
];

export function getAttemptQuestionCount(attempt) {
  const count = Number(attempt?.total_questions || attempt?.total || 0);
  return Number.isFinite(count) && count > 0 ? count : 0;
}

export function getAttemptTimeSeconds(attempt) {
  const seconds = Number(attempt?.time_taken_seconds || attempt?.time || 0);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
}

export function shortenText(text, maxLength = 64) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) return "";
  return clean.length > maxLength ? clean.slice(0, maxLength - 1) + "" : clean;
}

export function hasNumericalSignal(text) {
  const value = String(text || "").toLowerCase();
  if (!value) return false;
  if (/[0-9%+\-*/=]/.test(value)) return true;
  return NUMERICAL_KEYWORDS.some(keyword => value.includes(keyword));
}

export function isNumericalQuestion(question) {
  if (!question) return false;
  if (question.is_numerical !== undefined) return Boolean(question.is_numerical);
  return [
    question.question_text,
    question.option_a,
    question.option_b,
    question.option_c,
    question.option_d,
    question.topic,
    question.subject
  ].some(hasNumericalSignal);
}

export function formatTopBuckets(items, fallbackText) {
  if (!Array.isArray(items) || items.length === 0) return fallbackText;
  const counts = items.reduce((acc, item) => {
    const key = String(item || "").trim();
    if (!key) return acc;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const top = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([label, count]) => `${label} (${count})`);
  return top.length > 0 ? top.join(", ") : fallbackText;
}

export function buildFeedbackFacts(studentData) {
  const totalAttempts = studentData.totalAttempts || 0;
  const avgScore = studentData.avgScore || 0;
  const bestScore = studentData.bestScore || 0;
  const worstScore = studentData.worstScore || 0;
  const trend = studentData.trend || "stable";
  const examTarget = studentData.examTarget || "UKPSC";
  const recentAttempts = Array.isArray(studentData.recentAttempts) ? studentData.recentAttempts : [];
  const latestAttemptContext = studentData.latestAttemptContext || null;

  const recentDetail = recentAttempts.slice(-5).map(function(a, i) {
    const total = Math.max(getAttemptQuestionCount(a), 1);
    const pct = Math.round((Number(a?.score || 0) / total) * 100);
    const status = pct >= 70 ? "strong" : pct >= 50 ? "steady" : "needs work";
    return `${i + 1}. ${a?.set_name || a?.setName || "Test"} - ${pct}% (${status})`;
  }).join(" | ");

  const trendText = trend === "improving"
    ? "Score is improving"
    : trend === "declining"
      ? "Score is declining"
      : "Score is stable";

  const allQuestions = Array.isArray(latestAttemptContext?.allQuestions) ? latestAttemptContext.allQuestions : [];
  const wrongQuestions = Array.isArray(latestAttemptContext?.wrongQuestions) ? latestAttemptContext.wrongQuestions : [];
  const weakTopics = formatTopBuckets(wrongQuestions.map(q => q?.topic).filter(Boolean), "No clear topic pattern");
  const weakSubjects = formatTopBuckets(wrongQuestions.map(q => q?.subject).filter(Boolean), "Mixed subject spread");
  const wrongExamples = wrongQuestions.slice(0, 3).map((q, index) => {
    const label = q?.topic || q?.subject || "Mixed";
    return `${index + 1}. ${label}: ${shortenText(q?.question_text, 52)}`;
  }).join(" | ");

  const numericalPool = allQuestions.filter(isNumericalQuestion);
  const numericalWrong = wrongQuestions.filter(isNumericalQuestion);
  let numericalText = "No numerical data available";
  if (numericalPool.length > 0) {
    numericalText = numericalWrong.length === 0
      ? `Numerical performance is strong (${numericalPool.length} total, 0 wrong)`
      : `Numerical questions need work (${numericalWrong.length}/${numericalPool.length} wrong)`;
  }

  const latestTimeSeconds = Number(latestAttemptContext?.timeTakenSeconds || getAttemptTimeSeconds(getLastItem(recentAttempts)));
  const latestQuestionCount = Number(latestAttemptContext?.totalQuestions || getAttemptQuestionCount(getLastItem(recentAttempts)));
  const latestAccuracy = Number(
    latestAttemptContext?.accuracy ??
    (latestQuestionCount > 0
      ? Math.round((Number(getLastItem(recentAttempts)?.score || 0) / latestQuestionCount) * 100)
      : 0)
  );
  const timeLimitSeconds = Number(latestAttemptContext?.timeLimitSeconds || getLastItem(recentAttempts)?.time_limit_seconds || 0);
  let speedText = "No speed data available";
  if (latestTimeSeconds > 0 && latestQuestionCount > 0) {
    const secPerQuestion = Math.round(latestTimeSeconds / latestQuestionCount);
    const usedRatio = timeLimitSeconds > 0 ? latestTimeSeconds / timeLimitSeconds : 0;
    if (((usedRatio > 0 && usedRatio < 0.45) || secPerQuestion < 30) && latestAccuracy < 70) {
      speedText = `Pace is too fast (${secPerQuestion} sec/question)`;
    } else if ((usedRatio > 0.9 && latestAccuracy < 60) || secPerQuestion > 95) {
      speedText = `Pace is too slow (${secPerQuestion} sec/question)`;
    } else {
      speedText = `Pace is balanced (${secPerQuestion} sec/question)`;
    }
  }

  let biggestIssue = "No major weakness is clearly visible right now";
  if (wrongQuestions.length > 0 && numericalWrong.length >= Math.max(1, Math.ceil(wrongQuestions.length / 2))) {
    biggestIssue = "Most mistakes are coming from numerical questions";
  } else if (String(speedText).includes("too fast")) {
    biggestIssue = "Answers appear to be affected by rushing";
  } else if (wrongQuestions.length > 0) {
    biggestIssue = `Repeated mistakes are appearing in ${weakTopics !== "No clear topic pattern" ? weakTopics : weakSubjects}`;
  } else if (trend === "declining") {
    biggestIssue = "Recent test performance is slipping";
  }

  return {
    examTarget,
    totalAttempts,
    avgScore,
    bestScore,
    worstScore,
    trendText,
    recentDetail,
    weakTopics,
    weakSubjects,
    numericalText,
    speedText,
    wrongExamples: wrongExamples || "Wrong question examples are not available",
    latestSetName: latestAttemptContext?.setName || getLastItem(recentAttempts)?.set_name || getLastItem(recentAttempts)?.setName || "Latest test",
    latestAccuracy,
    biggestIssue
  };
}

export function normalizeCoachLanguage(value) {
  return String(value || "").trim().toLowerCase() === "english" ? "english" : "hindi";
}

export function getCoachLanguageLabel(value) {
  return normalizeCoachLanguage(value) === "english" ? "English" : "Hindi (Devanagari)";
}

export function buildFallbackFeedback(studentData, coachLanguage = "hindi") {
  const facts = buildFeedbackFacts(studentData);
  if (normalizeCoachLanguage(coachLanguage) === "hindi") {
    return [
      `${facts.latestSetName} में मुख्य समस्या: ${facts.biggestIssue}.`,
      `1. सबसे बड़ा पैटर्न: ${facts.biggestIssue}`,
      `2. सबसे कमजोर टॉपिक/सब्जेक्ट: ${facts.weakTopics !== "No clear topic pattern" ? facts.weakTopics : facts.weakSubjects}`,
      `3. न्यूमेरिकल/स्पीड: ${facts.numericalText}; ${facts.speedText}`,
      `4. अगला कदम: पहले कमजोर क्षेत्र revise करें, फिर timed practice में accuracy दोबारा जांचें.`
    ].join("\n");
  }

  return [
    `Main issue in ${facts.latestSetName}: ${facts.biggestIssue}.`,
    `1. Biggest issue: ${facts.biggestIssue}`,
    `2. Weakest topic/subject: ${facts.weakTopics !== "No clear topic pattern" ? facts.weakTopics : facts.weakSubjects}`,
    `3. Numerical/speed summary: ${facts.numericalText}; ${facts.speedText}`,
    `4. Next step: revise the weak area first, then check accuracy again in timed practice.`
  ].join("\n");
}

export async function getGroq(studentData, accessToken) {
  const name = studentData.name || "Student";
  const facts = buildFeedbackFacts(studentData);
  const coachLanguage = normalizeCoachLanguage(
    studentData.aiCoachLanguage || studentData.ai_coach_language || studentData.coachLanguage
  );
  const languageInstruction = coachLanguage === "english"
    ? "Write in English only."
    : "Write in Hindi using Devanagari script only.";
  const noNumericalIssueText = coachLanguage === "english"
    ? "No major numerical issue is visible."
    : "कोई बड़ी न्यूमेरिकल समस्या साफ नहीं दिख रही है.";
  const tooFastText = coachLanguage === "english"
    ? "You are attempting too fast."
    : "आप बहुत जल्दी attempt कर रहे हैं.";

  const promptText = "You are an experienced UKPSC/UKSSSC teacher. Do not assume anything beyond the facts below." +
    " Student: " + name +
    " | Target: " + facts.examTarget +
    " | Total tests: " + facts.totalAttempts +
    " | Average: " + facts.avgScore + "%" +
    " | Best: " + facts.bestScore + "%" +
    " | Lowest: " + facts.worstScore + "%" +
    " | Trend: " + facts.trendText +
    " | Recent tests: " + (facts.recentDetail || "none") +
    " | Latest accuracy: " + facts.latestAccuracy + "%" +
    " | Biggest issue: " + facts.biggestIssue +
    " | Weak topics: " + facts.weakTopics +
    " | Weak subjects: " + facts.weakSubjects +
    " | Numerical: " + facts.numericalText +
    " | Speed: " + facts.speedText +
    " | Wrong question examples: " + facts.wrongExamples +
    ". Give highly precise feedback. Keep the format strict:" +
    " The first line must be exactly 1 short diagnosis sentence." +
    " Then write EXACTLY 4 numbered points:" +
    " 1. The most specific mistake pattern." +
    " 2. The weakest topic or subject." +
    " 3. A clear verdict on numerical performance and pace." +
    " 4. The next 2-3 actionable study steps." +
    " Rules: " + languageInstruction +
    " Do not add generic motivation. Do not invent missing data. If there is no clear numerical issue, say '" + noNumericalIssueText + "' If the pace is too fast, say '" + tooFastText + "' Keep the full answer under 120 words.";

  try {
    const d = await invokeEdgeFunction("groq-coach", {
      accessToken,
      body: { promptText, coachLanguage }
    });
    return d?.content || buildFallbackFeedback(studentData, coachLanguage);
  } catch(e) {
    return buildFallbackFeedback(studentData, coachLanguage);
  }
}
