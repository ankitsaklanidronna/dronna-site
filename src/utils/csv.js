export const CSV_HEADER_ALIASES = {
  question_text: ["question_text", "question", "questiontext", "ques", "q"],
  option_a: ["option_a", "optiona", "a", "option1", "option_1"],
  option_b: ["option_b", "optionb", "b", "option2", "option_2"],
  option_c: ["option_c", "optionc", "c", "option3", "option_3"],
  option_d: ["option_d", "optiond", "d", "option4", "option_4"],
  correct_answer: ["correct_answer", "correctanswer", "answer", "correct_option", "correctoption"],
  subject: ["subject"],
  topic: ["topic", "chapter"],
  difficulty: ["difficulty", "level"],
  exam_type: ["exam_type", "examtype", "exam"],
  explanation: ["explanation", "solution", "answer_explanation"]
};

export function normalizeCsvHeader(value = "") {
  return value.toString().trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function parseCsvText(text) {
  const rows = [];
  let row = [];
  let value = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (ch === '"') {
      if (inQuotes && next === '"') {
        value += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === "," && !inQuotes) {
      row.push(value);
      value = "";
      continue;
    }

    if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (ch === "\r" && next === "\n") i++;
      row.push(value);
      if (row.some(cell => cell.trim() !== "")) rows.push(row);
      row = [];
      value = "";
      continue;
    }

    value += ch;
  }

  if (value.length > 0 || row.length > 0) {
    row.push(value);
    if (row.some(cell => cell.trim() !== "")) rows.push(row);
  }

  return rows;
}

export function getCsvCell(row, headerMap, key) {
  const aliases = CSV_HEADER_ALIASES[key] || [key];
  for (const alias of aliases) {
    const idx = headerMap[normalizeCsvHeader(alias)];
    if (idx !== undefined) return (row[idx] || "").trim();
  }
  return "";
}

export function normalizeCorrectAnswer(value = "") {
  const cleaned = value.toString().trim().toUpperCase();
  if (["A", "B", "C", "D"].includes(cleaned)) return cleaned;
  if (cleaned === "OPTION A") return "A";
  if (cleaned === "OPTION B") return "B";
  if (cleaned === "OPTION C") return "C";
  if (cleaned === "OPTION D") return "D";
  return "";
}

export function normalizeDifficulty(value = "") {
  const cleaned = value.toString().trim().toLowerCase();
  if (["easy", "medium", "hard"].includes(cleaned)) return cleaned;
  return "easy";
}

export function normalizeExamType(value = "", fallback = "UKPSC") {
  const cleaned = value.toString().trim().toUpperCase();
  if (cleaned === "UKPSC") return "UKPSC";
  if (cleaned === "UKSSSC") return "UKSSSC";
  if (cleaned === "BOTH") return "Both";
  if (cleaned === "COMMON") return "Common";
  return fallback;
}

export function parseQuestionsCsv(text, fallbackExamType = "UKPSC") {
  const rows = parseCsvText(text);
  if (rows.length < 2) {
    return { ok: false, error: "CSV me header + kam se kam 1 question row honi chahiye" };
  }

  const headers = rows[0].map(h => h.trim());
  const headerMap = headers.reduce((acc, header, idx) => {
    acc[normalizeCsvHeader(header)] = idx;
    return acc;
  }, {});

  const required = ["question_text", "option_a", "option_b", "option_c", "option_d", "correct_answer"];
  const missing = required.filter(key => !CSV_HEADER_ALIASES[key].some(alias => headerMap[normalizeCsvHeader(alias)] !== undefined));
  if (missing.length > 0) {
    return { ok: false, error: `Missing CSV headers: ${missing.join(", ")}` };
  }

  const parsed = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const payload = {
      question_text: getCsvCell(row, headerMap, "question_text"),
      option_a: getCsvCell(row, headerMap, "option_a"),
      option_b: getCsvCell(row, headerMap, "option_b"),
      option_c: getCsvCell(row, headerMap, "option_c"),
      option_d: getCsvCell(row, headerMap, "option_d"),
      correct_answer: normalizeCorrectAnswer(getCsvCell(row, headerMap, "correct_answer")),
      subject: getCsvCell(row, headerMap, "subject") || "Mixed",
      topic: getCsvCell(row, headerMap, "topic"),
      difficulty: normalizeDifficulty(getCsvCell(row, headerMap, "difficulty")),
      exam_type: normalizeExamType(getCsvCell(row, headerMap, "exam_type"), fallbackExamType),
      explanation: getCsvCell(row, headerMap, "explanation")
    };

    if (!payload.question_text || !payload.option_a || !payload.option_b || !payload.option_c || !payload.option_d || !payload.correct_answer) {
      return { ok: false, error: `Required data is missing in row ${i + 1}` };
    }

    parsed.push(payload);
  }

  return { ok: true, questions: parsed };
}
