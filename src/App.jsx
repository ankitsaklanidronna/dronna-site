import { useState, useEffect, useContext, createContext, useRef } from 'react';
import Chart from 'chart.js/auto';


// ═══════════════════════════════════════════════
// ⚙️ CONFIG — Replace with your actual keys
// ═══════════════════════════════════════════════
const CONFIG = {
  SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
  SUPABASE_ANON_KEY: import.meta.env.VITE_SUPABASE_ANON_KEY,
  RAZORPAY_KEY: import.meta.env.VITE_RAZORPAY_KEY || "YOUR_RAZORPAY_KEY_ID",
  ADMIN_EMAIL: import.meta.env.VITE_ADMIN_EMAIL,
};
const IS_DEMO = false;
const FUNCTIONS_BASE = `${CONFIG.SUPABASE_URL}/functions/v1`;

async function invokeEdgeFunction(name, { accessToken, body = {} } = {}) {
  const r = await fetch(`${FUNCTIONS_BASE}/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": CONFIG.SUPABASE_ANON_KEY,
      ...(accessToken ? { "Authorization": `Bearer ${accessToken}` } : {})
    },
    body: JSON.stringify(body)
  });

  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error || `Function ${name} failed`);
  return data;
}

// ── Share Utility ──
async function shareContent({ title, text, url }) {
  const fullUrl = url || window.location.href.split("#")[0];
  if (navigator.share) {
    try {
      await navigator.share({ title, text, url: fullUrl });
      return "shared";
    } catch(e) { if (e.name === "AbortError") return "cancelled"; }
  }
  // Fallback: copy to clipboard
  try {
    await navigator.clipboard.writeText(text + "\n" + fullUrl);
    return "copied";
  } catch(e) {
    // Last resort
    const ta = document.createElement("textarea");
    ta.value = text + "\n" + fullUrl;
    document.body.appendChild(ta);
    ta.select(); document.execCommand("copy");
    document.body.removeChild(ta);
    return "copied";
  }
}

function ShareBtn({ title, text, url, label="Share", className="" }) {
  const [status, setStatus] = useState("");
  const handle = async () => {
    const res = await shareContent({ title, text, url });
    if (res === "shared" || res === "copied") {
      setStatus(res === "shared" ? "Shared! ✓" : "Copied! ✓");
      setTimeout(() => setStatus(""), 2500);
    }
  };
  return (
    <button
      onClick={handle}
      className={`flex items-center gap-2 font-bold transition-all ${className}`}
    >
      {status ? status : <>{label}</>}
    </button>
  );
}

const CSV_HEADER_ALIASES = {
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

function normalizeCsvHeader(value = "") {
  return value.toString().trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function parseCsvText(text) {
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

function getCsvCell(row, headerMap, key) {
  const aliases = CSV_HEADER_ALIASES[key] || [key];
  for (const alias of aliases) {
    const idx = headerMap[normalizeCsvHeader(alias)];
    if (idx !== undefined) return (row[idx] || "").trim();
  }
  return "";
}

function normalizeCorrectAnswer(value = "") {
  const cleaned = value.toString().trim().toUpperCase();
  if (["A", "B", "C", "D"].includes(cleaned)) return cleaned;
  if (cleaned === "OPTION A") return "A";
  if (cleaned === "OPTION B") return "B";
  if (cleaned === "OPTION C") return "C";
  if (cleaned === "OPTION D") return "D";
  return "";
}

function normalizeDifficulty(value = "") {
  const cleaned = value.toString().trim().toLowerCase();
  if (["easy", "medium", "hard"].includes(cleaned)) return cleaned;
  return "easy";
}

function normalizeExamType(value = "", fallback = "UKPSC") {
  const cleaned = value.toString().trim().toUpperCase();
  if (cleaned === "UKPSC") return "UKPSC";
  if (cleaned === "UKSSSC") return "UKSSSC";
  if (cleaned === "BOTH") return "Both";
  if (cleaned === "COMMON") return "Common";
  return fallback;
}

function parseQuestionsCsv(text, fallbackExamType = "UKPSC") {
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
      return { ok: false, error: `Row ${i + 1} me required data missing hai` };
    }

    parsed.push(payload);
  }

  return { ok: true, questions: parsed };
}

// ═══════════════════════════════════════════════
// 📚 SAMPLE DATA
// ═══════════════════════════════════════════════
const SAMPLE_QUESTIONS = [
  { id:"q1", question_text:"उत्तराखंड राज्य की स्थापना किस वर्ष हुई थी?", option_a:"2000", option_b:"2001", option_c:"1999", option_d:"2002", correct_answer:"A", subject:"सामान्य ज्ञान", topic:"उत्तराखंड", difficulty:"easy", exam_type:"UKPSC" },
  { id:"q2", question_text:"उत्तराखंड की राजधानी कौन सी है?", option_a:"नैनीताल", option_b:"देहरादून", option_c:"हरिद्वार", option_d:"ऋषिकेश", correct_answer:"B", subject:"सामान्य ज्ञान", topic:"उत्तराखंड", difficulty:"easy", exam_type:"UKPSC" },
  { id:"q3", question_text:"गंगोत्री ग्लेशियर किस जिले में स्थित है?", option_a:"चमोली", option_b:"रुद्रप्रयाग", option_c:"उत्तरकाशी", option_d:"पिथौरागढ़", correct_answer:"C", subject:"भूगोल", topic:"उत्तराखंड भूगोल", difficulty:"medium", exam_type:"UKPSC" },
  { id:"q4", question_text:"फूलों की घाटी किस जिले में स्थित है?", option_a:"चमोली", option_b:"उत्तरकाशी", option_c:"बागेश्वर", option_d:"अल्मोड़ा", correct_answer:"A", subject:"भूगोल", topic:"उत्तराखंड भूगोल", difficulty:"easy", exam_type:"UKSSSC" },
  { id:"q5", question_text:"भारतीय संविधान के किस अनुच्छेद के तहत आपातकाल की घोषणा होती है?", option_a:"अनुच्छेद 352", option_b:"अनुच्छेद 356", option_c:"अनुच्छेद 360", option_d:"अनुच्छेद 370", correct_answer:"A", subject:"राजव्यवस्था", topic:"संविधान", difficulty:"medium", exam_type:"UKPSC" },
  { id:"q6", question_text:"Jim Corbett National Park किस जिले में स्थित है?", option_a:"नैनीताल", option_b:"अल्मोड़ा", option_c:"पौड़ी गढ़वाल", option_d:"हरिद्वार", correct_answer:"A", subject:"सामान्य ज्ञान", topic:"राष्ट्रीय उद्यान", difficulty:"easy", exam_type:"UKSSSC" },
  { id:"q7", question_text:"उत्तराखंड का राज्य पक्षी कौन सा है?", option_a:"मोर", option_b:"मोनाल", option_c:"बुलबुल", option_d:"तीतर", correct_answer:"B", subject:"सामान्य ज्ञान", topic:"उत्तराखंड", difficulty:"easy", exam_type:"UKSSSC" },
  { id:"q8", question_text:"केदारनाथ मंदिर किस नदी के तट पर स्थित है?", option_a:"अलकनंदा", option_b:"भागीरथी", option_c:"मंदाकिनी", option_d:"सरस्वती", correct_answer:"C", subject:"सामान्य ज्ञान", topic:"धार्मिक स्थल", difficulty:"medium", exam_type:"UKPSC" },
  { id:"q9", question_text:"भारत में पंचायती राज व्यवस्था किस वर्ष प्रारंभ हुई?", option_a:"1959", option_b:"1952", option_c:"1962", option_d:"1956", correct_answer:"A", subject:"राजव्यवस्था", topic:"पंचायती राज", difficulty:"medium", exam_type:"UKPSC" },
  { id:"q10", question_text:"उत्तराखंड का सबसे बड़ा जिला (क्षेत्रफल के अनुसार) कौन सा है?", option_a:"पिथौरागढ़", option_b:"चमोली", option_c:"उत्तरकाशी", option_d:"पौड़ी गढ़वाल", correct_answer:"B", subject:"भूगोल", topic:"उत्तराखंड भूगोल", difficulty:"hard", exam_type:"UKPSC" },
];

const SAMPLE_SETS = [
  { id:"s1", set_name:"UKPSC सामान्य ज्ञान Set 1", subject:"सामान्य ज्ञान", exam_type:"UKPSC", time_limit_minutes:20, is_paid:false, price:0, question_ids:["q1","q2","q6","q7","q8","q10"] },
  { id:"s2", set_name:"उत्तराखंड भूगोल Practice Set", subject:"भूगोल", exam_type:"UKPSC", time_limit_minutes:30, is_paid:false, price:0, question_ids:["q3","q4","q10"] },
  { id:"s3", set_name:"UKSSSC 10 Full Paper Set", subject:"Mixed", exam_type:"UKSSSC", time_limit_minutes:120, is_paid:true, price:99,
    description:"UKSSSC के 10 पूर्ण प्रश्नपत्र — Group C, VDO, Forest Guard के previous year papers पर आधारित",
    highlights:["100 Questions per Paper","Previous Year Pattern","सामान्य ज्ञान + हिंदी + विज्ञान + गणित"],
    question_ids:["q1","q2","q3","q4","q6","q7","q8","q9","q10"] },
  { id:"s4", set_name:"UKPSC 10 Full Paper Set", subject:"Mixed", exam_type:"UKPSC", time_limit_minutes:120, is_paid:true, price:99,
    description:"UKPSC के 10 पूर्ण प्रश्नपत्र — LT Grade, PCS, Lecturer के previous year papers पर आधारित",
    highlights:["100 Questions per Paper","Previous Year Pattern","सामान्य अध्ययन + राजव्यवस्था + उत्तराखंड विशेष"],
    question_ids:["q1","q2","q3","q4","q5","q6","q7","q8","q9","q10"] },
];

const SYLLABUS = {
  UKPSC: {
    "PCS (Pre + Mains)": ["सामान्य अध्ययन Paper I", "सामान्य अध्ययन Paper II", "निबंध", "वैकल्पिक विषय Paper I", "वैकल्पिक विषय Paper II", "साक्षात्कार"],
    "Lecturer (Pravakta)": ["विषय विशेष", "सामान्य ज्ञान", "उत्तराखंड विशेष", "शिक्षण अभिरुचि"],
  },
  UKSSSC: {
    "LT Grade (Sahayak Adhyapak)": ["सामान्य हिंदी", "सामान्य अध्ययन", "संविधान एवं राजव्यवस्था", "उत्तराखंड का इतिहास एवं संस्कृति", "उत्तराखंड का भूगोल", "विषय विशेष (Subject Specific)", "शिक्षण पद्धति"],
    "Group C": ["सामान्य हिंदी", "सामान्य ज्ञान", "सामान्य विज्ञान", "गणित", "कंप्यूटर ज्ञान", "उत्तराखंड विशेष"],
    "VDO (ग्राम विकास अधिकारी)": ["सामान्य हिंदी", "सामान्य ज्ञान", "पंचायती राज", "ग्रामीण विकास", "उत्तराखंड विशेष"],
    "Forest Guard": ["सामान्य ज्ञान", "वन एवं पर्यावरण", "उत्तराखंड भूगोल", "शारीरिक दक्षता"],
  }
};

// ═══════════════════════════════════════════════
// 🔌 SUPABASE CLIENT
// ═══════════════════════════════════════════════
const SB_HEADERS = {
  "apikey": CONFIG.SUPABASE_ANON_KEY,
  "Authorization": `Bearer ${CONFIG.SUPABASE_ANON_KEY}`,
  "Content-Type": "application/json",
  "Prefer": "return=representation"
};

const supabase = {
  auth: {
    signUp: async ({email, password}) => {
      try {
        const r = await fetch(`${CONFIG.SUPABASE_URL}/auth/v1/signup`, {
          method:"POST", headers:{"apikey":CONFIG.SUPABASE_ANON_KEY,"Content-Type":"application/json"},
          body:JSON.stringify({email,password})
        });
        return await r.json();
      } catch(e) { return {error: e.message}; }
    },
    signIn: async ({email, password}) => {
      try {
        const r = await fetch(`${CONFIG.SUPABASE_URL}/auth/v1/token?grant_type=password`, {
          method:"POST", headers:{"apikey":CONFIG.SUPABASE_ANON_KEY,"Content-Type":"application/json"},
          body:JSON.stringify({email,password})
        });
        return await r.json();
      } catch(e) { return {error: e.message}; }
    },
  },
  getAll: async (table) => {
    try {
      const url = CONFIG.SUPABASE_URL + "/rest/v1/" + table + "?select=*&apikey=" + CONFIG.SUPABASE_ANON_KEY;
      const r = await fetch(url, { headers: SB_HEADERS });
      const data = await r.json();
      return { data: Array.isArray(data) ? data : [], error: null };
    } catch(e) { return { data: [], error: e.message }; }
  },
  insert: async (table, row) => {
    try {
      const url = `${CONFIG.SUPABASE_URL}/rest/v1/${table}?apikey=${CONFIG.SUPABASE_ANON_KEY}`;
      const r = await fetch(url, { method:"POST", headers: SB_HEADERS, body: JSON.stringify(row) });
      const data = await r.json();
      return { data, error: null };
    } catch(e) { return { data: null, error: e.message }; }
  },
  delete: async (table, id) => {
    try {
      const url = `${CONFIG.SUPABASE_URL}/rest/v1/${table}?id=eq.${id}&apikey=${CONFIG.SUPABASE_ANON_KEY}`;
      await fetch(url, { method:"DELETE", headers: SB_HEADERS });
      return { error: null };
    } catch(e) { return { error: e.message }; }
  },
  insertMany: async (table, rows) => {
    try {
      const url = `${CONFIG.SUPABASE_URL}/rest/v1/${table}?apikey=${CONFIG.SUPABASE_ANON_KEY}`;
      await fetch(url, { method:"POST", headers: SB_HEADERS, body: JSON.stringify(rows) });
      return { error: null };
    } catch(e) { return { error: e.message }; }
  },
  insertManyReturning: async (table, rows) => {
    try {
      const url = `${CONFIG.SUPABASE_URL}/rest/v1/${table}?apikey=${CONFIG.SUPABASE_ANON_KEY}`;
      const r = await fetch(url, { method:"POST", headers: SB_HEADERS, body: JSON.stringify(rows) });
      const data = await r.json();
      if (!r.ok) return { data: [], error: data?.message || data?.hint || "Insert failed" };
      return { data: Array.isArray(data) ? data : [], error: null };
    } catch(e) { return { data: [], error: e.message }; }
  },
  getAdminStatus: async (accessToken) => {
    try {
      return await invokeEdgeFunction("admin-status", { accessToken });
    } catch (e) {
      return { isAdmin: false, error: e.message };
    }
  },
  adminWrite: async (action, payload, accessToken) => {
    try {
      return await invokeEdgeFunction("admin-write", {
        accessToken,
        body: { action, payload }
      });
    } catch (e) {
      return { error: e.message };
    }
  },
  // Student ka streak aur daily_date fetch karo
  getStudentData: async (email) => {
    try {
      const url = CONFIG.SUPABASE_URL + "/rest/v1/students?email=eq." + encodeURIComponent(email) + "&select=*&apikey=" + CONFIG.SUPABASE_ANON_KEY;
      const r = await fetch(url, { headers: SB_HEADERS });
      const data = await r.json();
      return Array.isArray(data) && data[0] ? data[0] : null;
    } catch(e) { return null; }
  },

  // Student ka streak aur daily_date update karo
  updateStudentData: async (email, updates) => {
    try {
      const url = CONFIG.SUPABASE_URL + "/rest/v1/students?email=eq." + encodeURIComponent(email) + "&apikey=" + CONFIG.SUPABASE_ANON_KEY;
      await fetch(url, {
        method: "PATCH",
        headers: SB_HEADERS,
        body: JSON.stringify(updates)
      });
    } catch(e) {}
  },

  // Leaderboard entry save karo
  saveLeaderboard: async (entry) => {
    try {
      // Pehle check karo aaj ki entry hai kya
      const url = CONFIG.SUPABASE_URL + "/rest/v1/daily_leaderboard?email=eq." + encodeURIComponent(entry.email) + "&challenge_date=eq." + entry.date + "&apikey=" + CONFIG.SUPABASE_ANON_KEY;
      const r = await fetch(url, { headers: SB_HEADERS });
      const existing = await r.json();
      if (Array.isArray(existing) && existing.length > 0) {
        // Update karo
        await fetch(url, { method: "PATCH", headers: SB_HEADERS, body: JSON.stringify({ score: entry.score, total: entry.total }) });
      } else {
        // Insert karo
        const iUrl = CONFIG.SUPABASE_URL + "/rest/v1/daily_leaderboard?apikey=" + CONFIG.SUPABASE_ANON_KEY;
        await fetch(iUrl, { method: "POST", headers: SB_HEADERS, body: JSON.stringify(entry) });
      }
    } catch(e) {}
  },

  // Leaderboard data fetch karo
  getLeaderboard: async (date) => {
    try {
      const url = CONFIG.SUPABASE_URL + "/rest/v1/daily_leaderboard?challenge_date=eq." + date + "&select=*&order=score.desc&apikey=" + CONFIG.SUPABASE_ANON_KEY;
      const r = await fetch(url, { headers: SB_HEADERS });
      const data = await r.json();
      return Array.isArray(data) ? data : [];
    } catch(e) { return []; }
  },

  getAllTimeLeaderboard: async () => {
    try {
      const url = CONFIG.SUPABASE_URL + "/rest/v1/daily_leaderboard?select=*&order=score.desc&apikey=" + CONFIG.SUPABASE_ANON_KEY;
      const r = await fetch(url, { headers: SB_HEADERS });
      const data = await r.json();
      return Array.isArray(data) ? data : [];
    } catch(e) { return []; }
  },

  // ─── FOLDER CRUD ───────────────────────────────
  getFolders: async () => {
    try {
      const url = CONFIG.SUPABASE_URL + "/rest/v1/folders?select=*&order=name.asc&apikey=" + CONFIG.SUPABASE_ANON_KEY;
      const r = await fetch(url, { headers: SB_HEADERS });
      const data = await r.json();
      if (Array.isArray(data)) return { ok: true, data };
      // Supabase error — table missing ya RLS blocking
      return { ok: false, error: data?.message || data?.hint || JSON.stringify(data) };
    } catch(e) { return { ok: false, error: e.message }; }
  },
  createFolder: async (name, parent_id) => {
    try {
      const url = CONFIG.SUPABASE_URL + "/rest/v1/folders?apikey=" + CONFIG.SUPABASE_ANON_KEY;
      const body = { name };
      if (parent_id) body.parent_id = parent_id;
      const r = await fetch(url, { method:"POST", headers:{...SB_HEADERS,"Prefer":"return=representation"}, body: JSON.stringify(body) });
      const data = await r.json();
      if (Array.isArray(data) && data[0]?.id) return { ok: true, folder: data[0] };
      return { ok: false, error: data?.message || data?.hint || JSON.stringify(data) };
    } catch(e) { return { ok: false, error: e.message }; }
  },
  moveSetToFolder: async (setId, folderId) => {
    try {
      const url = CONFIG.SUPABASE_URL + "/rest/v1/practice_sets?id=eq." + setId + "&apikey=" + CONFIG.SUPABASE_ANON_KEY;
      const body = folderId ? { folder_id: folderId } : { folder_id: null };
      const r = await fetch(url, { method:"PATCH", headers: SB_HEADERS, body: JSON.stringify(body) });
      return r.ok;
    } catch(e) { return false; }
  },
  updateFolder: async (id, name) => {
    try {
      const url = CONFIG.SUPABASE_URL + "/rest/v1/folders?id=eq." + id + "&apikey=" + CONFIG.SUPABASE_ANON_KEY;
      await fetch(url, { method:"PATCH", headers: SB_HEADERS, body: JSON.stringify({ name }) });
    } catch(e) {}
  },
  deleteFolder: async (id) => {
    try {
      const url = CONFIG.SUPABASE_URL + "/rest/v1/folders?id=eq." + id + "&apikey=" + CONFIG.SUPABASE_ANON_KEY;
      await fetch(url, { method:"DELETE", headers: SB_HEADERS });
    } catch(e) {}
  },
  // ────────────────────────────────────────────────

  reportQuestion: async (payload) => {
    try {
      const url = CONFIG.SUPABASE_URL + "/rest/v1/question_reports?apikey=" + CONFIG.SUPABASE_ANON_KEY;
      const r = await fetch(url, { method:"POST", headers:{...SB_HEADERS,"Prefer":"return=minimal"}, body: JSON.stringify(payload) });
      return r.ok;
    } catch(e) { return false; }
  },
  getReports: async () => {
    try {
      const url = CONFIG.SUPABASE_URL + "/rest/v1/question_reports?select=*&order=created_at.desc&apikey=" + CONFIG.SUPABASE_ANON_KEY;
      const r = await fetch(url, { headers: SB_HEADERS });
      const data = await r.json();
      return Array.isArray(data) ? data : [];
    } catch(e) { return []; }
  },
  resolveReport: async (id) => {
    try {
      const url = CONFIG.SUPABASE_URL + "/rest/v1/question_reports?id=eq." + id + "&apikey=" + CONFIG.SUPABASE_ANON_KEY;
      await fetch(url, { method:"PATCH", headers: SB_HEADERS, body: JSON.stringify({ status: "resolved" }) });
    } catch(e) {}
  },
  getSetQuestions: async (setId) => {
    try {
      // Step 1: set_questions se question_ids lo
      const url = CONFIG.SUPABASE_URL + "/rest/v1/set_questions?set_id=eq." + setId + "&select=question_id&apikey=" + CONFIG.SUPABASE_ANON_KEY;
      const r = await fetch(url, { headers: SB_HEADERS });
      const data = await r.json();
      if (!Array.isArray(data) || data.length === 0) return { data: [], error: null };
      const ids = data.map(function(d){ return d.question_id; }).filter(Boolean);
      if (ids.length === 0) return { data: [], error: null };
      // Step 2: Correct IN filter — id=in.(uuid1,uuid2)
      const qUrl = CONFIG.SUPABASE_URL + "/rest/v1/questions?id=in.(" + ids.join(",") + ")&apikey=" + CONFIG.SUPABASE_ANON_KEY;
      const qr = await fetch(qUrl, { headers: SB_HEADERS });
      const questions = await qr.json();
      return { data: Array.isArray(questions) ? questions : [], error: null };
    } catch(e) { return { data: [], error: e.message }; }
  }
};

// ═══════════════════════════════════════════════
// 🤖 GROQ API
// ═══════════════════════════════════════════════
async function getGroq(studentData) {
  const name = studentData.name || "छात्र";
  const totalAttempts = studentData.totalAttempts || 0;
  const avgScore = studentData.avgScore || 0;
  const bestScore = studentData.bestScore || 0;
  const worstScore = studentData.worstScore || 0;
  const recentAttempts = studentData.recentAttempts || [];
  const trend = studentData.trend || "stable";
  const examTarget = studentData.examTarget || "UKPSC";

  // Recent 5 attempts detail
  const recentDetail = recentAttempts.slice(-5).map(function(a, i) {
    const pct = Math.round((a.score / (a.total_questions || 1)) * 100);
    const status = pct >= 70 ? "अच्छा" : pct >= 50 ? "ठीक" : "कमज़ोर";
    return (i+1) + ". " + (a.set_name || "Test") + " - " + pct + "% (" + status + ")";
  }).join(" | ");

  // Trend analysis
  const trendText = trend === "improving" ? "Score बढ़ रहा है" : trend === "declining" ? "Score घट रहा है" : "Score स्थिर है";

  const promptText = "तुम UKPSC/UKSSSC के एक अनुभवी और कड़क लेकिन प्यारे शिक्षक हो।" +
    " छात्र: " + name +
    " | Target: " + examTarget +
    " | कुल टेस्ट: " + totalAttempts +
    " | औसत: " + avgScore + "%" +
    " | सबसे अच्छा: " + bestScore + "%" +
    " | सबसे कमज़ोर: " + worstScore + "%" +
    " | Trend: " + trendText +
    " | हाल के टेस्ट: " + (recentDetail || "कोई नहीं") +
    ". अब इस छात्र का DETAILED विश्लेषण करो। Exactly इस format में लिखो:" +
    " पहले एक line में overall summary दो।" +
    " फिर EXACTLY 4 points लिखो — numbering 1. 2. 3. 4. से।" +
    " Point 1: Performance की सच्चाई — क्या अच्छा है, क्या नहीं।" +
    " Point 2: Weak area identify करो — specific subject या pattern।" +
    " Point 3: Next 7 दिनों का action plan — concrete steps।" +
    " Point 4: " + examTarget + " exam के लिए motivational message।" +
    " Rules: Hindi में लिखो। Teacher style — direct, clear, caring. AI/technology mention नहीं। Max 150 words।";

  try {
    const d = await invokeEdgeFunction("groq-coach", {
      body: { promptText }
    });
    return d?.content || null;
  } catch(e) {
    return null;
  }
}


// ═══════════════════════════════════════════════
// 🔐 AUTH CONTEXT
// ═══════════════════════════════════════════════
const AuthContext = createContext(null);

function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const restoreUser = async () => {
      const saved = localStorage.getItem("dronna_user");
      if (!saved) {
        setLoading(false);
        return;
      }

      try {
        const parsed = JSON.parse(saved);
        let isAdmin = parsed?.email === CONFIG.ADMIN_EMAIL;

        if (parsed?.access_token) {
          const status = await supabase.getAdminStatus(parsed.access_token);
          isAdmin = Boolean(status?.isAdmin) || parsed?.email === CONFIG.ADMIN_EMAIL;
        }

        const nextUser = { ...parsed, isAdmin };
        setUser(nextUser);
        localStorage.setItem("dronna_user", JSON.stringify(nextUser));
      } catch {
        localStorage.removeItem("dronna_user");
        setUser(null);
      } finally {
        setLoading(false);
      }
    };

    restoreUser();
  }, []);

  const login = async (userData) => {
    let isAdmin = userData?.email === CONFIG.ADMIN_EMAIL;
    if (userData?.access_token) {
      const status = await supabase.getAdminStatus(userData.access_token);
      isAdmin = Boolean(status?.isAdmin) || userData?.email === CONFIG.ADMIN_EMAIL;
    }

    const u = { ...userData, isAdmin };
    setUser(u);
    localStorage.setItem("dronna_user", JSON.stringify(u));
    return u;
  };
  const logout = () => {
    setUser(null);
    localStorage.removeItem("dronna_user");
  };

  return <AuthContext.Provider value={{ user, login, logout, loading }}>{children}</AuthContext.Provider>;
}

// ═══════════════════════════════════════════════
// 🧭 ROUTER
// ═══════════════════════════════════════════════
const RouterContext = createContext(null);

function Router({ children }) {
  const [page, setPage] = useState(window.location.hash.replace("#","") || "/");
  useEffect(() => {
    const onHash = () => setPage(window.location.hash.replace("#","") || "/");
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const navigate = (p) => { window.location.hash = p; };
  return <RouterContext.Provider value={{ page, navigate }}>{children}</RouterContext.Provider>;
}
const useRouter = () => useContext(RouterContext);
const useAuth = () => useContext(AuthContext);

// ═══════════════════════════════════════════════
// 🎨 NAVBAR
// ═══════════════════════════════════════════════
function Navbar({ transparent = false }) {
  const { navigate, page } = useRouter();
  const { user, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  const bg = transparent ? "bg-transparent" : "bg-white shadow-sm";
  const textCol = transparent ? "text-white" : "text-gray-800";

  return (
    <nav className={`${bg} sticky top-0 z-50 ${!transparent ? "border-b border-gray-100" : ""}`}>
      <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2 cursor-pointer" onClick={() => navigate(user ? "/dashboard" : "/")}>
          <span style={{color:"#E65100", fontSize:"26px", fontWeight:"900", lineHeight:1}}>⛰</span>
          <span className="text-xl font-extrabold tracking-tighter font-headline" style={{color: transparent ? "white" : "#0D1B3E"}}>DRONNA</span>
        </div>

        {/* Desktop */}
        <div className="hidden md:flex items-center gap-2">
          {!user && <>
            <span className={`nav-link ${textCol}`} onClick={() => navigate("/syllabus")}>Syllabus</span>
            <span className={`nav-link ${textCol}`} onClick={() => navigate("/login")}>Login</span>
            <button className="btn-primary" onClick={() => navigate("/signup")}>Free में शुरू करें</button>
          </>}
          {user && <>
            <span className="nav-link text-gray-700" onClick={() => navigate("/dashboard")}>Dashboard</span>
            <span className="nav-link text-gray-700" onClick={() => navigate("/practice")}>Practice</span>
            <span className="nav-link text-gray-700" onClick={() => navigate("/daily")}>Daily</span>
            <span className="nav-link text-gray-700" onClick={() => navigate("/leaderboard")}>🏆 Leaderboard</span>
            <span className="nav-link text-gray-700" onClick={() => navigate("/syllabus")}>Syllabus</span>
            {user.isAdmin && <span className="nav-link text-orange-600 font-bold" onClick={() => navigate("/admin")}>Admin ⚙️</span>}
            <div className="flex items-center gap-2 ml-2">
              <div className="w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-sm cursor-pointer hover:opacity-80 transition-all" style={{background:"var(--saffron)"}} onClick={() => navigate("/profile")} title="Profile">{user.name?.[0]?.toUpperCase() || "U"}</div>
              <button className="btn-outline text-sm py-1 px-3" onClick={logout}>Logout</button>
            </div>
          </>}
        </div>

        {/* Mobile hamburger */}
        <button className={`md:hidden text-2xl ${textCol}`} onClick={() => setMenuOpen(!menuOpen)}>☰</button>
      </div>

      {menuOpen && (
        <div className="md:hidden bg-white border-t px-4 pb-4 flex flex-col gap-2">
          {!user && <>
            <span className="nav-link text-gray-700" onClick={() => { navigate("/syllabus"); setMenuOpen(false); }}>Syllabus</span>
            <span className="nav-link text-gray-700" onClick={() => { navigate("/login"); setMenuOpen(false); }}>Login</span>
            <button className="btn-primary w-full justify-center" onClick={() => { navigate("/signup"); setMenuOpen(false); }}>Free में शुरू करें</button>
          </>}
          {user && <>
            <span className="nav-link text-gray-700" onClick={() => { navigate("/dashboard"); setMenuOpen(false); }}>Dashboard</span>
            <span className="nav-link text-gray-700" onClick={() => { navigate("/practice"); setMenuOpen(false); }}>Practice</span>
            <span className="nav-link text-gray-700" onClick={() => { navigate("/daily"); setMenuOpen(false); }}>Daily Challenge</span>
            <span className="nav-link text-gray-700" onClick={() => { navigate("/leaderboard"); setMenuOpen(false); }}>🏆 Leaderboard</span>
            <span className="nav-link text-gray-700" onClick={() => { navigate("/syllabus"); setMenuOpen(false); }}>Syllabus</span>
            {user.isAdmin && <span className="nav-link text-orange-600" onClick={() => { navigate("/admin"); setMenuOpen(false); }}>Admin ⚙️</span>}
            <button className="btn-outline" onClick={() => { logout(); setMenuOpen(false); }}>Logout</button>
          </>}
        </div>
      )}
    </nav>
  );
}

// ═══════════════════════════════════════════════
// 🏠 LANDING PAGE
// ═══════════════════════════════════════════════
function LandingPage() {
  const { navigate } = useRouter();
  return (
    <div className="font-body text-on-surface">
      {/* NAV */}
      <nav className="bg-white/80 backdrop-blur-xl fixed w-full top-0 z-50 border-b border-surface-container" style={{borderColor:"#e0e3e5"}}>
        <div className="flex justify-between items-center w-full px-6 py-4 max-w-screen-2xl mx-auto">
          <div className="flex items-center gap-2 cursor-pointer" onClick={() => navigate("/")}>
            <span style={{color:"#E65100", fontSize:"28px", fontWeight:"900"}}>⛰</span>
            <div className="text-2xl font-extrabold tracking-tighter font-headline" style={{color:"#0D1B3E"}}>DRONNA</div>
          </div>
          <div className="hidden md:flex items-center gap-8 font-headline font-bold tracking-tight">
            <span className="cursor-pointer hover:text-secondary transition-colors" style={{color:"#E65100", borderBottom:"2px solid #E65100", paddingBottom:"4px"}}>अभ्यास (Practice)</span>
            <span className="cursor-pointer hover:text-secondary transition-colors" style={{color:"#616161"}} onClick={() => navigate("/dashboard")}>Dashboard</span>
            <span className="cursor-pointer hover:text-secondary transition-colors" style={{color:"#616161"}} onClick={() => navigate("/leaderboard")}>Leaderboard</span>
          </div>
          <div className="flex items-center gap-3">
            <button className="px-6 py-2 rounded-full font-bold hover:bg-gray-100 transition-all" style={{color:"#0D1B3E"}} onClick={() => navigate("/login")}>Sign In</button>
            <button className="px-6 py-2 rounded-full font-bold text-white shadow-lg" style={{background:"linear-gradient(135deg, #E65100, #F47B20)"}} onClick={() => navigate("/signup")}>Free शुरू करें</button>
          </div>
        </div>
      </nav>

      {/* HERO */}
      <section className="relative min-h-screen flex items-center overflow-hidden pt-16" style={{background:"#0D1B3E"}}>
        <div className="absolute inset-0 opacity-40 pointer-events-none overflow-hidden">
          <img alt="Himalayan range" className="w-full h-full object-cover object-bottom" src="https://lh3.googleusercontent.com/aida-public/AB6AXuDdqtYtkfUmUKuS97OCi_YY8Mpp6nDMhKFqjzE1I6VWotN1H1KP4vLVJIQXxFGg8mKOg4PVqlCP2EmnANWuGPZi3PAK1lqqk_CrkG7fA6R1xOpDDRR_ZftW4QvbLuB9dW-g5Xh1iLtHK83aUQAQyMulHSNLxWHaBh96Qcf2uzqKxi02OX1Ofajptk8wt11AK_UvKCfdFsxGrqcIN3wHiJToyULDRmDp732xNtEsnxR_eMTOkCS9G5IUYC3VoYSe5bFly5H6d9CaGA" style={{opacity:0.3}}/>
          <div className="absolute inset-0" style={{background:"linear-gradient(to top, #0D1B3E, rgba(13,27,62,0.6), transparent)"}}></div>
        </div>
        <div className="absolute inset-0 pointer-events-none" style={{backgroundImage:"radial-gradient(rgba(230,81,0,0.08) 1px, transparent 1px)", backgroundSize:"20px 20px"}}></div>

        <div className="max-w-screen-2xl mx-auto px-6 md:px-12 relative z-10 grid lg:grid-cols-2 gap-16 items-center py-20 w-full">
          <div className="space-y-8">
            <div className="inline-flex items-center gap-3 px-5 py-2.5 rounded-full border" style={{background:"rgba(255,255,255,0.1)", borderColor:"rgba(255,255,255,0.2)"}}>
              <span style={{color:"#F47B20"}}>🛕</span>
              <span className="text-xs font-extrabold tracking-widest uppercase" style={{color:"rgba(255,255,255,0.9)"}}>The Modern Gurukul of Uttarakhand</span>
            </div>
            <h1 className="font-hindi text-5xl md:text-7xl font-black leading-tight text-white">
              UKPSC & UKSSSC की <br/>
              <span style={{color:"#F47B20"}}>सर्वश्रेष्ठ तैयारी</span>
            </h1>
            <p className="text-xl md:text-2xl font-medium leading-relaxed max-w-xl" style={{color:"rgba(197,202,233,0.9)"}}>
              Personalized AI analysis और live practice content specifically designed for the brave aspirants of Devbhoomi.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 pt-4">
              <button className="px-10 py-5 rounded-2xl font-hindi text-2xl font-black text-white shadow-2xl flex items-center justify-center gap-3 hover:-translate-y-1 transition-all" style={{background:"linear-gradient(135deg, #E65100, #F47B20)", boxShadow:"0 20px 40px rgba(230,81,0,0.4)"}} onClick={() => navigate("/signup")}>
                शुरू करें (Start Free) →
              </button>
              <button className="px-10 py-5 rounded-2xl font-bold text-white hover:bg-white/10 transition-all border" style={{background:"rgba(255,255,255,0.05)", borderColor:"rgba(255,255,255,0.2)"}} onClick={() => navigate("/practice")}>
                View Practice Sets
              </button>
            </div>
          </div>

          <div className="relative hidden lg:block">
            <div className="absolute -inset-10 rounded-full blur-3xl" style={{background:"rgba(230,81,0,0.1)"}}></div>
            <div className="relative p-6 rounded-3xl border" style={{background:"rgba(255,255,255,0.05)", borderColor:"rgba(255,255,255,0.2)", backdropFilter:"blur(20px)"}}>
              <div className="overflow-hidden rounded-2xl relative">
                <img alt="Student studying" className="w-full aspect-video object-cover" src="https://lh3.googleusercontent.com/aida-public/AB6AXuBtTep9pmrnXmLQWrKwO25aZmpeli9tJKEQevPA5D5xla4wp2_dSFc68RHzJjCYJGMq-0L72kd508FoH_J1UXyH7BEYKLxWBVkhzuDmhi5ERrBHQHJ2w6tGBzduyb5Lj2zOiWLtS3t6uABIbi_t7w39jqKVW1mWDTIDZpQ9dHOzDudlPHJkAM4V6JSlTY4A2pJrSpiwTQLFXVKaVjzkJpnYE8PWgEnmj-DI7xhQFibuxgV-UUhOrBagRpCZy6CsgIwxOVO7KPOEmw"/>
                <div className="absolute inset-0" style={{background:"linear-gradient(to top, rgba(13,27,62,0.8), transparent)"}}></div>
              </div>
              <div className="absolute -bottom-8 -left-8 bg-white p-6 rounded-3xl shadow-2xl max-w-xs border" style={{borderColor:"#e0e3e5"}}>
                <div className="flex items-center gap-3 mb-3">
                  <div className="p-2 rounded-lg" style={{background:"rgba(230,81,0,0.1)"}}>
                    <span style={{color:"#E65100", fontSize:"20px"}}>📊</span>
                  </div>
                  <span className="font-black text-sm" style={{color:"#0D1B3E"}}>AI Scorecard</span>
                </div>
                <div className="h-3 w-full rounded-full overflow-hidden" style={{background:"#F5F5F5"}}>
                  <div className="h-full rounded-full" style={{width:"88%", background:"#E65100"}}></div>
                </div>
                <p className="text-xs font-bold uppercase tracking-wider mt-3" style={{color:"#616161"}}>UKPSC Pre Match: 88%</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* STATS */}
      <section className="relative z-20 max-w-screen-xl mx-auto px-6 -mt-12">
        <div className="bg-white rounded-3xl shadow-2xl border overflow-hidden grid grid-cols-1 md:grid-cols-3" style={{borderColor:"#f0f2f5"}}>
          {[
            {num:"10,000+", label:"सक्रिय छात्र (Active Students)"},
            {num:"2,500+", label:"अभ्यास प्रश्न (Questions)"},
            {num:"95%", label:"सफलता दर (Success Rate)"}
          ].map((s, i) => (
            <div key={i} className="p-12 text-center group" style={{borderRight: i < 2 ? "1px solid #f0f2f5" : "none"}}>
              <h3 className="text-5xl font-black font-headline group-hover:text-secondary transition-colors" style={{color:"#0D1B3E"}}>{s.num}</h3>
              <p className="font-bold uppercase tracking-widest text-xs mt-3" style={{color:"#9E9E9E"}}>{s.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* FEATURES BENTO */}
      <section className="py-24 px-6" style={{background:"#F9F9F9"}}>
        <div className="max-w-screen-2xl mx-auto">
          <div className="mb-20 text-center">
            <h2 className="font-hindi text-4xl md:text-6xl font-black mb-6" style={{color:"#0D1B3E"}}>हमारी विशेषताएँ</h2>
            <div className="w-32 h-2 rounded-full mx-auto" style={{background:"#F47B20"}}></div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-12 gap-8">
            <div className="md:col-span-8 rounded-3xl p-12 flex flex-col justify-between text-white relative overflow-hidden min-h-96" style={{background:"#0D1B3E"}}>
              <div className="absolute top-0 right-0 w-80 h-80 rounded-full blur-3xl" style={{background:"rgba(244,123,32,0.2)", top:"-80px", right:"-80px"}}></div>
              <div className="relative z-10">
                <span style={{fontSize:"48px", marginBottom:"24px", display:"block"}}>🧠</span>
                <h3 className="text-4xl font-black mb-4 font-headline">AI आधारित प्रदर्शन विश्लेषण<br/><span className="text-2xl font-bold opacity-80">(AI Performance Analysis)</span></h3>
                <p className="text-xl max-w-xl leading-relaxed" style={{color:"rgba(197,202,233,0.9)"}}>Advanced algorithms tailored to analyze your grip on Uttarakhand-specific subjects and general aptitude.</p>
              </div>
              <div className="flex flex-wrap gap-4 mt-12 relative z-10">
                {["Real-time Feedback", "Weak Area Identification", "Personalized Tips"].map(tag => (
                  <span key={tag} className="px-6 py-2 rounded-full text-sm font-bold border" style={{background:"rgba(255,255,255,0.1)", borderColor:"rgba(255,255,255,0.15)"}}>{tag}</span>
                ))}
              </div>
            </div>
            <div className="md:col-span-4 bg-white rounded-3xl p-10 flex flex-col justify-center shadow-xl border-b-8 hover:-translate-y-2 transition-all" style={{borderBottomColor:"#E65100"}}>
              <span style={{fontSize:"48px", marginBottom:"24px", display:"block"}}>📚</span>
              <h3 className="text-3xl font-black mb-4 font-headline" style={{color:"#0D1B3E"}}>Live अभ्यास सामग्री</h3>
              <p className="text-lg font-medium" style={{color:"#616161"}}>Question bank और paper collections अब सीधे live admin panel से manage होते हैं.</p>
            </div>
            <div className="md:col-span-4 bg-white rounded-3xl p-10 flex flex-col justify-center shadow-xl hover:-translate-y-2 transition-all">
              <span style={{fontSize:"48px", marginBottom:"24px", display:"block"}}>🏆</span>
              <h3 className="text-3xl font-black mb-4 font-headline" style={{color:"#0D1B3E"}}>दैनिक चुनौतियां</h3>
              <p className="text-lg font-medium" style={{color:"#616161"}}>Daily challenges to keep you consistent in your journey to the secretariat.</p>
            </div>
            <div className="md:col-span-8 rounded-3xl p-10 flex items-center gap-12 shadow-xl" style={{background:"#E2E8F0"}}>
              <div>
                <span style={{fontSize:"48px", marginBottom:"24px", display:"block"}}>✅</span>
                <h3 className="text-4xl font-black mb-4 font-headline" style={{color:"#0D1B3E"}}>पूर्ण पाठ्यक्रम (Full Syllabus)</h3>
                <p className="text-xl font-medium" style={{color:"#616161"}}>Every topic from the latest notifications, mapped systematically for quick revision.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* PRICING */}
      <section className="py-24 bg-white">
        <div className="max-w-screen-xl mx-auto px-6">
          <div className="text-center mb-20">
            <h2 className="font-hindi text-4xl md:text-6xl font-black mb-4" style={{color:"#0D1B3E"}}>किफायती प्लान्स</h2>
            <p className="text-xl font-bold uppercase tracking-widest opacity-60" style={{color:"#616161"}}>Investment for your future career</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 items-stretch">
            <div className="p-10 rounded-3xl flex flex-col border hover:shadow-xl transition-all" style={{background:"#F9F9F9", borderColor:"#EEEEEE"}}>
              <div className="mb-8">
                <h4 className="text-xl font-black uppercase tracking-widest" style={{color:"#9E9E9E"}}>Free</h4>
                <div className="text-5xl font-black mt-3" style={{color:"#0D1B3E"}}>₹0 <span className="text-lg font-bold" style={{color:"#9E9E9E"}}>/month</span></div>
              </div>
              <ul className="space-y-4 mb-10 flex-grow">
                {["Daily 10 Practice Questions", "Basic Tracking"].map(f => <li key={f} className="flex items-center gap-3 font-bold"><span style={{color:"#F47B20"}}>✓</span>{f}</li>)}
                <li className="flex items-center gap-3 font-bold opacity-30"><span>✗</span>No AI Analysis</li>
              </ul>
              <button className="w-full py-4 bg-white font-black rounded-2xl border-2 text-lg hover:bg-gray-50 transition-all" style={{color:"#0D1B3E", borderColor:"#EEEEEE"}} onClick={() => navigate("/signup")}>Get Started</button>
            </div>

            <div className="p-10 rounded-3xl flex flex-col relative overflow-hidden border-4 shadow-2xl scale-105 aipan-pattern-card" style={{background:"#0D1B3E", borderColor:"rgba(244,123,32,0.3)"}}>
              <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 px-8 py-2 text-white text-xs font-black rounded-full uppercase tracking-widest shadow-xl" style={{background:"linear-gradient(135deg, #E65100, #F47B20)"}}>Popular</div>
              <div className="mb-8">
                <h4 className="text-xl font-black uppercase tracking-widest" style={{color:"rgba(197,202,233,0.8)"}}>Pro</h4>
                <div className="text-5xl font-black mt-3 text-white">Contact Admin</div>
              </div>
              <ul className="space-y-4 mb-10 flex-grow">
                {["Unlimited Practice Sets", "Full AI Insights", "Mock Test Series", "Uttarakhand GK Bundle"].map(f => <li key={f} className="flex items-center gap-3 font-bold text-white"><span style={{color:"#F47B20"}}>⭐</span>{f}</li>)}
              </ul>
              <button className="w-full py-4 font-black rounded-2xl text-white text-xl shadow-2xl hover:scale-105 transition-all" style={{background:"linear-gradient(135deg, #E65100, #F47B20)"}} onClick={() => navigate("/signup")}>Join Pro Now</button>
            </div>

            <div className="p-10 rounded-3xl flex flex-col border hover:shadow-xl transition-all" style={{background:"#F9F9F9", borderColor:"#EEEEEE"}}>
              <div className="mb-8">
                <h4 className="text-xl font-black uppercase tracking-widest" style={{color:"#9E9E9E"}}>Lifetime</h4>
                <div className="text-5xl font-black mt-3" style={{color:"#0D1B3E"}}>Custom Plan</div>
              </div>
              <ul className="space-y-4 mb-10 flex-grow">
                {["All Pro Features Forever", "Personal Mentorship Session", "Priority Support"].map(f => <li key={f} className="flex items-center gap-3 font-bold"><span style={{color:"#F47B20"}}>✓</span>{f}</li>)}
              </ul>
              <button className="w-full py-4 font-black rounded-2xl border-2 text-lg hover:bg-primary hover:text-white transition-all" style={{color:"#0D1B3E", borderColor:"#0D1B3E"}} onClick={() => navigate("/signup")}>Select Lifetime</button>
            </div>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="text-white relative overflow-hidden pt-16 pb-10" style={{background:"#0D1B3E"}}>
        <div className="max-w-screen-2xl mx-auto px-8 relative z-10">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-12 mb-16">
            <div className="space-y-6 md:col-span-2">
              <div className="flex items-center gap-3">
                <span style={{color:"#F47B20", fontSize:"28px"}}>⛰</span>
                <div className="text-3xl font-black tracking-tighter font-headline">DRONNA</div>
              </div>
              <p className="text-lg leading-relaxed max-w-sm" style={{color:"rgba(197,202,233,0.8)"}}>उत्तराखंड की प्रीमियम परीक्षाओं की तैयारी के लिए आधुनिक गुरुकुल।</p>
            </div>
            <div className="space-y-4">
              <p className="text-xl font-black text-white">Courses</p>
              <ul className="space-y-3" style={{color:"rgba(197,202,233,0.7)"}}>
                {["LT Grade", "Uttarakhand PCS", "Group C", "Forest Guard"].map(c => <li key={c}><a className="hover:text-orange-400 transition-colors font-bold" href="#">{c}</a></li>)}
              </ul>
            </div>
            <div className="space-y-4">
              <p className="text-xl font-black text-white">Company</p>
              <ul className="space-y-3" style={{color:"rgba(197,202,233,0.7)"}}>
                {["About Us", "Privacy Policy", "Student Support"].map(c => <li key={c}><a className="hover:text-orange-400 transition-colors font-bold" href="#">{c}</a></li>)}
              </ul>
            </div>
          </div>
          <div className="pt-8 border-t flex flex-col md:flex-row justify-between items-center gap-4" style={{borderColor:"rgba(255,255,255,0.1)"}}>
            <div className="text-sm font-bold" style={{color:"rgba(197,202,233,0.6)"}}>© 2025 Dronna - The Modern Gurukul. Crafted with ❤️ for Uttarakhand.</div>
            <div className="flex items-center gap-4 text-xs font-black uppercase tracking-widest" style={{color:"#F47B20"}}>
              <span>Jai Badri Vishal</span><span>•</span><span>Jai Kedar</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

function LoginPage() {
  const { navigate } = useRouter();
  const { login } = useAuth();
  const [form, setForm] = useState({ email:"", password:"" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleLogin = async () => {
    if (!form.email || !form.password) { setError("सभी fields भरें"); return; }
    setLoading(true); setError("");

    // DEFAULT — login band hai jab tak Supabase confirm na kare
    let loginAllowed = false;
    let userData = null;

    try {
      const r = await fetch(`${CONFIG.SUPABASE_URL}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: { "apikey": CONFIG.SUPABASE_ANON_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ email: form.email, password: form.password })
      });

      const res = await r.json();

      // Sirf tab allow karo jab HTTP 200 aaye AND access_token mile
      if (r.status === 200 && res.access_token && !res.error) {
        // Profile fetch karo
        try {
          const profRes = await fetch(
            `${CONFIG.SUPABASE_URL}/rest/v1/students?email=eq.${encodeURIComponent(form.email)}&select=*&apikey=${CONFIG.SUPABASE_ANON_KEY}`,
            { headers: { "apikey": CONFIG.SUPABASE_ANON_KEY, "Authorization": `Bearer ${res.access_token}` } }
          );
          const students = await profRes.json();
          const profile = Array.isArray(students) && students[0] ? students[0] : null;
          userData = {
            email: form.email,
            name: profile?.full_name || form.email.split("@")[0],
            exam_target: profile?.exam_target || "UKPSC",
            subscription_plan: profile?.subscription_plan || "free",
            auth_id: res.user?.id,
            access_token: res.access_token
          };
        } catch {
          userData = {
            email: form.email,
            name: form.email.split("@")[0],
            exam_target:"UKPSC",
            subscription_plan:"free",
            auth_id: res.user?.id,
            access_token: res.access_token
          };
        }
        loginAllowed = true;
      } else {
        // Wrong password ya email
        setError("❌ Incorrect email or password");
      }
    } catch(e) {
      setError("❌ Network error — please check your internet connection");
    }

    // STRICT — sirf tabhi login karo jab explicitly allowed ho
    if (loginAllowed && userData) {
      await login(userData);
      navigate("/dashboard");
    }

    setLoading(false);
  };

  return (
    <div className="min-h-screen flex flex-col" style={{background:"var(--cream)"}}>
      <Navbar />
      <div className="flex-1 flex items-center justify-center p-4">
        <div className="w-full max-w-md fade-in">
          <div className="card">
            <div className="text-center mb-8">
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center font-black text-white text-3xl mx-auto mb-4" style={{background:"linear-gradient(135deg, #F97316, #FBBF24)"}}>ड</div>
              <h1 className="text-2xl font-black" style={{color:"var(--navy)"}}>Dronna में Login करें</h1>
              <p className="text-gray-400 text-sm mt-1">अपनी तैयारी जारी रखें</p>
            </div>
            {error && <div className="bg-red-50 border border-red-200 text-red-600 rounded-lg p-3 mb-4 text-sm">{error}</div>}
            <div className="space-y-4">
              <div>
                <label>Email</label>
                <input type="email" placeholder="your@email.com" value={form.email} onChange={e=>setForm({...form,email:e.target.value})} />
              </div>
              <div>
                <label>Password</label>
                <input type="password" placeholder="••••••••" value={form.password} onChange={e=>setForm({...form,password:e.target.value})} onKeyDown={e=>e.key==="Enter"&&handleLogin()} />
              </div>
              <button className="btn-primary w-full justify-center py-3" onClick={handleLogin} disabled={loading}>
                {loading ? "Logging in..." : "Login करें"}
              </button>
            </div>
            <p className="text-center text-sm text-gray-500 mt-4">
              Account नहीं है? <span className="text-orange-500 font-bold cursor-pointer" onClick={()=>navigate("/signup")}>Sign up करें</span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════
// 📝 SIGNUP PAGE
// ═══════════════════════════════════════════════
function SignupPage() {
  const { navigate } = useRouter();
  const { login } = useAuth();
  const [form, setForm] = useState({ name:"", email:"", password:"", exam_target:"UKPSC" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSignup = async () => {
    if (!form.name || !form.email || !form.password) { setError("सभी fields भरें"); return; }
    if (form.password.length < 6) { setError("❌ Password कम से कम 6 characters का होना चाहिए"); return; }
    setLoading(true); setError("");

    try {
      // Step 1: Pehle check karo — kya ye email pehle se registered hai?
      const checkRes = await fetch(
        `${CONFIG.SUPABASE_URL}/rest/v1/students?email=eq.${encodeURIComponent(form.email)}&select=email&apikey=${CONFIG.SUPABASE_ANON_KEY}`,
        { headers: SB_HEADERS }
      );
      const existing = await checkRes.json();
      if (Array.isArray(existing) && existing.length > 0) {
        setError("❌ This email is already registered — please Login");
        setLoading(false); return;
      }

      // Step 2: Supabase Auth mein signup karo
      const r = await fetch(`${CONFIG.SUPABASE_URL}/auth/v1/signup`, {
        method: "POST",
        headers: { "apikey": CONFIG.SUPABASE_ANON_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ email: form.email, password: form.password })
      });
      const res = await r.json();

      // Supabase Auth error check
      if (!r.ok || res.error || res.error_code) {
        if (res.error?.includes("already") || res.msg?.includes("already")) {
          setError("❌ This email is already registered — please Login");
        } else {
          setError("❌ " + (res.error_description || res.msg || res.error || "Signup failed"));
        }
        setLoading(false); return;
      }

      const authUserId = res.user?.id || res.id || null;

      // Step 3: Students table mein save karo
      await supabase.insert("students", {
        auth_user_id: authUserId,
        full_name: form.name,
        email: form.email,
        exam_target: form.exam_target,
        subscription_plan: "free"
      });

      // Step 4: Login karke dashboard pe bhejo
      await login({
        email: form.email,
        name: form.name,
        exam_target: form.exam_target,
        subscription_plan: "free",
        auth_id: authUserId
      });
      navigate("/dashboard");

    } catch(e) {
      setError("❌ Network error — please check your internet connection");
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex flex-col" style={{background:"var(--cream)"}}>
      <Navbar />
      <div className="flex-1 flex items-center justify-center p-4">
        <div className="w-full max-w-md fade-in">
          <div className="card">
            <div className="text-center mb-8">
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center font-black text-white text-3xl mx-auto mb-4" style={{background:"linear-gradient(135deg, #F97316, #FBBF24)"}}>ड</div>
              <h1 className="text-2xl font-black" style={{color:"var(--navy)"}}>Free Account बनाएं</h1>
              <p className="text-gray-400 text-sm mt-1">कोई credit card नहीं चाहिए</p>
            </div>
            {error && <div className="bg-red-50 border border-red-200 text-red-600 rounded-lg p-3 mb-4 text-sm">{error}</div>}
            <div className="space-y-4">
              <div>
                <label>पूरा नाम</label>
                <input type="text" placeholder="आपका नाम" value={form.name} onChange={e=>setForm({...form,name:e.target.value})} />
              </div>
              <div>
                <label>Email</label>
                <input type="email" placeholder="your@email.com" value={form.email} onChange={e=>setForm({...form,email:e.target.value})} />
              </div>
              <div>
                <label>Dronna के लिए नया Password बनाएं</label>
                <input type="password" placeholder="नया password डालें (कम से कम 6 अक्षर)" value={form.password} onChange={e=>setForm({...form,password:e.target.value})} />
                <p className="text-xs text-gray-400 mt-1">⚠️ यह आपके Email का password नहीं है — Dronna के लिए अलग password बनाएं</p>
              </div>
              <div>
                <label>Target Exam</label>
                <select value={form.exam_target} onChange={e=>setForm({...form,exam_target:e.target.value})}>
                  <option value="UKPSC">UKPSC (LT Grade / PCS / Lecturer)</option>
                  <option value="UKSSSC">UKSSSC (Group C / VDO / Forest Guard)</option>
                  <option value="Both">दोनों की तैयारी</option>
                </select>
              </div>
              <button className="btn-primary w-full justify-center py-3" onClick={handleSignup} disabled={loading}>
                {loading ? "Creating account..." : "🚀 Account बनाएं — Free"}
              </button>
            </div>
            <p className="text-center text-sm text-gray-500 mt-4">
              पहले से account है? <span className="text-orange-500 font-bold cursor-pointer" onClick={()=>navigate("/login")}>Login करें</span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════
// 🤖 AI FEEDBACK CARD COMPONENT
// ═══════════════════════════════════════════════
function AIFeedbackCard({ attempts, name, examTarget, avgScore, bestScore, totalAttempts }) {
  const [feedback, setFeedback] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const loadFeedback = async () => {
    if (totalAttempts === 0) return;
    setLoading(true);

    // Trend calculate karo
    let trend = "stable";
    if (attempts.length >= 3) {
      const last3 = attempts.slice(-3).map(a => Math.round((a.score/(a.total_questions||1))*100));
      if (last3[2] > last3[0]) trend = "improving";
      else if (last3[2] < last3[0]) trend = "declining";
    }

    const worstScore = attempts.length > 0 ? Math.min(...attempts.map(a => Math.round((a.score/(a.total_questions||1))*100))) : 0;

    const result = await getGroq({
      name,
      examTarget,
      totalAttempts,
      avgScore,
      bestScore,
      worstScore,
      trend,
      recentAttempts: attempts
    });

    setFeedback(result);
    setLoaded(true);
    setLoading(false);
  };

  // Parse feedback into sections
  const parseFeedback = (text) => {
    if (!text) return null;
    const lines = text.split("\n").filter(l => l.trim());
    const summary = lines[0] || "";
    const points = lines.filter(l => { const t=l.trim(); return t.length>1 && t[0]>="1" && t[0]<="4" && (t[1]==="." || t[1]===")"); });
    const rest = lines.filter(l => { const t=l.trim(); const ip=t.length>1&&t[0]>="1"&&t[0]<="4"&&(t[1]==="."||t[1]===")"); return !ip && l !== lines[0]; });
    return { summary, points, rest };
  };

  const parsed = parseFeedback(feedback);

  const trendColor = () => {
    if (attempts.length < 3) return "text-gray-400";
    const last3 = attempts.slice(-3).map(a => Math.round((a.score/(a.total_questions||1))*100));
    if (last3[2] > last3[0]) return "text-green-600";
    if (last3[2] < last3[0]) return "text-red-500";
    return "text-gray-500";
  };

  return (
    <div className="bg-white rounded-3xl shadow-sm overflow-hidden" style={{border:"2px solid var(--cream-dark)"}}>
      {/* Header */}
      <div className="p-4 flex items-center justify-between" style={{background:"linear-gradient(135deg, #0D1B3E, #1a3a6e)"}}>
        <div className="flex items-center gap-2">
          <span className="text-xl">📋</span>
          <div>
            <div className="font-black text-white text-sm">प्रदर्शन विश्लेषण</div>
            <div className="text-white/50 text-xs">आपके गुरुजी की राय</div>
          </div>
        </div>
        {totalAttempts > 0 && (
          <button
            onClick={loadFeedback}
            disabled={loading}
            className="text-xs font-bold px-3 py-1 rounded-lg transition-all"
            style={{background: loaded ? "rgba(255,255,255,0.1)" : "var(--saffron)", color:"white"}}
          >
            {loading ? "⏳" : loaded ? "🔄 Update" : "विश्लेषण करो"}
          </button>
        )}
      </div>

      <div className="p-4">
        {totalAttempts === 0 ? (
          <div className="text-center py-4">
            <div className="text-3xl mb-2">📝</div>
            <p className="text-xs text-gray-500 devanagari">पहला टेस्ट पूरा करो</p>
            <p className="text-xs text-gray-400 devanagari">फिर गुरुजी आपकी कमज़ोरी बताएंगे</p>
          </div>
        ) : !loaded && !loading ? (
          <div className="text-center py-3">
            <div className="grid grid-cols-3 gap-2 mb-3 text-center">
              <div className="bg-orange-50 rounded-xl p-2">
                <div className="font-black text-orange-600">{avgScore}%</div>
                <div className="text-xs text-gray-400">औसत</div>
              </div>
              <div className="bg-green-50 rounded-xl p-2">
                <div className="font-black text-green-600">{bestScore}%</div>
                <div className="text-xs text-gray-400">सर्वश्रेष्ठ</div>
              </div>
              <div className={`rounded-xl p-2 ${trendColor().includes("green") ? "bg-green-50" : trendColor().includes("red") ? "bg-red-50" : "bg-gray-50"}`}>
                <div className={"font-black " + trendColor()}>
                  {attempts.length >= 3 ? (trendColor().includes("green") ? "↑" : trendColor().includes("red") ? "↓" : "→") : "—"}
                </div>
                <div className="text-xs text-gray-400">Trend</div>
              </div>
            </div>
            <button onClick={loadFeedback} className="btn-primary w-full justify-center text-sm py-2">
              🎯 गुरुजी से सलाह लो
            </button>
          </div>
        ) : loading ? (
          <div className="py-4 space-y-2">
            <div className="flex items-center gap-2 text-xs text-gray-400 mb-3">
              <div className="w-4 h-4 border-2 border-orange-200 border-t-orange-500 rounded-full animate-spin"></div>
              <span className="devanagari">गुरुजी सोच रहे हैं...</span>
            </div>
            {[90, 70, 85, 60].map((w,i) => (
              <div key={i} className="h-2 bg-gray-100 rounded animate-pulse" style={{width: w + "%"}}></div>
            ))}
          </div>
        ) : parsed ? (
          <div className="space-y-3">
            {/* Summary line */}
            {parsed.summary && (
              <p className="text-xs font-semibold text-gray-700 devanagari leading-relaxed bg-orange-50 p-2 rounded-lg border-l-4 border-orange-400">
                {parsed.summary}
              </p>
            )}
            {/* Numbered points */}
            {parsed.points.map((point, i) => {
              const colors = [
                {bg:"bg-blue-50", border:"border-blue-400", num:"bg-blue-500"},
                {bg:"bg-red-50", border:"border-red-400", num:"bg-red-500"},
                {bg:"bg-yellow-50", border:"border-yellow-400", num:"bg-yellow-500"},
                {bg:"bg-green-50", border:"border-green-400", num:"bg-green-500"},
              ];
              const c = colors[i % 4];
              const text = (point.length > 2 && (point[1]==="." || point[1]===")")) ? point.slice(2).trim() : point.trim();
              return (
                <div key={i} className={"flex items-start gap-2 p-2 rounded-xl border-l-4 " + c.bg + " " + c.border}>
                  <span className={"w-5 h-5 rounded-full flex items-center justify-center text-white text-xs font-black flex-shrink-0 mt-0.5 " + c.num}>
                    {i+1}
                  </span>
                  <p className="text-xs text-gray-700 devanagari leading-relaxed">{text}</p>
                </div>
              );
            })}
            {/* Any remaining text */}
            {parsed.rest.map((line, i) => (
              <p key={i} className="text-xs text-gray-500 devanagari leading-relaxed">{line}</p>
            ))}
          </div>
        ) : (
          <p className="text-xs text-gray-400 text-center py-3 devanagari">विश्लेषण उपलब्ध नहीं</p>
        )}
      </div>
    </div>
  );
}


// ═══════════════════════════════════════════════
// 🤖 AI FEEDBACK CARD
// ═══════════════════════════════════════════════
// ═══════════════════════════════════════════════
// 📊 DASHBOARD
// ═══════════════════════════════════════════════
function Dashboard() {
  const { navigate } = useRouter();
  const { user } = useAuth();
  const [feedback, setFeedback] = useState("");
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [dbAttempts, setDbAttempts] = useState([]);
  const [streak, setStreak] = useState(0);
  const [dailyDone, setDailyDone] = useState(false);
  const today = new Date().toDateString();
  const todayDate = new Date().toISOString().split("T")[0];
  const chartRef = useRef(null);

  useEffect(() => { loadAttempts(); }, []);
  useEffect(() => { loadStudentStats(); }, []);

  const loadAttempts = async () => {
    try {
      const url = CONFIG.SUPABASE_URL + "/rest/v1/attempts?student_email=eq." + encodeURIComponent(user?.email) + "&select=*&order=completed_at.asc&apikey=" + CONFIG.SUPABASE_ANON_KEY;
      const r = await fetch(url, { headers: SB_HEADERS });
      const data = await r.json();
      if (Array.isArray(data)) setDbAttempts(data);
    } catch(e) {}
  };

  const loadStudentStats = async () => {
    if (!user?.email) return;
    const data = await supabase.getStudentData(user.email);
    if (data) {
      setStreak(data.streak || 0);
      setDailyDone(data.last_daily_date === todayDate);
    } else {
      setStreak(parseInt(localStorage.getItem("dronna_streak") || "0"));
      setDailyDone(localStorage.getItem("dronna_daily_date") === today);
    }
  };

  useEffect(() => {
    if (dbAttempts.length > 0 && document.getElementById("performanceChart")) {
      const ctx = document.getElementById("performanceChart").getContext("2d");
      if (chartRef.current) chartRef.current.destroy();
      const last7 = dbAttempts.slice(-7);
      const labels = last7.map((a, i) => "Test " + (i + 1));
      const scores = last7.map(a => Math.round((a.score / (a.total_questions || 1)) * 100));
      chartRef.current = new Chart(ctx, {
        type: "line",
        data: {
          labels: labels,
          datasets: [{ label: "Score %", data: scores, borderColor: "#F47B20", backgroundColor: "rgba(244,123,32,0.1)", borderWidth: 3, tension: 0.4, fill: true, pointBackgroundColor: "#F47B20", pointRadius: 5 }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          scales: { y: { beginAtZero: true, max: 100, grid: { display: false } }, x: { grid: { display: false } } },
          plugins: { legend: { display: false } }
        }
      });
    }
  }, [dbAttempts]);

  const totalAttempts = dbAttempts.length;
  const avgScore = totalAttempts > 0 ? Math.round(dbAttempts.reduce((a,b) => a + ((b.score/(b.total_questions||1))*100), 0) / totalAttempts) : 0;
  const bestScore = totalAttempts > 0 ? Math.max(...dbAttempts.map(a => Math.round((a.score/(a.total_questions||1))*100))) : 0;

  if (!user) return <div className="p-8 text-center">Please login first</div>;

  return (
    <div className="font-body min-h-screen" style={{background:"#FAFAFA"}}>
      {/* TOP NAV */}
      <nav className="bg-white/80 backdrop-blur-xl border-b sticky top-0 z-50" style={{borderColor:"#E0E0E0"}}>
        <div className="flex justify-between items-center w-full px-6 py-4 max-w-screen-2xl mx-auto">
          <div className="flex items-center gap-8">
            <div className="flex items-center gap-2 cursor-pointer" onClick={() => navigate("/dashboard")}>
              <span style={{color:"#E65100", fontSize:"26px", fontWeight:"900", lineHeight:1}}>⛰</span>
              <span className="text-xl font-extrabold tracking-tighter font-headline" style={{color:"#0D1B3E"}}>DRONNA</span>
            </div>
            <div className="hidden md:flex gap-8">
              <span className="font-headline font-bold text-sm cursor-pointer hover:text-secondary transition-colors" style={{color:"#616161"}} onClick={() => navigate("/practice")}>Practice</span>
              <span className="font-headline font-bold text-sm border-b-2 pb-1" style={{color:"#E65100", borderColor:"#E65100"}}>Dashboard</span>
              <span className="font-headline font-bold text-sm cursor-pointer hover:text-secondary transition-colors" style={{color:"#616161"}} onClick={() => navigate("/leaderboard")}>Leaderboard</span>
              {user.isAdmin && <span className="font-headline font-bold text-sm cursor-pointer" style={{color:"#E65100"}} onClick={() => navigate("/admin")}>Admin ⚙️</span>}
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold border-2 shadow-sm" style={{background:"#0D1B3E", borderColor:"#E0E0E0"}}>
              {user.name?.[0]?.toUpperCase() || "U"}
            </div>
            <button className="text-sm font-bold px-4 py-2 rounded-full border hover:bg-gray-100 transition-all" style={{color:"#0D1B3E", borderColor:"#E0E0E0"}} onClick={() => { localStorage.removeItem("dronna_user"); window.location.reload(); }}>Logout</button>
          </div>
        </div>
      </nav>

      <main className="w-full max-w-screen-2xl mx-auto px-6 py-8 grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* LEFT MAIN */}
        <div className="lg:col-span-8 space-y-8">

          {/* GREETING HEADER */}
          <header className="relative p-10 rounded-2xl text-white overflow-hidden shadow-xl" style={{background:"#0D1B3E"}}>
            <div className="absolute inset-0 pointer-events-none" style={{opacity:0.06, backgroundImage:"radial-gradient(rgba(255,255,255,0.8) 1px, transparent 1px)", backgroundSize:"20px 20px"}}></div>
            <div className="relative z-10 space-y-2">
              <h1 className="text-3xl md:text-5xl font-headline font-extrabold tracking-tight">
                नमस्ते, <span style={{color:"#F47B20"}}>{user.name || "Aspirant"}</span>! 👋
              </h1>
              <p className="font-medium text-lg md:text-xl max-w-xl" style={{color:"rgba(197,202,233,0.9)"}}>
                Target: <strong>{user.exam_target}</strong> • Plan: <span className="px-2 py-0.5 rounded-full text-xs font-black" style={{background:"rgba(244,123,32,0.2)", color:"#F47B20"}}>{user.subscription_plan?.toUpperCase() || "FREE"}</span>
              </p>
            </div>
          </header>

          {/* STATS ROW */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              {label:"Total Tests", value: totalAttempts || 0, extra: totalAttempts > 0 ? "+"+totalAttempts : ""},
              {label:"Avg Score %", value: avgScore + "%", extra: ""},
              {label:"Best Score", value: bestScore + "%", extra: bestScore >= 90 ? "Top 5%" : ""},
              {label:"Day Streak 🔥", value: streak, extra: "Days"},
            ].map((s, i) => (
              <div key={i} className="bg-white p-6 rounded-xl border shadow-sm hover:shadow-md transition-all subtle-aipan-border" style={{borderColor:"#EEEEEE"}}>
                <span className="text-xs font-extrabold uppercase tracking-widest block mb-2" style={{color:"#9E9E9E"}}>{s.label}</span>
                <div className="flex items-end gap-2">
                  <span className="text-3xl font-headline font-extrabold" style={{color:"#0D1B3E"}}>{s.value}</span>
                  {s.extra && <span className="text-xs font-bold mb-1.5 px-2 py-0.5 rounded-full" style={{color:"#E65100", background:"rgba(230,81,0,0.1)"}}>{s.extra}</span>}
                </div>
              </div>
            ))}
          </div>

          {/* CHART + AI */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="md:col-span-2 bg-white p-8 rounded-2xl border shadow-sm" style={{borderColor:"#EEEEEE"}}>
              <div className="flex justify-between items-center mb-6">
                <div>
                  <h2 className="font-headline font-bold text-xl" style={{color:"#0D1B3E"}}>Performance Trend</h2>
                  <p className="text-xs mt-1" style={{color:"#9E9E9E"}}>Last 7 attempts</p>
                </div>
                <span className="text-xs font-extrabold tracking-widest uppercase" style={{color:"#9E9E9E"}}>Score %</span>
              </div>
              <div className="h-48 w-full">
                {totalAttempts > 0 ? (
                  <canvas id="performanceChart"></canvas>
                ) : (
                  <div className="h-full flex items-center justify-center border-2 border-dashed rounded-2xl" style={{borderColor:"#E0E0E0"}}>
                    <p className="text-sm font-hindi" style={{color:"#9E9E9E"}}>ग्राफ देखने के लिए पहला टेस्ट पूरा करें</p>
                  </div>
                )}
              </div>
              {totalAttempts > 0 && (
                <div className="flex justify-between mt-4 px-1">
                  {dbAttempts.slice(-7).map((_, i) => (
                    <span key={i} className="text-xs font-extrabold" style={{color:"#9E9E9E"}}>T{i+1}</span>
                  ))}
                </div>
              )}
            </div>

            {/* AI FEEDBACK */}
            <AIFeedbackCard
              attempts={dbAttempts}
              name={user?.name}
              examTarget={user?.exam_target}
              avgScore={avgScore}
              bestScore={bestScore}
              totalAttempts={totalAttempts}
            />
          </div>

          {/* DAILY CHALLENGE BANNER */}
          <div className="relative p-0.5 rounded-2xl" style={{background:"linear-gradient(135deg, #F47B20, #E65100)"}}>
            <div className="bg-white px-8 py-8 rounded-2xl flex flex-col md:flex-row items-center justify-between gap-6">
              <div className="flex items-center gap-6">
                <div className="w-16 h-16 rounded-full flex items-center justify-center text-3xl shadow-inner" style={{background:"#FFF3E0"}}>🏔️</div>
                <div>
                  <h3 className="text-2xl font-headline font-extrabold" style={{color:"#0D1B3E"}}>{dailyDone ? "✅ Daily Challenge Done!" : "Daily Challenge"}</h3>
                  <p className="text-base mt-1" style={{color:"#616161"}}>
                    {dailyDone ? "कल फिर आना — नए सवाल इंतज़ार कर रहे हैं" : "आज की 5 प्रश्नोत्तरी हल करें और streak बनाएं"}
                  </p>
                </div>
              </div>
              {!dailyDone && (
                <button className="px-10 py-4 rounded-full font-headline font-bold text-lg text-white shadow-2xl hover:-translate-y-1 transition-all" style={{background:"#0D1B3E"}} onClick={() => navigate("/daily")}>
                  Start Now
                </button>
              )}
            </div>
          </div>
        </div>

        {/* RIGHT SIDEBAR */}
        <aside className="lg:col-span-4 space-y-8">
          {/* QUICK ACTIONS */}
          <div className="p-8 rounded-2xl space-y-4 border" style={{background:"#F9F9F9", borderColor:"#EEEEEE"}}>
            <h3 className="font-headline font-extrabold text-lg flex items-center gap-2" style={{color:"#0D1B3E"}}>
              Quick Actions
              <div className="h-1 flex-grow rounded-full" style={{background:"rgba(13,27,62,0.05)"}}></div>
            </h3>
            {[
              {icon:"📝", label:"Practice Sets", path:"/practice"},
              {icon:"🏆", label:"Leaderboard", path:"/leaderboard"},
              {icon:"📚", label:"Syllabus Guide", path:"/syllabus"},
            ].map(a => (
              <div key={a.path} className="flex items-center justify-between p-4 bg-white rounded-xl border hover:border-orange-400 hover:shadow-lg transition-all cursor-pointer group" style={{borderColor:"#EEEEEE"}} onClick={() => navigate(a.path)}>
                <div className="flex items-center gap-4">
                  <span className="text-xl">{a.icon}</span>
                  <span className="font-bold" style={{color:"#0D1B3E"}}>{a.label}</span>
                </div>
                <span className="text-gray-400 group-hover:text-orange-500 transition-colors font-bold">→</span>
              </div>
            ))}
          </div>

          {/* RECENT ACTIVITY */}
          <div className="bg-white p-8 rounded-2xl border shadow-sm" style={{borderColor:"#EEEEEE"}}>
            <h3 className="font-headline font-extrabold text-lg mb-6 flex items-center gap-2" style={{color:"#0D1B3E"}}>
              Recent Activity
              <div className="h-1 flex-grow rounded-full" style={{background:"rgba(13,27,62,0.05)"}}></div>
            </h3>
            {totalAttempts === 0 ? (
              <div className="text-center py-6">
                <div className="text-3xl mb-2">📋</div>
                <p className="text-sm font-hindi" style={{color:"#9E9E9E"}}>अभी कोई activity नहीं है</p>
                <button className="mt-3 px-4 py-2 rounded-full text-sm font-bold text-white" style={{background:"#0D1B3E"}} onClick={() => navigate("/practice")}>Practice शुरू करो →</button>
              </div>
            ) : (
              <div className="space-y-6 relative">
                <div className="absolute left-3 top-2 bottom-2 w-0.5" style={{background:"#EEEEEE"}}></div>
                {dbAttempts.slice(-3).reverse().map((a, i) => {
                  const pct = Math.round((a.score/(a.total_questions||1))*100);
                  return (
                    <div key={i} className="relative flex gap-5 pl-10">
                      <div className="absolute left-1.5 top-1.5 w-3 h-3 rounded-full ring-4 ring-white" style={{background: i === 0 ? "#F47B20" : "#0D1B3E"}}></div>
                      <div className="space-y-1">
                        <p className="text-sm font-bold" style={{color:"#0D1B3E"}}>{a.set_name || "Practice Test"}</p>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-extrabold uppercase tracking-widest" style={{color:"#9E9E9E"}}>{new Date(a.completed_at||a.date).toLocaleDateString("hi-IN")}</span>
                          <div className="text-xs font-bold px-2 py-0.5 rounded-full" style={{background:"rgba(230,81,0,0.1)", color:"#E65100"}}>{pct}%</div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* MOTIVATIONAL CARD */}
          <div className="relative rounded-2xl overflow-hidden h-44 shadow-lg group">
            <img alt="Mountains" className="absolute inset-0 w-full h-full object-cover group-hover:scale-110 transition-transform duration-1000" src="https://lh3.googleusercontent.com/aida-public/AB6AXuDf-eOtoMMiONwUnsurYmk7ocLEt8S781v8XKg60gFImLvZBCkcZw8e3XL-STEng7QdiHBGrw_pnEkM_QNy6FZ3gT4kxqZ4Ed0_zL8ALt_kf1TaXE8aIltMC5XYdsUO-I7dmsw4GcY3tpD6A0Mht-T_4zV6cvVsOcst2NIEuXh1kenUBclGFJ14AaSBifdXHb1LlHhb7BcrF2CtxmU2rTodQZQNqXj2U1w1fodeDj0KaEI8gVVI-itlkZIhHw7ePPsxLYxP2JUvkg"/>
            <div className="absolute inset-0" style={{background:"linear-gradient(to top, rgba(13,27,62,0.95), rgba(13,27,62,0.4), transparent)"}}></div>
            <div className="absolute bottom-5 left-6 right-6">
              <p className="text-white font-headline font-bold text-sm leading-tight italic border-l-2 pl-4" style={{borderColor:"#F47B20"}}>
                "पहाड़ों की ऊँचाई आपकी मेहनत के सामने कुछ भी नहीं।"
              </p>
            </div>
          </div>
        </aside>
      </main>

      {/* MOBILE BOTTOM NAV */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 bg-white/90 backdrop-blur-xl border-t z-50 px-6 py-3 flex justify-between items-center" style={{borderColor:"#E0E0E0"}}>
        {[
          {icon:"📝", label:"Practice", path:"/practice"},
          {icon:"📊", label:"Dashboard", path:"/dashboard"},
          {icon:"🏆", label:"Ranks", path:"/leaderboard"},
          {icon:"👤", label:"Profile", path:"/dashboard"},
        ].map(m => (
          <button key={m.path} className="flex flex-col items-center gap-1" style={{color: m.path === "/dashboard" ? "#E65100" : "#9E9E9E"}} onClick={() => navigate(m.path)}>
            <span className="text-2xl">{m.icon}</span>
            <span className="text-xs font-extrabold uppercase tracking-tighter">{m.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}


function PracticePage() {
  const { navigate } = useRouter();
  const { user } = useAuth();
  
  const [dbSets, setDbSets] = useState([]);
  const [dbFolders, setDbFolders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [folderStack, setFolderStack] = useState([]);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setLoading(true);
    const [{ data: setsData }, fRes, sqRes] = await Promise.all([
      supabase.getAll("practice_sets"),
      supabase.getFolders(),
      // set_questions se har set ka count ek saath lao
      fetch(`${CONFIG.SUPABASE_URL}/rest/v1/set_questions?select=set_id&apikey=${CONFIG.SUPABASE_ANON_KEY}`, { headers: SB_HEADERS })
        .then(r => r.json()).catch(() => [])
    ]);

    // Count banao: { set_id: count }
    const countMap = {};
    if (Array.isArray(sqRes)) {
      sqRes.forEach(row => {
        countMap[row.set_id] = (countMap[row.set_id] || 0) + 1;
      });
    }

    // Merge count into each set
    const allSets = (setsData || []).map(s => ({
      ...s,
      question_count: countMap[s.id] ?? s.question_ids?.length ?? 0
    }));
    setDbSets(Array.from(new Map(allSets.map(item => [item.id, item])).values()));
    setDbFolders(fRes.ok ? fRes.data : []);
    setLoading(false);
  };

  const currentFolderId = folderStack.length > 0 ? folderStack[folderStack.length-1].id : null;
  const visibleFolders = dbFolders.filter(f => currentFolderId ? f.parent_id === currentFolderId : !f.parent_id);
  const visibleSets = currentFolderId
    ? dbSets.filter(s => s.folder_id === currentFolderId)
    : dbSets.filter(s => !s.folder_id || !dbFolders.find(f => f.id === s.folder_id));

  const countSetsInFolder = (fid) => {
    const direct = dbSets.filter(s => s.folder_id === fid).length;
    return direct + dbFolders.filter(f => f.parent_id === fid).reduce((sum, c) => sum + countSetsInFolder(c.id), 0);
  };

  if (loading) return <div className="p-20 text-center devanagari">लोड हो रहा है...</div>;

  return (
    <div className="page bg-[#FDF8F3] min-h-screen">
      <Navbar />
      <div className="max-w-6xl mx-auto px-4 py-8">

        {/* Breadcrumbs */}
        <div className="flex items-center gap-2 mb-6 text-sm flex-wrap">
          <span className="cursor-pointer hover:text-orange-500 font-bold text-navy" onClick={() => setFolderStack([])}>
            📂 Practice Library
          </span>
          {folderStack.map((f, i) => (
            <span key={f.id} className="flex items-center gap-2">
              <span className="text-gray-400">/</span>
              <span
                className={`font-bold cursor-pointer ${i === folderStack.length-1 ? "text-orange-600" : "text-gray-500 hover:text-orange-400"}`}
                onClick={() => i < folderStack.length-1 ? setFolderStack(folderStack.slice(0, i+1)) : null}
              >{f.name}</span>
            </span>
          ))}
        </div>

        {/* Sub-Folders */}
        {visibleFolders.length > 0 && (
          <div className="mb-8">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 fade-in">
              {visibleFolders.map(folder => {
                const subCount = dbFolders.filter(f => f.parent_id === folder.id).length;
                const setCount = countSetsInFolder(folder.id);
                return (
                  <div key={folder.id} onClick={() => setFolderStack([...folderStack, folder])}
                    className="card group cursor-pointer hover:border-orange-500 border-2 border-transparent transition-all bg-white p-6 rounded-2xl shadow-sm hover:shadow-md"
                  >
                    <div className="text-4xl mb-4 group-hover:scale-110 transition-transform">{subCount > 0 ? "📁" : "📂"}</div>
                    <h3 className="font-black text-navy text-lg mb-1">{folder.name}</h3>
                    <div className="text-gray-400 text-xs font-bold uppercase">
                      {subCount > 0 && <p>{subCount} Subfolder{subCount!==1?"s":""}</p>}
                      <p>{setCount} Set{setCount!==1?"s":""}</p>
                    </div>
                    <div className="mt-4 flex justify-end"><span className="text-orange-500 font-bold text-sm">Open →</span></div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Sets */}
        {visibleSets.length > 0 && (
          <div className="fade-in">
            {folderStack.length > 0 && (
              <h2 className="text-xl font-black text-navy mb-4">📝 {folderStack[folderStack.length-1].name} के Sets</h2>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {visibleSets.map(set => (
                <div key={set.id} className="card relative overflow-hidden group">
                  {set.is_paid && (
                    <div className="absolute top-0 right-0 bg-orange-500 text-white text-[10px] px-3 py-1 font-bold rounded-bl-xl uppercase">PRO</div>
                  )}
                  <h3 className="font-bold text-navy mb-4 devanagari text-lg pr-10">{set.set_name}</h3>
                  <div className="flex gap-4 text-xs text-gray-500 mb-6 font-medium">
                    <span>📝 {set.question_count || set.question_ids?.length || 0} सवाल</span>
                    <span>⏱️ {set.time_limit_minutes} मिनट</span>
                  </div>
                  <div className="flex gap-2">
                    <button className="btn-navy flex-1 justify-center group-hover:bg-orange-500 border-none transition-colors" onClick={() => navigate(`/quiz/${set.id}`)}>
                      Start Test
                    </button>
                    <ShareBtn
                      title={set.set_name}
                      text={`📚 ${set.set_name}\n🏔️ Dronna — UKPSC & UKSSSC Exam Preparation\nFree mein practice karo!`}
                      url={window.location.href.split("#")[0] + "#/practice"}
                      label="📤"
                      className="px-4 py-2 rounded-xl border-2 border-gray-200 hover:border-orange-400 hover:text-orange-500 text-gray-400 bg-white"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Empty */}
        {visibleFolders.length === 0 && visibleSets.length === 0 && (
          <div className="text-center py-20 text-gray-400">
            <div className="text-5xl mb-4">📭</div>
            <p className="font-hindi text-lg">{folderStack.length > 0 ? "इस फोल्डर में अभी कुछ नहीं है।" : "अभी कोई Practice Set उपलब्ध नहीं है।"}</p>
            {folderStack.length > 0 && <button className="mt-4 btn-outline py-1 px-4 text-sm" onClick={() => setFolderStack([])}>← वापस जाएं</button>}
          </div>
        )}

      </div>
    </div>
  );
}

function QuizPage({ setId }) {
  const { navigate } = useRouter();
  const { user } = useAuth();

  const [set, setSet] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [loadingQ, setLoadingQ] = useState(true);
  const [current, setCurrent] = useState(0);
  
  // State for Exam Logic
  const [userAnswers, setUserAnswers] = useState({}); // { q_id: 'A' }
  const [markedForReview, setMarkedForReview] = useState(new Set());
  const [timeLeft, setTimeLeft] = useState(0);
  const [finished, setFinished] = useState(false);
  // Review mode — already attempted, just view answers
  const [reviewMode, setReviewMode] = useState(false);
  const [prevAttempt, setPrevAttempt] = useState(null);
  // Report Issue state
  const [reportModal, setReportModal] = useState(null); // { qid, qtext }
  const [reportType, setReportType] = useState("");
  const [reportNote, setReportNote] = useState("");
  const [reportSent, setReportSent] = useState(false);
  const [reportedQids, setReportedQids] = useState(new Set());

  const NEGATIVE_MARK = 0.25;

  const openReport = (q) => {
    setReportModal({ qid: q.id, qtext: q.question_text });
    setReportType(""); setReportNote(""); setReportSent(false);
  };

  const submitReport = async () => {
    if (!reportType) return;
    await supabase.reportQuestion({
      question_id: reportModal.qid,
      question_text: reportModal.qtext?.slice(0,200),
      report_type: reportType,
      note: reportNote || null,
      set_id: setId,
      set_name: set?.set_name || "",
      student_email: user?.email || "anonymous",
      status: "pending"
    });
    setReportedQids(prev => new Set([...prev, reportModal.qid]));
    setReportSent(true);
    setTimeout(() => setReportModal(null), 1800);
  };

  useEffect(() => {
    loadQuiz();
  }, [setId]);

  const loadQuiz = async () => {
    setLoadingQ(true);
    const { data } = await supabase.getAll("practice_sets");
    let foundSet = (data || []).find(s => s.id === setId);
    if (!foundSet) { setLoadingQ(false); return; }
    
    setSet(foundSet);
    setTimeLeft((foundSet.time_limit_minutes || 20) * 60);

    let qs = [];
    const { data: sqResult } = await supabase.getSetQuestions(setId);
    if (sqResult && sqResult.length > 0) {
      qs = sqResult;
    } else if (foundSet.question_ids) {
      const { data: allDbQ } = await supabase.getAll("questions");
      qs = foundSet.question_ids.map(qid => 
        (allDbQ||[]).find(q => q.id === qid)
      ).filter(Boolean);
    }
    setQuestions(qs);

    // Check if already attempted
    const attempts = JSON.parse(localStorage.getItem("dronna_attempts") || "[]");
    const prev = attempts.filter(a => a.setId === setId);
    if (prev.length > 0) {
      const latest = prev[prev.length - 1];
      setPrevAttempt(latest);
    }

    setLoadingQ(false);
  };

  useEffect(() => {
    if (finished || loadingQ || timeLeft <= 0) return;
    const timer = setInterval(() => {
      setTimeLeft(t => { 
        if (t <= 1) { finishQuiz(); return 0; } 
        return t - 1; 
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [finished, loadingQ, timeLeft]);

  const selectOption = (opt) => {
    setUserAnswers({ ...userAnswers, [questions[current].id]: opt });
  };

  const toggleReview = () => {
    const newReview = new Set(markedForReview);
    const qid = questions[current].id;
    if (newReview.has(qid)) newReview.delete(qid);
    else newReview.add(qid);
    setMarkedForReview(newReview);
  };

  const finishQuiz = async () => {
    setFinished(true);
    // Calculate Final Score
    let correct = 0;
    let wrong = 0;
    questions.forEach(q => {
      const ans = userAnswers[q.id];
      if (ans) {
        if (ans === q.correct_answer) correct++;
        else wrong++;
      }
    });

    const netScore = correct - (wrong * NEGATIVE_MARK);

    const attempt = {
      setId, setName: set?.set_name,
      score: netScore, 
      correct, wrong,
      total: questions.length,
      time: (set?.time_limit_minutes * 60) - timeLeft,
      date: new Date().toISOString()
    };

    // Save locally (with answers snapshot for review)
    const attemptWithAnswers = { ...attempt, answers: userAnswers };
    const prev = JSON.parse(localStorage.getItem("dronna_attempts") || "[]");
    localStorage.setItem("dronna_attempts", JSON.stringify([...prev, attemptWithAnswers]));

    // Save to Supabase
    try {
      await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/attempts?apikey=${CONFIG.SUPABASE_ANON_KEY}`, {
        method: "POST",
        headers: { ...SB_HEADERS },
        body: JSON.stringify({
          set_id: setId,
          score: netScore,
          total_questions: questions.length,
          time_taken_seconds: attempt.time,
          student_email: user?.email,
          set_name: set?.set_name
        })
      });
    } catch(e) { console.error(e); }
  };

  if (loadingQ) return <div className="p-20 text-center devanagari">परीक्षा लोड हो रही है...</div>;

  // ── Shared result/review renderer ──
  const renderResultPage = (answersMap, isReview) => {
    let correct = 0; let wrong = 0; let skipped = 0;
    questions.forEach(q => {
      const ans = answersMap[q.id];
      if (!ans) skipped++;
      else if (ans === q.correct_answer) correct++;
      else wrong++;
    });
    const netScore = (correct - (wrong * NEGATIVE_MARK)).toFixed(2);
    const attempted = correct + wrong;
    const accuracy = attempted > 0 ? Math.round((correct / attempted) * 100) : 0;
    const pct = Math.round((parseFloat(netScore) / Math.max(questions.length,1)) * 100);
    const grade = pct >= 80 ? {label:"Excellent! 🏆", color:"#16a34a"} : pct >= 60 ? {label:"Good 👍", color:"#2563eb"} : pct >= 40 ? {label:"Average 📚", color:"#d97706"} : {label:"Needs Work 💪", color:"#dc2626"};
    const optionLabels = { A:"option_a", B:"option_b", C:"option_c", D:"option_d" };

    return (
      <div className="min-h-screen pb-20" style={{background:"#F5F5F5"}}>
        <Navbar />
        <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">

          {/* Score Card */}
          <div className="rounded-3xl overflow-hidden shadow-xl">
            <div className="p-8 text-white text-center" style={{background:"linear-gradient(135deg, #0D1B3E, #1a3a6e)"}}>
              {isReview && (
                <div className="inline-flex items-center gap-2 bg-white/10 px-4 py-1.5 rounded-full text-sm font-bold mb-4">
                  👁️ Review Mode — Previous Attempt
                </div>
              )}
              <h1 className="text-2xl font-black mb-1">{set?.set_name}</h1>
              <div className="text-6xl font-black my-4" style={{color:"#F47B20"}}>{netScore}</div>
              <div className="text-base font-bold opacity-70">out of {questions.length} marks</div>
              <div className="mt-3 inline-block px-4 py-1.5 rounded-full font-black text-sm" style={{background:"rgba(244,123,32,0.25)", color:"#F47B20"}}>
                {grade.label}
              </div>
            </div>
            <div className="grid grid-cols-4 bg-white divide-x">
              {[
                {label:"Correct", value:correct, color:"#16a34a", bg:"#f0fdf4"},
                {label:"Wrong", value:wrong, color:"#dc2626", bg:"#fef2f2"},
                {label:"Skipped", value:skipped, color:"#9ca3af", bg:"#f9fafb"},
                {label:"Accuracy", value:accuracy+"%", color:"#2563eb", bg:"#eff6ff"},
              ].map(s => (
                <div key={s.label} className="py-4 text-center" style={{background:s.bg}}>
                  <div className="text-2xl font-black" style={{color:s.color}}>{s.value}</div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mt-0.5">{s.label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3 flex-wrap">
            <button className="btn-primary flex-1 justify-center py-3" onClick={() => navigate("/practice")}>← Back to Practice</button>
            <ShareBtn
              title={`${set?.set_name} — Result`}
              text={`🏔️ Dronna Practice — ${set?.set_name}\nScore: ${(correct - (wrong * NEGATIVE_MARK)).toFixed(2)}/${questions.length} | Accuracy: ${accuracy}%\n🎯 UKPSC & UKSSSC Exam Preparation`}
              url={window.location.href}
              label="📤 Share Result"
              className="flex-1 justify-center py-3 btn-outline"
            />
            {isReview && (
              <button className="btn-navy flex-1 justify-center py-3" onClick={() => { setPrevAttempt(null); setReviewMode(false); }}>
                🔄 Retake Test
              </button>
            )}
          </div>

          {/* Answer Key with Explanations */}
          <div>
            <h2 className="text-xl font-black mb-4" style={{color:"#0D1B3E"}}>📋 Answer Key & Explanation</h2>
            <div className="space-y-4">
              {questions.map((q, i) => {
                const studentAns = answersMap[q.id];
                const isCorrect = studentAns === q.correct_answer;
                const isWrong = studentAns && !isCorrect;
                const sc = isCorrect
                  ? {border:"#16a34a", bg:"#f0fdf4", badge:"✓ Correct", badgeBg:"#dcfce7", badgeColor:"#16a34a"}
                  : isWrong
                  ? {border:"#dc2626", bg:"#fef2f2", badge:"✗ Wrong", badgeBg:"#fee2e2", badgeColor:"#dc2626"}
                  : {border:"#9ca3af", bg:"#f9fafb", badge:"— Skipped", badgeBg:"#f3f4f6", badgeColor:"#6b7280"};
                return (
                  <div key={q.id} className="rounded-2xl overflow-hidden shadow-sm border-l-4" style={{borderColor:sc.border, background:sc.bg}}>
                    <div className="p-5">
                      <div className="flex items-start justify-between gap-3 mb-4">
                        <div className="flex items-start gap-3 flex-1">
                          <span className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-black flex-shrink-0 text-white mt-0.5" style={{background:"#0D1B3E"}}>{i+1}</span>
                          <p className="font-semibold devanagari text-gray-800 leading-relaxed">{q.question_text}</p>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <span className="text-xs font-black px-2 py-1 rounded-full" style={{background:sc.badgeBg, color:sc.badgeColor}}>{sc.badge}</span>
                          <button onClick={() => openReport(q)}
                            className={`text-xs px-2 py-1 rounded-full font-bold border transition-all ${reportedQids.has(q.id) ? "bg-green-50 text-green-600 border-green-200" : "bg-white text-red-400 border-red-200 hover:bg-red-50"}`}>
                            {reportedQids.has(q.id) ? "✓" : "⚠️"}
                          </button>
                        </div>
                      </div>
                      {/* Options */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-4">
                        {["A","B","C","D"].map(opt => {
                          const isCorr = opt === q.correct_answer;
                          const isStu = opt === studentAns;
                          let cls = "bg-white border-gray-200 text-gray-600";
                          if (isCorr) cls = "border-green-400 bg-green-50 text-green-800 font-bold";
                          else if (isStu) cls = "border-red-400 bg-red-50 text-red-700 font-bold line-through";
                          return (
                            <div key={opt} className={`flex items-center gap-2 p-3 rounded-xl border-2 text-sm ${cls}`}>
                              <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-black flex-shrink-0 ${isCorr?"bg-green-500 text-white":isStu?"bg-red-400 text-white":"bg-gray-100 text-gray-500"}`}>{opt}</span>
                              <span className="devanagari flex-1">{q[optionLabels[opt]]}</span>
                              {isCorr && <span className="text-green-600 font-black">✓</span>}
                              {isStu && !isCorr && <span className="text-red-500 font-black">✗</span>}
                            </div>
                          );
                        })}
                      </div>
                      {/* Explanation */}
                      <div className="rounded-xl p-4 border" style={{background:"rgba(13,27,62,0.04)", borderColor:"rgba(13,27,62,0.1)"}}>
                        <div className="flex items-center gap-2 mb-2">
                          <span>💡</span>
                          <span className="text-xs font-black uppercase tracking-wider" style={{color:"#0D1B3E"}}>Explanation</span>
                        </div>
                        <p className="text-sm devanagari leading-relaxed text-gray-700">
                          {q.explanation
                            ? q.explanation
                            : <span>Correct answer: <strong>{q.correct_answer} — {q[optionLabels[q.correct_answer]]}</strong>{q.topic ? ` | Topic: ${q.topic}` : ""}</span>
                          }
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    );
  };

  if (finished) return renderResultPage(userAnswers, false);
  if (reviewMode && prevAttempt) return renderResultPage(prevAttempt.answers || {}, true);

  // If previously attempted — show choice screen
  if (prevAttempt && !reviewMode) {
    const prevPct = Math.round(((prevAttempt.score||0) / Math.max(prevAttempt.total||questions.length,1)) * 100);
    return (
      <div className="min-h-screen flex items-center justify-center p-4" style={{background:"var(--cream)"}}>
        <div className="max-w-md w-full space-y-4 fade-in">
          <div className="card text-center">
            <div className="text-5xl mb-4">📋</div>
            <h2 className="text-xl font-black text-navy mb-1">{set?.set_name}</h2>
            <p className="text-gray-400 text-sm mb-4">You have already attempted this test</p>
            <div className="flex justify-center gap-6 mb-6 p-4 rounded-xl" style={{background:"var(--cream)"}}>
              <div className="text-center">
                <div className="text-2xl font-black" style={{color:"var(--saffron)"}}>{prevAttempt.score}</div>
                <div className="text-xs text-gray-400 font-bold uppercase">Score</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-black text-blue-600">{prevPct}%</div>
                <div className="text-xs text-gray-400 font-bold uppercase">Percentage</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-black text-green-600">{prevAttempt.correct || "—"}</div>
                <div className="text-xs text-gray-400 font-bold uppercase">Correct</div>
              </div>
            </div>
            <div className="space-y-3">
              <button className="btn-primary w-full justify-center py-3" onClick={() => setReviewMode(true)}>
                👁️ View Answers & Explanations
              </button>
              <button className="btn-outline w-full justify-center py-3" onClick={() => setPrevAttempt(null)}>
                🔄 Retake Test
              </button>
              <button className="w-full py-2 text-sm text-gray-400 hover:text-gray-600" onClick={() => navigate("/practice")}>
                ← Back to Practice
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }
  const q = questions[current];
  const mins = Math.floor(timeLeft / 60);
  const secs = timeLeft % 60;

  return (
    <div className="page bg-gray-50 min-h-screen">
      <div className="bg-navy text-white p-4 sticky top-0 z-50 flex justify-between items-center shadow-lg" style={{background: 'var(--navy)'}}>
        <div className="flex items-center gap-4">
          <button onClick={() => confirm("Exam chhodna chahte hain?") && navigate("/practice")} className="text-white/70 hover:text-white">✕</button>
          <span className="font-bold hidden md:inline">{set?.set_name}</span>
        </div>
        <div className="text-xl font-mono font-bold bg-white/10 px-4 py-1 rounded-lg">
          ⏱️ {mins}:{secs < 10 ? '0'+secs : secs}
        </div>
        <button className="bg-green-600 hover:bg-green-700 px-4 py-1 rounded font-bold text-sm" onClick={() => confirm("Kya aap test submit karna chahte hain?") && finishQuiz()}>SUBMIT</button>
      </div>

      <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-6 p-4">
        {/* Left: Question Area */}
        <div className="lg:col-span-2 space-y-4">
          <div className="card min-h-[400px]">
            <div className="flex justify-between items-center mb-6">
              <span className="bg-orange-100 text-orange-700 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider">Question {current + 1}</span>
              <div className="flex items-center gap-3">
                <span className="text-xs text-gray-400">Negative: 0.25</span>
                <button
                  onClick={() => openReport(q)}
                  className={`text-xs px-3 py-1 rounded-full font-bold border transition-all ${
                    reportedQids.has(q.id)
                      ? "bg-green-50 text-green-600 border-green-200"
                      : "bg-red-50 text-red-500 border-red-200 hover:bg-red-100"
                  }`}
                >
                  {reportedQids.has(q.id) ? "✓ Reported" : "⚠️ Issue?"}
                </button>
              </div>
            </div>
            
            <h2 className="text-xl font-bold mb-8 devanagari leading-relaxed text-navy">
              {q.question_text}
            </h2>

            <div className="space-y-3">
              {['A','B','C','D'].map(opt => {
                const optText = q[`option_${opt.toLowerCase()}`];
                const isSelected = userAnswers[q.id] === opt;
                return (
                  <div key={opt} 
                    onClick={() => selectOption(opt)}
                    className={`option-card flex items-center gap-4 transition-all ${isSelected ? 'selected ring-2 ring-orange-500 border-orange-500' : ''}`}>
                    <span className={`w-8 h-8 rounded-full flex items-center justify-center font-bold border-2 ${isSelected ? 'bg-orange-500 text-white border-orange-500' : 'text-gray-400 border-gray-200'}`}>{opt}</span>
                    <span className="devanagari flex-1">{optText}</span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex justify-between items-center bg-white p-4 rounded-xl shadow-sm">
            <button className="btn-outline px-6 py-2" disabled={current === 0} onClick={() => setCurrent(current-1)}>← Back</button>
            <button className={`px-6 py-2 rounded-lg font-bold border-2 transition-all ${markedForReview.has(q.id) ? 'bg-purple-600 border-purple-600 text-white' : 'border-purple-600 text-purple-600 hover:bg-purple-50'}`} 
              onClick={toggleReview}>
              {markedForReview.has(q.id) ? 'Maked for Review ✓' : 'Mark for Review'}
            </button>
            <button className="btn-navy px-8 py-2" onClick={() => current < questions.length - 1 ? setCurrent(current+1) : null}>Next →</button>
          </div>
        </div>

        {/* Right: Palette Area */}
        <div className="space-y-4">
          <div className="card">
            <h3 className="font-bold text-sm mb-4 uppercase text-gray-400">Question Palette</h3>
            <div className="grid grid-cols-5 gap-2">
              {questions.map((ques, i) => {
                let statusClass = "bg-gray-100 text-gray-400"; // Not visited
                if (userAnswers[ques.id]) statusClass = "bg-green-500 text-white"; // Answered
                if (markedForReview.has(ques.id)) statusClass = "bg-purple-600 text-white"; // Review
                if (current === i) statusClass += " ring-2 ring-offset-2 ring-navy shadow-lg";

                return (
                  <button key={i} 
                    onClick={() => setCurrent(i)}
                    className={`w-10 h-10 rounded-lg font-bold text-sm transition-all flex items-center justify-center ${statusClass}`}>
                    {i + 1}
                  </button>
                );
              })}
            </div>
            
            <div className="mt-6 pt-6 border-t space-y-2">
              <div className="flex items-center gap-2 text-xs font-bold text-gray-500">
                <span className="w-3 h-3 bg-green-500 rounded-sm"></span> Answered
              </div>
              <div className="flex items-center gap-2 text-xs font-bold text-gray-500">
                <span className="w-3 h-3 bg-purple-600 rounded-sm"></span> Marked for Review
              </div>
              <div className="flex items-center gap-2 text-xs font-bold text-gray-500">
                <span className="w-3 h-3 bg-gray-100 rounded-sm"></span> Not Answered
              </div>
            </div>
          </div>

          <div className="p-4 bg-orange-50 border border-orange-100 rounded-xl">
             <p className="text-xs text-orange-700 leading-relaxed font-medium">
               ⚠️ **Note:** Negative marking (0.25) is active. Chose options carefully. Submitting will end the test immediately.
             </p>
          </div>
        </div>
      </div>
      {/* ── Report Issue Modal ── */}
      {reportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{background:"rgba(0,0,0,0.6)"}}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 fade-in">
            {reportSent ? (
              <div className="text-center py-6">
                <div className="text-5xl mb-3">✅</div>
                <p className="font-black text-green-600 text-lg">Report bhej diya!</p>
                <p className="text-sm text-gray-500 mt-1">Admin jald hi dekh lenge</p>
              </div>
            ) : (
              <>
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h3 className="font-black text-navy text-lg">⚠️ Issue Report Karo</h3>
                    <p className="text-xs text-gray-400 mt-1 devanagari line-clamp-2">{reportModal.qtext}</p>
                  </div>
                  <button className="text-gray-400 hover:text-gray-600 text-2xl font-bold leading-none ml-3" onClick={() => setReportModal(null)}>✕</button>
                </div>

                <div className="space-y-3">
                  <div>
                    <label className="text-sm font-bold text-navy block mb-2">Issue ka type चुनें *</label>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { val:"wrong_answer", label:"❌ गलत उत्तर", desc:"The correct answer is wrong" },
                        { val:"wrong_question", label:"📝 गलत प्रश्न", desc:"There is a typo or error in the question" },
                        { val:"wrong_option", label:"🔤 गलत Option", desc:"Mistake in the options" },
                        { val:"other", label:"💬 अन्य", desc:"Something else" },
                      ].map(opt => (
                        <div key={opt.val}
                          onClick={() => setReportType(opt.val)}
                          className={`p-3 rounded-xl border-2 cursor-pointer transition-all ${
                            reportType === opt.val ? "border-orange-500 bg-orange-50" : "border-gray-200 hover:border-orange-300"
                          }`}>
                          <p className="font-bold text-sm">{opt.label}</p>
                          <p className="text-xs text-gray-400 mt-0.5">{opt.desc}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="text-sm font-bold text-navy block mb-1">Note (Optional)</label>
                    <textarea
                      rows={2}
                      placeholder="What should the correct answer be? Or describe the issue..."
                      value={reportNote}
                      onChange={e => setReportNote(e.target.value)}
                      className="text-sm resize-none"
                      style={{padding:"8px 12px"}}
                    />
                  </div>

                  <button
                    onClick={submitReport}
                    disabled={!reportType}
                    className={`w-full py-3 rounded-xl font-black text-sm transition-all ${
                      reportType ? "btn-primary" : "bg-gray-200 text-gray-400 cursor-not-allowed"
                    }`}>
                    📤 Report Bhejo
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════
// 🌅 DAILY CHALLENGE — 5 Questions
// ═══════════════════════════════════════════════
function DailyChallenge() {
  const { navigate } = useRouter();
  const { user } = useAuth();
  const [questions, setQuestions] = useState([]);
  const [loadingQ, setLoadingQ] = useState(true);
  const [current, setCurrent] = useState(0);
  const [selected, setSelected] = useState(null);
  const [answered, setAnswered] = useState(false);
  const [answers, setAnswers] = useState([]);
  const [finished, setFinished] = useState(false);
  const [streak, setStreak] = useState(0);
  const [dailyDone, setDailyDone] = useState(false);
  const today = new Date().toDateString();
  const todayDate = new Date().toISOString().split("T")[0];

  useEffect(() => {
    loadDailyQs();
    loadStudentStreak();
  }, []);

  const loadStudentStreak = async () => {
    if (!user?.email) return;
    const data = await supabase.getStudentData(user.email);
    if (data) {
      setStreak(data.streak || 0);
      setDailyDone(data.last_daily_date === todayDate);
    } else {
      // Fallback to localStorage
      setStreak(parseInt(localStorage.getItem("dronna_streak") || "0"));
      setDailyDone(localStorage.getItem("dronna_daily_date") === today);
    }
  };

  const loadDailyQs = async () => {
    setLoadingQ(true);
    try {
      // Step 1: Aaj ke daily_challenges se question_ids lo
      const dcUrl = CONFIG.SUPABASE_URL + "/rest/v1/daily_challenges?challenge_date=eq." + todayDate + "&select=question_id&apikey=" + CONFIG.SUPABASE_ANON_KEY;
      const dcRes = await fetch(dcUrl, { headers: SB_HEADERS });
      const dcData = await dcRes.json();

      let qs = [];

      if (Array.isArray(dcData) && dcData.length > 0) {
        // Step 2: Un question_ids se questions fetch karo
        const ids = dcData.map(d => d.question_id).filter(Boolean);
        const inParam = ids.join(",");
        const qUrl = CONFIG.SUPABASE_URL + "/rest/v1/questions?id=in.(" + inParam + ")&apikey=" + CONFIG.SUPABASE_ANON_KEY;
        const qRes = await fetch(qUrl, { headers: SB_HEADERS });
        const qData = await qRes.json();
        if (Array.isArray(qData) && qData.length > 0) {
          qs = qData;
        }
      }

      if (qs.length === 0) {
        // Fallback — Supabase questions table se random 5 lo
        const allUrl = CONFIG.SUPABASE_URL + "/rest/v1/questions?select=*&limit=50&apikey=" + CONFIG.SUPABASE_ANON_KEY;
        const allRes = await fetch(allUrl, { headers: SB_HEADERS });
        const allData = await allRes.json();
        if (Array.isArray(allData) && allData.length > 0) {
          // Aaj ki date ke hisaab se consistent shuffle
          const day = new Date().getDate();
          const shuffled = allData.slice().sort((a, b) => {
            const ha = (a.id + day).split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
            const hb = (b.id + day).split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
            return ha - hb;
          });
          qs = shuffled.slice(0, 5);
        }
      }

      setQuestions(qs.slice(0, 5));
    } catch(e) {
      setQuestions([]);
    }
    setLoadingQ(false);
  };

  if (loadingQ) return (
    <div className="page" style={{background:"var(--cream)"}}>
      <Navbar />
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 rounded-full border-4 border-orange-200 border-t-orange-500 animate-spin mx-auto mb-3"></div>
          <p className="text-gray-400 text-sm">Aaj ke sawaal aa rahe hain...</p>
        </div>
      </div>
    </div>
  );

  if (questions.length === 0) return null;

  const q = questions[current];
  const opts = ["A","B","C","D"];
  const optTexts = { A: q?.option_a, B: q?.option_b, C: q?.option_c, D: q?.option_d };

  const selectAnswer = (opt) => {
    if (answered || dailyDone) return;
    setSelected(opt);
    setAnswered(true);
    setAnswers(prev => [...prev, { selected: opt, correct: q.correct_answer }]);
  };

  const nextQ = async () => {
    if (current < questions.length - 1) {
      setCurrent(current + 1);
      setSelected(null);
      setAnswered(false);
    } else {
      // Finish
      const allAnswers = [...answers, { selected, correct: q.correct_answer }];
      const score = allAnswers.filter(a => a.selected === a.correct).length;
      const newStreak = streak + 1;
      // Save to localStorage as backup
      localStorage.setItem("dronna_daily_date", today);
      localStorage.setItem("dronna_streak", String(newStreak));
      // Save to Supabase
      if (user?.email) {
        await supabase.updateStudentData(user.email, {
          streak: newStreak,
          last_daily_date: todayDate
        });
        // Save leaderboard to Supabase
        await supabase.saveLeaderboard({
          name: user.name || "Anonymous",
          email: user.email,
          score: score,
          total: questions.length,
          challenge_date: todayDate
        });
      }
      setStreak(newStreak);
      setFinished(true);
    }
  };

  // Result screen
  if (finished || (dailyDone && answers.length === 0)) {
    const finalAnswers = answers;
    const score = finalAnswers.filter(a => a.selected === a.correct).length;
    const pct = finalAnswers.length > 0 ? Math.round(score / questions.length * 100) : 0;
    return (
      <div className="page" style={{background:"var(--cream)"}}>
        <Navbar />
        <div className="max-w-xl mx-auto px-4 py-10 fade-in">
          {dailyDone && answers.length === 0 ? (
            <div className="card text-center py-8">
              <div className="text-5xl mb-3">✅</div>
              <h2 className="text-xl font-black mb-2" style={{color:"var(--navy)"}}>आज का challenge पूरा हुआ!</h2>
              <p className="text-gray-500 text-sm">कल फिर आना — नए 5 सवाल इंतज़ार कर रहे हैं</p>
              <div className="mt-4 flex gap-3 justify-center flex-wrap">
                <button className="btn-primary" onClick={() => navigate("/leaderboard")}>🏆 Leaderboard</button>
                <ShareBtn
                  title="Dronna Daily Challenge"
                  text={"🏔️ Dronna Daily Challenge — aaj ka challenge complete!\nKya tum bhi try karoge?\n🎯 UKPSC & UKSSSC Free Practice"}
                  url={window.location.href.split("#")[0]}
                  label="📤 Share"
                  className="px-5 py-2 rounded-lg border-2 border-orange-300 text-orange-600 font-bold hover:bg-orange-50 text-sm"
                />
                <button className="btn-outline" onClick={() => navigate("/practice")}>Practice करो</button>
              </div>
            </div>
          ) : (
            <div className="card text-center">
              <div className="text-5xl mb-3">{pct >= 80 ? "🏆" : pct >= 60 ? "👍" : "💪"}</div>
              <h2 className="text-2xl font-black mb-2" style={{color:"var(--navy)"}}>
                {pct >= 80 ? "शानदार!" : pct >= 60 ? "अच्छा प्रयास!" : "कल और अच्छा करो!"}
              </h2>
              <div className="text-5xl font-black my-3" style={{color: pct>=80?"var(--green)":pct>=60?"var(--saffron)":"var(--red)"}}>{pct}%</div>
              <div className="flex justify-center gap-6 text-sm text-gray-500 mb-4">
                <div><div className="text-2xl font-bold text-green-600">{score}</div><div>सही</div></div>
                <div><div className="text-2xl font-bold text-red-500">{questions.length-score}</div><div>गलत</div></div>
                <div><div className="text-2xl font-bold text-orange-500">{streak+1}</div><div>🔥 Streak</div></div>
              </div>
              <div className="space-y-2 text-left mb-4">
                {questions.map((ques,i) => {
                  const ans = finalAnswers[i];
                  const ok = ans?.selected === ques.correct_answer;
                  return (
                    <div key={i} className={`p-2 rounded text-xs border devanagari ${ok?"border-green-200 bg-green-50":"border-red-200 bg-red-50"}`}>
                      <p className="font-medium mb-1">{i+1}. {ques.question_text}</p>
                      <p className={ok?"text-green-600":"text-red-500"}>{ok ? "✅ सही" : `❌ सही उत्तर: ${ques.correct_answer}`}</p>
                    </div>
                  );
                })}
              </div>
              <div className="flex gap-3 justify-center flex-wrap">
                <button className="btn-primary" onClick={() => navigate("/leaderboard")}>🏆 Leaderboard</button>
                <ShareBtn
                  title="Dronna Daily Challenge"
                  text={`🔥 Daily Challenge ${pct}% score kiya!\n${score}/${questions.length} correct | Streak: ${streak+1} days\n🏔️ Dronna — UKPSC & UKSSSC Practice`}
                  url={window.location.href.split("#")[0]}
                  label="📤 Share"
                  className="px-5 py-2 rounded-lg border-2 border-orange-300 text-orange-600 font-bold hover:bg-orange-50 transition-all text-sm"
                />
                <button className="btn-outline" onClick={() => navigate("/practice")}>Practice करो</button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="page" style={{background:"var(--cream)"}}>
      <Navbar />
      <div className="max-w-xl mx-auto px-4 py-8 fade-in">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-xl font-black" style={{color:"var(--navy)"}}>🎯 Daily Challenge</h1>
            <p className="text-gray-500 text-sm">{new Date().toLocaleDateString("hi-IN", {day:"numeric",month:"long"})}</p>
          </div>
          <div className="text-right">
            <div className="font-black text-orange-500">🔥 {streak} Streak</div>
            <div className="text-xs text-gray-400">Question {current+1}/5</div>
          </div>
        </div>

        <div className="progress-bar mb-6">
          <div className="progress-fill" style={{width:`${((current+1)/5)*100}%`}}></div>
        </div>

        <div className="card mb-4">
          <div className="flex items-start gap-3 mb-4">
            <span className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold text-white" style={{background:"var(--saffron)"}}>{current+1}</span>
            <p className="text-base font-semibold leading-relaxed devanagari">{q?.question_text}</p>
          </div>
          <div className="space-y-3">
            {opts.map(opt => {
              let cls = "option-card";
              if (answered) {
                if (opt === q.correct_answer) cls += " correct";
                else if (opt === selected) cls += " wrong";
              } else if (opt === selected) cls += " selected";
              return (
                <div key={opt} className={cls} onClick={() => selectAnswer(opt)}>
                  <div className="flex items-center gap-3">
                    <span className="w-7 h-7 rounded-full border-2 flex items-center justify-center text-xs font-bold flex-shrink-0"
                      style={answered && opt===q.correct_answer?{background:"var(--green)",color:"white",border:"none"}:answered&&opt===selected?{background:"var(--red)",color:"white",border:"none"}:{borderColor:"var(--saffron)",color:"var(--saffron)"}}>
                      {opt}
                    </span>
                    <span className="devanagari text-sm">{optTexts[opt]}</span>
                  </div>
                </div>
              );
            })}
          </div>
          {answered && (
            <div className={`mt-3 p-3 rounded-lg text-sm devanagari ${selected===q.correct_answer?"bg-green-50 text-green-700 border border-green-200":"bg-red-50 text-red-700 border border-red-200"}`}>
              {selected===q.correct_answer ? "✅ बिल्कुल सही!" : `❌ सही उत्तर: ${q.correct_answer} — ${optTexts[q.correct_answer]}`}
            </div>
          )}
        </div>

        {answered && (
          <button className="btn-primary w-full justify-center py-3" onClick={nextQ}>
            {current < questions.length-1 ? "अगला सवाल →" : "Result देखो 🏆"}
          </button>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════
// 🏆 LEADERBOARD PAGE
// ═══════════════════════════════════════════════
function LeaderboardPage() {
  const { navigate } = useRouter();
  const [todayLb, setTodayLb] = useState([]);
  const [allTimeLb, setAllTimeLb] = useState([]);
  const [loading, setLoading] = useState(true);
  const today = new Date().toISOString().split("T")[0];

  useEffect(() => { loadLeaderboards(); }, []);

  const loadLeaderboards = async () => {
    setLoading(true);
    // Today
    const todayData = await supabase.getLeaderboard(today);
    setTodayLb(todayData.sort((a,b) => b.score - a.score));
    // All time — aggregate by email
    const allData = await supabase.getAllTimeLeaderboard();
    const agg = allData.reduce((acc, e) => {
      const ex = acc.find(x => x.email === e.email);
      if (ex) { ex.total_score += e.score; ex.days++; }
      else acc.push({ name: e.name, email: e.email, total_score: e.score, days: 1 });
      return acc;
    }, []).sort((a,b) => b.total_score - a.total_score);
    setAllTimeLb(agg);
    setLoading(false);
  };

  const medals = ["🥇","🥈","🥉"];

  return (
    <div className="page" style={{background:"var(--cream)"}}>
      <Navbar />
      <div className="max-w-2xl mx-auto px-4 py-8 fade-in">
        <div className="mb-6 text-center">
          <div className="text-5xl mb-2">🏆</div>
          <h1 className="text-2xl font-black" style={{color:"var(--navy)"}}>Daily Challenge Leaderboard</h1>
          <p className="text-gray-500 text-sm mt-1">Participate daily — reach the top!</p>
          <div className="mt-3 flex justify-center">
            <ShareBtn
              title="Dronna Leaderboard"
              text={"🏆 Dronna Daily Challenge Leaderboard\nKya tum top mein aa sakte ho?\n🎯 UKPSC & UKSSSC Free Practice"}
              url={window.location.href.split("#")[0] + "#/leaderboard"}
              label="📤 Share Leaderboard"
              className="px-5 py-2 rounded-full border-2 text-sm font-bold border-orange-300 text-orange-600 hover:bg-orange-50 transition-all"
            />
          </div>
        </div>

        {loading ? (
          <div className="card text-center py-8">
            <div className="w-10 h-10 rounded-full border-4 border-orange-200 border-t-orange-500 animate-spin mx-auto mb-3"></div>
            <p className="text-gray-400 text-sm">Leaderboard load ho raha hai...</p>
          </div>
        ) : (
          <div>
            {/* Today */}
            <div className="card mb-6">
              <h3 className="font-black mb-4" style={{color:"var(--navy)"}}>📅 Aaj ka Result — {new Date().toLocaleDateString("hi-IN",{day:"numeric",month:"long"})}</h3>
              {todayLb.length === 0 ? (
                <div className="text-center py-6 text-gray-400">
                  <p className="text-sm">Abhi kisi ne attempt nahi kiya</p>
                  <button className="btn-primary mt-3 text-sm" onClick={() => navigate("/daily")}>Pehle attempt karo!</button>
                </div>
              ) : (
                <div className="space-y-2">
                  {todayLb.map((e,i) => (
                    <div key={i} className={`flex items-center justify-between p-3 rounded-lg ${i===0?"border-2":"border"}`}
                      style={i===0?{borderColor:"var(--gold)",background:"#fffbeb"}:{background:"var(--cream)"}}>
                      <div className="flex items-center gap-3">
                        <span className="text-xl">{medals[i] || "#" + (i+1)}</span>
                        <div className="font-bold text-sm">{e.name}</div>
                      </div>
                      <div className="text-right">
                        <div className="font-black text-lg" style={{color:"var(--saffron)"}}>{e.score}/{e.total}</div>
                        <div className="text-xs text-gray-400">{Math.round(e.score/e.total*100)}%</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* All time */}
            <div className="card">
              <h3 className="font-black mb-4" style={{color:"var(--navy)"}}>⭐ All Time Top Players</h3>
              {allTimeLb.length === 0 ? (
                <p className="text-center text-gray-400 text-sm py-4">Koi data nahi abhi</p>
              ) : (
                <div className="space-y-2">
                  {allTimeLb.slice(0,10).map((e,i) => (
                    <div key={i} className="flex items-center justify-between p-3 rounded-lg" style={{background:"var(--cream)"}}>
                      <div className="flex items-center gap-3">
                        <span className="text-xl">{medals[i] || "#" + (i+1)}</span>
                        <div>
                          <div className="font-bold text-sm">{e.name}</div>
                          <div className="text-xs text-gray-400">{e.days} din participate kiya</div>
                        </div>
                      </div>
                      <div className="font-black" style={{color:"var(--navy)"}}>{e.total_score} pts</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════
// 📖 SYLLABUS PAGE
// ═══════════════════════════════════════════════
function SyllabusPage() {
  const [activeExam, setActiveExam] = useState("UKPSC");
  const [openSection, setOpenSection] = useState(null);

  return (
    <div className="page" style={{background:"var(--cream)"}}>
      <Navbar />
      <div className="max-w-4xl mx-auto px-4 py-8 fade-in">
        <div className="mb-6">
          <h1 className="text-2xl font-black" style={{color:"var(--navy)"}}>📚 Complete Syllabus</h1>
          <p className="text-gray-500 text-sm mt-1">Exam-wise detailed syllabus</p>
        </div>

        {/* Exam Tabs */}
        <div className="flex gap-3 mb-6">
          {["UKPSC","UKSSSC"].map(ex => (
            <button key={ex} className={`px-6 py-2 rounded-full font-bold transition-colors ${activeExam===ex ? "text-white" : "bg-white text-gray-600 border"}`}
              style={activeExam===ex ? {background:"var(--navy)"} : {}}
              onClick={() => { setActiveExam(ex); setOpenSection(null); }}>
              {ex}
            </button>
          ))}
        </div>

        {/* Exam categories */}
        <div className="space-y-4">
          {Object.entries(SYLLABUS[activeExam]).map(([category, topics]) => (
            <div key={category} className="card overflow-hidden">
              <div className="flex items-center justify-between cursor-pointer" onClick={() => setOpenSection(openSection===category ? null : category)}>
                <div>
                  <h3 className="font-black text-base" style={{color:"var(--navy)"}}>{category}</h3>
                  <p className="text-xs text-gray-400">{topics.length} topics</p>
                </div>
                <span className="text-xl">{openSection===category ? "▲" : "▼"}</span>
              </div>
              {openSection===category && (
                <div className="mt-4 pt-4 border-t">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {topics.map((topic, i) => (
                      <div key={i} className="flex items-center gap-2 p-2 rounded-lg text-sm" style={{background:"var(--cream)"}}>
                        <span className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0" style={{background:"var(--saffron)"}}>{i+1}</span>
                        <span className="devanagari">{topic}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════
// ⚙️ ADMIN PANEL
// ═══════════════════════════════════════════════
function AdminPanel() {
  const { user } = useAuth();
  const { navigate } = useRouter();
  const [activeTab, setActiveTab] = useState("questions");

  if (!user?.isAdmin) return (
    <div className="min-h-screen flex items-center justify-center" style={{background:"var(--cream)"}}>
      <div className="card text-center max-w-sm">
        <div className="text-4xl mb-3">🔒</div>
        <h2 className="font-black text-xl mb-2">Access Denied</h2>
        <p className="text-gray-500 text-sm mb-4">Sirf admin hi yahan aa sakta hai</p>
        <button className="btn-primary" onClick={() => navigate("/dashboard")}>Dashboard pe jao</button>
      </div>
    </div>
  );

  const tabs = [
    { id:"questions", label:"📝 Questions" },
    { id:"folders", label:"📁 Folders" },
    { id:"sets", label:"📦 Practice Sets" },
    { id:"daily", label:"🎯 Daily Challenge" },
    { id:"reports", label:"⚠️ Reports" },
    { id:"students", label:"👥 Students" },
  ];

  return (
    <div className="min-h-screen flex flex-col" style={{background:"#f8fafc"}}>
      <Navbar />
      <div className="flex flex-1">
        {/* Sidebar */}
        <div className="w-56 flex-shrink-0 bg-white border-r p-4 hidden md:block">
          <div className="font-black text-lg mb-4" style={{color:"var(--navy)"}}>Admin Panel</div>
          <div className="space-y-1">
            {tabs.map(t => (
              <div key={t.id} className={`sidebar-link text-sm ${activeTab===t.id?"active":""}`} onClick={() => setActiveTab(t.id)}>{t.label}</div>
            ))}
          </div>
        </div>

        {/* Mobile tabs */}
        <div className="md:hidden w-full">
          <div className="flex overflow-x-auto bg-white border-b p-2 gap-2">
            {tabs.map(t => (
              <button key={t.id} className={`px-3 py-2 rounded-lg text-xs font-bold whitespace-nowrap ${activeTab===t.id?"text-white":"text-gray-600"}`}
                style={activeTab===t.id?{background:"var(--saffron)"}:{}}
                onClick={() => setActiveTab(t.id)}>{t.label}</button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 p-4 md:p-6 overflow-auto">
          {activeTab === "questions" && <AdminQuestions />}
          {activeTab === "folders" && <AdminFolders />}
          {activeTab === "sets" && <AdminSets />}
          {activeTab === "daily" && <AdminDaily />}
          {activeTab === "reports" && <AdminReports />}
          {activeTab === "students" && <AdminStudents />}
        </div>
      </div>
    </div>
  );
}

function AdminQuestions() {
  const { user } = useAuth();
  const [questions, setQuestions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ question_text:"", option_a:"", option_b:"", option_c:"", option_d:"", correct_answer:"A", subject:"सामान्य ज्ञान", topic:"", difficulty:"easy", exam_type:"UKPSC", explanation:"" });
  const [msg, setMsg] = useState("");

  // Load from Supabase on mount
  useEffect(() => {
    loadQuestions();
  }, []);

  const loadQuestions = async () => {
    setLoading(true);
    const { data } = await supabase.getAll("questions");
    setQuestions(data || []);
    setLoading(false);
  };

  const allQ = questions;

  const saveQuestion = async () => {
    if (!form.question_text || !form.option_a || !form.option_b || !form.option_c || !form.option_d) { setMsg("❌ सभी fields भरें"); return; }
    setMsg("⏳ Save ho raha hai...");
    const { error } = await supabase.adminWrite("create_question", form, user?.access_token);
    if (error) { setMsg("❌ Error: " + error); return; }
    setForm({ question_text:"", option_a:"", option_b:"", option_c:"", option_d:"", correct_answer:"A", subject:"सामान्य ज्ञान", topic:"", difficulty:"easy", exam_type:"UKPSC", explanation:"" });
    setMsg("✅ Question save ho gaya!");
    await loadQuestions();
    setTimeout(() => setMsg(""), 2000);
  };

  const deleteQ = async (id) => {
    const { error } = await supabase.adminWrite("delete_question", { id }, user?.access_token);
    if (error) { setMsg("âŒ Error: " + error); return; }
    await loadQuestions();
  };

  return (
    <div className="max-w-4xl space-y-6">
      <h2 className="text-xl font-black" style={{color:"var(--navy)"}}>📝 Question Manager</h2>

      {/* Add Question Form */}
      <div className="card">
        <h3 className="font-bold mb-4">New Question Add Karo</h3>
        {msg && <div className={`p-3 rounded-lg text-sm mb-4 ${msg.startsWith("✅") ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>{msg}</div>}
        <div className="space-y-3">
          <div>
            <label>Question Text *</label>
            <textarea rows={3} placeholder="Enter question text (use Devanagari for Hindi questions)" value={form.question_text} onChange={e=>setForm({...form,question_text:e.target.value})} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {["a","b","c","d"].map(opt => (
              <div key={opt}>
                <label>Option {opt.toUpperCase()} *</label>
                <input placeholder={`Option ${opt.toUpperCase()}`} value={form[`option_${opt}`]} onChange={e=>setForm({...form,[`option_${opt}`]:e.target.value})} />
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <label>Correct Answer *</label>
              <select value={form.correct_answer} onChange={e=>setForm({...form,correct_answer:e.target.value})}>
                {["A","B","C","D"].map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
            <div>
              <label>Subject</label>
              <select value={form.subject} onChange={e=>setForm({...form,subject:e.target.value})}>
                {["सामान्य ज्ञान","भूगोल","राजव्यवस्था","इतिहास","विज्ञान","गणित","Mixed"].map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label>Difficulty</label>
              <select value={form.difficulty} onChange={e=>setForm({...form,difficulty:e.target.value})}>
                <option value="easy">Easy</option>
                <option value="medium">Medium</option>
                <option value="hard">Hard</option>
              </select>
            </div>
            <div>
              <label>Exam Type</label>
              <select value={form.exam_type} onChange={e=>setForm({...form,exam_type:e.target.value})}>
                <option value="UKPSC">UKPSC</option>
                <option value="UKSSSC">UKSSSC</option>
                <option value="Both">Both</option>
              </select>
            </div>
          </div>
          <div>
            <label>💡 Explanation (Optional — answer ke baad students ko dikhega)</label>
            <textarea rows={3} placeholder="Why is this the correct answer? Add explanation here..." value={form.explanation} onChange={e=>setForm({...form,explanation:e.target.value})} />
          </div>
          <button className="btn-primary" onClick={saveQuestion}>💾 Save Question</button>
        </div>
      </div>

      {/* Questions List */}
      <div className="card">
        <h3 className="font-bold mb-4">All Questions ({allQ.length})</h3>
        {loading ? (
          <div className="space-y-2 py-4">
            {[1,2,3].map(i => <div key={i} className="h-12 bg-gray-100 rounded-lg animate-pulse"></div>)}
          </div>
        ) : allQ.length === 0 ? (
          <div className="text-center py-8 text-gray-400">
            <div className="text-3xl mb-2">📭</div>
            <p className="text-sm">Koi question nahi hai abhi — upar form se add karo ya CSV import karo</p>
          </div>
        ) : (
        <div className="space-y-3 max-h-96 overflow-y-auto">
          {allQ.map((q, i) => (
            <div key={q.id} className="p-3 rounded-lg border flex items-start justify-between gap-3" style={{background:"var(--cream)"}}>
              <div className="flex-1">
                <p className="text-sm font-medium devanagari">{i+1}. {(q.question_text||"").slice(0,80)}...</p>
                <div className="flex gap-2 mt-1 flex-wrap">
                  <span className="tag" style={{background:"var(--cream-dark)",color:"var(--navy)"}}>{q.subject}</span>
                  <span className="tag" style={{background:"#e0f2fe",color:"#0369a1"}}>{q.exam_type}</span>
                  <span className="tag" style={{background:"#f0fdf4",color:"var(--green)"}}>Ans: {q.correct_answer}</span>
                </div>
              </div>
              <button className="text-red-400 hover:text-red-600 text-sm font-bold flex-shrink-0" onClick={() => deleteQ(q.id)}>✕</button>
            </div>
          ))}
        </div>
        )}
      </div>
    </div>
  );
}

function AdminSets() {
  const { user } = useAuth();
  const [sets, setSets] = useState([]);
  const [allQ, setAllQ] = useState([]);
  const [folders, setFolders] = useState([]);
  const [form, setForm] = useState({
    set_name: "", exam_type: "UKPSC", time_limit_minutes: 30,
    is_paid: false, folder_id: "", subject: "Mixed"
  });
  const [selectedQ, setSelectedQ] = useState([]);
  const [creating, setCreating] = useState(false);
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(true);
  const [qSubjectFilter, setQSubjectFilter] = useState("All");
  const [qSearch, setQSearch] = useState("");
  const [csvQuestions, setCsvQuestions] = useState([]);
  const [csvFileName, setCsvFileName] = useState("");
  const [csvMsg, setCsvMsg] = useState("");

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setLoading(true);
    const [setsRes, qRes, fRes] = await Promise.all([
      supabase.getAll("practice_sets"),
      supabase.getAll("questions"),
      supabase.getFolders()
    ]);
    setSets(setsRes.data || []);
    setAllQ(qRes.data || []);
    setFolders(fRes.ok ? fRes.data : []);
    setLoading(false);
  };

  // Unique subjects from questions
  const allSubjects = ["All", ...new Set((allQ).map(q => q.subject || "Uncategorized"))];

  // Questions filtered by subject tab + search
  const filteredQ = allQ.filter(q => {
    const subOk = qSubjectFilter === "All" || q.subject === qSubjectFilter;
    const searchOk = !qSearch || q.question_text?.toLowerCase().includes(qSearch.toLowerCase());
    return subOk && searchOk;
  });

  // Selected questions breakdown by subject
  const selectedBreakdown = selectedQ.reduce((acc, qid) => {
    const q = allQ.find(x => x.id === qid);
    const sub = q?.subject || "?";
    acc[sub] = (acc[sub] || 0) + 1;
    return acc;
  }, {});

  // Folder tree helpers
  const rootFolders = folders.filter(f => !f.parent_id);
  const getChildren = (pid) => folders.filter(f => f.parent_id === pid);

  const saveSet = async () => {
    if (!form.set_name.trim() || selectedQ.length === 0) {
      setMsg("❌ Set name and at least 1 question are required!"); return;
    }
    setMsg("⏳ Practice Set बन रहा है...");
    try {
      const subjectKeysSecure = Object.keys(selectedBreakdown);
      const autoSubjectSecure = subjectKeysSecure.length === 1 ? subjectKeysSecure[0] : "Mixed";
      const secureResult = await supabase.adminWrite("create_set_manual", {
        set: {
          set_name: form.set_name.trim(),
          subject: autoSubjectSecure,
          exam_type: form.exam_type,
          time_limit_minutes: Number(form.time_limit_minutes),
          is_paid: form.is_paid,
          ...(form.folder_id ? { folder_id: form.folder_id } : {})
        },
        question_ids: selectedQ
      }, user?.access_token);
      if (secureResult.error) { setMsg("ERR: " + secureResult.error); return; }
      setMsg(`OK: "${form.set_name}" ${selectedQ.length} sawaalon ke saath save ho gayi!`);
      setForm({ set_name:"", exam_type:"UKPSC", time_limit_minutes:30, is_paid:false, folder_id:"", subject:"Mixed" });
      setSelectedQ([]);
      setCreating(false);
      loadData();
      return;
      // Auto-detect subject label
      const subjectKeys = Object.keys(selectedBreakdown);
      const autoSubject = subjectKeys.length === 1 ? subjectKeys[0] : "Mixed";

      const r1 = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/practice_sets?apikey=${CONFIG.SUPABASE_ANON_KEY}`, {
        method: "POST",
        headers: { ...SB_HEADERS, "Prefer": "return=representation" },
        body: JSON.stringify({
          set_name: form.set_name.trim(),
          subject: autoSubject,
          exam_type: form.exam_type,
          time_limit_minutes: Number(form.time_limit_minutes),
          is_paid: form.is_paid,
          ...(form.folder_id ? { folder_id: form.folder_id } : {})
        })
      });
      const setData = await r1.json();
      const setId = Array.isArray(setData) ? setData[0]?.id : setData?.id;
      if (!setId) { setMsg("❌ Set could not be saved — check Supabase connection"); return; }

      await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/set_questions?apikey=${CONFIG.SUPABASE_ANON_KEY}`, {
        method: "POST",
        headers: { ...SB_HEADERS },
        body: JSON.stringify(selectedQ.map(qid => ({ set_id: setId, question_id: qid })))
      });
      setMsg(`✅ "${form.set_name}" — ${selectedQ.length} sawaalon ke saath save ho gayi!`);
      setForm({ set_name:"", exam_type:"UKPSC", time_limit_minutes:30, is_paid:false, folder_id:"", subject:"Mixed" });
      setSelectedQ([]);
      setCreating(false);
      loadData();
    } catch(e) { setMsg("❌ Error: " + e.message); }
  };

  const createPracticeSetRecord = async (subjectValue) => {
    const r1 = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/practice_sets?apikey=${CONFIG.SUPABASE_ANON_KEY}`, {
      method: "POST",
      headers: { ...SB_HEADERS, "Prefer": "return=representation" },
      body: JSON.stringify({
        set_name: form.set_name.trim(),
        subject: subjectValue,
        exam_type: form.exam_type,
        time_limit_minutes: Number(form.time_limit_minutes),
        is_paid: form.is_paid,
        ...(form.folder_id ? { folder_id: form.folder_id } : {})
      })
    });
    const setData = await r1.json();
    const setId = Array.isArray(setData) ? setData[0]?.id : setData?.id;
    return {
      ok: Boolean(setId),
      setId,
      error: setId ? null : (setData?.message || "Set could not be saved")
    };
  };

  const handleCsvUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setCsvMsg("WAIT: CSV read ho rahi hai...");
    setCsvFileName(file.name);

    try {
      const text = await file.text();
      const result = parseQuestionsCsv(text, form.exam_type);
      if (!result.ok) {
        setCsvQuestions([]);
        setCsvMsg(`ERR: ${result.error}`);
        return;
      }
      setCsvQuestions(result.questions);
      setCsvMsg(`OK: ${result.questions.length} questions ready hain`);
    } catch (e) {
      setCsvQuestions([]);
      setCsvMsg(`ERR: CSV read nahi hui: ${e.message}`);
    } finally {
      event.target.value = "";
    }
  };

  const saveSetFromCsv = async () => {
    if (!form.set_name.trim()) { setMsg("ERR: Set name required hai"); return; }
    if (csvQuestions.length === 0) { setMsg("ERR: Pehle CSV upload karo"); return; }

    setMsg("WAIT: CSV questions upload ho rahe hain aur set ban raha hai...");
    try {
      const csvBreakdownSecure = csvQuestions.reduce((acc, q) => {
        const sub = q.subject || "Mixed";
        acc[sub] = (acc[sub] || 0) + 1;
        return acc;
      }, {});
      const csvSubjectKeysSecure = Object.keys(csvBreakdownSecure);
      const autoSubjectSecure = csvSubjectKeysSecure.length === 1 ? csvSubjectKeysSecure[0] : "Mixed";
      const secureResult = await supabase.adminWrite("create_set_from_csv", {
        set: {
          set_name: form.set_name.trim(),
          subject: autoSubjectSecure,
          exam_type: form.exam_type,
          time_limit_minutes: Number(form.time_limit_minutes),
          is_paid: form.is_paid,
          ...(form.folder_id ? { folder_id: form.folder_id } : {})
        },
        questions: csvQuestions
      }, user?.access_token);
      if (secureResult.error) { setMsg(`ERR: ${secureResult.error}`); return; }
      setMsg(`OK: "${form.set_name}" CSV se ban gayi. ${secureResult.data?.inserted_question_count || csvQuestions.length} questions question bank me bhi add ho gaye.`);
      setCsvQuestions([]);
      setCsvFileName("");
      setCsvMsg("");
      setForm({ set_name:"", exam_type:"UKPSC", time_limit_minutes:30, is_paid:false, folder_id:"", subject:"Mixed" });
      setSelectedQ([]);
      setCreating(false);
      loadData();
      return;
      const csvBreakdown = csvQuestions.reduce((acc, q) => {
        const sub = q.subject || "Mixed";
        acc[sub] = (acc[sub] || 0) + 1;
        return acc;
      }, {});
      const csvSubjectKeys = Object.keys(csvBreakdown);
      const autoSubject = csvSubjectKeys.length === 1 ? csvSubjectKeys[0] : "Mixed";

      const setResult = await createPracticeSetRecord(autoSubject);
      if (!setResult.ok) { setMsg(`ERR: ${setResult.error}`); return; }

      const insertedQuestions = await supabase.insertManyReturning("questions", csvQuestions);
      if (insertedQuestions.error || insertedQuestions.data.length === 0) {
        await supabase.delete("practice_sets", setResult.setId);
        setMsg(`ERR: CSV questions save nahi hui: ${insertedQuestions.error || "Unknown error"}`);
        return;
      }

      const linkRes = await supabase.insertMany("set_questions",
        insertedQuestions.data.map(q => ({ set_id: setResult.setId, question_id: q.id }))
      );
      if (linkRes.error) {
        setMsg(`ERR: Questions save ho gayi, but set link nahi bana: ${linkRes.error}`);
        return;
      }

      setMsg(`OK: "${form.set_name}" CSV se ban gayi. ${insertedQuestions.data.length} questions question bank me bhi add ho gaye.`);
      setCsvQuestions([]);
      setCsvFileName("");
      setCsvMsg("");
      setForm({ set_name:"", exam_type:"UKPSC", time_limit_minutes:30, is_paid:false, folder_id:"", subject:"Mixed" });
      setSelectedQ([]);
      setCreating(false);
      loadData();
    } catch(e) { setMsg("ERR: Error: " + e.message); }
  };

  const toggleQ = (qid) => setSelectedQ(prev =>
    prev.includes(qid) ? prev.filter(x => x !== qid) : [...prev, qid]
  );

  // Build flat folder option list with indentation
  const buildFolderOptions = () => {
    const opts = [];
    rootFolders.forEach(f => {
      opts.push(<option key={f.id} value={f.id}>📁 {f.name}</option>);
      getChildren(f.id).forEach(sf => {
        opts.push(<option key={sf.id} value={sf.id}>&nbsp;&nbsp;&nbsp;📂 {sf.name}</option>);
      });
    });
    return opts;
  };

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-black text-navy">📦 Practice Sets Manager</h2>
        <button className="btn-primary text-sm" onClick={() => { setCreating(!creating); setMsg(""); }}>
          {creating ? "✕ Close" : "+ नई Set बनाएं"}
        </button>
      </div>

      {msg && (
        <div className={`p-3 rounded-lg text-sm ${(msg.startsWith("✅") || msg.startsWith("OK:") || msg.startsWith("WAIT:")) ? "bg-green-50 text-green-700 border border-green-200" : "bg-red-50 text-red-700 border border-red-200"}`}>
          {msg}
        </div>
      )}

      {creating && (
        <div className="card fade-in border-t-4 border-orange-500 space-y-6">
          <h3 className="font-bold text-navy">✏️ नई Practice Set</h3>

          {/* ── Row 1: Set Name ── */}
          <div>
            <label>📋 Set का नाम *</label>
            <input
              placeholder="जैसे: UKSSSC GS Mock Test 1, Hindi Practice Set A..."
              value={form.set_name}
              onChange={e => setForm({...form, set_name: e.target.value})}
            />
          </div>

          {/* ── Row 2: Folder + Exam Type + Time ── */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label>📁 Folder में डालें</label>
              <select value={form.folder_id} onChange={e => setForm({...form, folder_id: e.target.value})}>
                <option value="">— Uncategorized —</option>
                {buildFolderOptions()}
              </select>
              {folders.length === 0 && (
                <p className="text-xs text-amber-600 mt-1 font-medium">⚠️ Pehle "Folders" tab se folder banao</p>
              )}
            </div>
            <div>
              <label>🏛️ Exam Type</label>
              <select value={form.exam_type} onChange={e => setForm({...form, exam_type: e.target.value})}>
                <option value="UKPSC">UKPSC</option>
                <option value="UKSSSC">UKSSSC</option>
                <option value="Common">Common (Both)</option>
              </select>
            </div>
            <div>
              <label>⏱️ Time Limit (Minutes)</label>
              <input type="number" min="5" max="180" value={form.time_limit_minutes}
                onChange={e => setForm({...form, time_limit_minutes: e.target.value})} />
            </div>
          </div>

          {/* ── Row 3: Paid toggle ── */}
          <div className="flex items-center gap-3 p-3 rounded-xl bg-yellow-50 border border-yellow-200">
            <input type="checkbox" id="isPaid" checked={form.is_paid}
              onChange={e => setForm({...form, is_paid: e.target.checked})}
              className="w-4 h-4 accent-orange-500" />
            <label htmlFor="isPaid" className="font-bold text-sm text-yellow-800 cursor-pointer">
              💰 PRO / Paid Set (Free users ko lock dikhega)
            </label>
          </div>

          {/* ── Row 4: Question Bank ── */}
          <div className="rounded-2xl border border-dashed border-orange-300 bg-orange-50 p-4 space-y-3">
            <div>
              <h4 className="font-black text-sm text-orange-700">CSV Upload se direct paper banao</h4>
              <p className="text-xs text-orange-700 mt-1">
                CSV upload karoge to questions question bank me save honge aur isi set ke saath link bhi ho jayenge.
              </p>
            </div>
            <div className="text-xs bg-white border border-orange-200 rounded-xl p-3 overflow-x-auto">
              <strong>Required headers:</strong> question_text, option_a, option_b, option_c, option_d, correct_answer
              <br />
              <strong>Optional:</strong> subject, topic, difficulty, exam_type, explanation
            </div>
            <div className="flex flex-col md:flex-row md:items-center gap-3">
              <input type="file" accept=".csv,text/csv" onChange={handleCsvUpload} className="bg-white" />
              {csvFileName && (
                <span className="text-xs font-bold text-orange-700">
                  {csvFileName} {csvQuestions.length > 0 ? `(${csvQuestions.length} questions)` : ""}
                </span>
              )}
            </div>
            {csvMsg && (
              <div className={`text-xs font-bold ${csvMsg.startsWith("OK:") ? "text-green-700" : csvMsg.startsWith("WAIT:") ? "text-orange-700" : "text-red-600"}`}>
                {csvMsg}
              </div>
            )}
            <button
              className={`w-full py-3 rounded-xl font-black transition-all ${
                csvQuestions.length > 0 && form.set_name.trim()
                  ? "btn-primary"
                  : "bg-gray-200 text-gray-400 cursor-not-allowed"
              }`}
              onClick={saveSetFromCsv}
              disabled={csvQuestions.length === 0 || !form.set_name.trim()}
            >
              CSV upload karke set banao
            </button>
          </div>

          <div className="bg-gray-50 rounded-2xl border border-gray-200 overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b bg-white">
              <div>
                <h4 className="font-black text-navy text-sm">📚 Question Bank से चुनें</h4>
                <p className="text-xs text-gray-400 mt-0.5">Multiple subjects se sawaal chun sakte ho — Mixed paper banaega</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="bg-orange-500 text-white text-xs font-black px-3 py-1 rounded-full">
                  {selectedQ.length} चुने
                </span>
                {selectedQ.length > 0 && (
                  <button className="text-xs text-red-500 font-bold hover:text-red-700"
                    onClick={() => setSelectedQ([])}>Clear All</button>
                )}
              </div>
            </div>

            {/* Subject Breakdown (badge row) */}
            {selectedQ.length > 0 && (
              <div className="px-4 py-2 bg-orange-50 border-b flex flex-wrap gap-2">
                {Object.entries(selectedBreakdown).map(([sub, cnt]) => (
                  <span key={sub} className="text-xs bg-white border border-orange-200 text-orange-700 px-2 py-0.5 rounded-full font-bold">
                    {sub}: {cnt}
                  </span>
                ))}
              </div>
            )}

            {/* Subject filter tabs */}
            <div className="flex gap-1 p-3 overflow-x-auto border-b bg-white scrollbar-hide">
              {allSubjects.map(sub => (
                <button key={sub}
                  onClick={() => setQSubjectFilter(sub)}
                  className={`px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition-all ${
                    qSubjectFilter === sub
                      ? "bg-navy text-white"
                      : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                  }`}>
                  {sub} {sub !== "All" ? `(${allQ.filter(q=>q.subject===sub).length})` : `(${allQ.length})`}
                </button>
              ))}
            </div>

            {/* Search bar */}
            <div className="px-3 py-2 bg-white border-b">
              <input
                placeholder="🔍 Search questions..."
                value={qSearch}
                onChange={e => setQSearch(e.target.value)}
                className="text-sm"
                style={{padding:"8px 12px"}}
              />
            </div>

            {/* Select All / Clear for filtered */}
            <div className="flex justify-between items-center px-4 py-2 bg-gray-50 border-b text-xs">
              <span className="text-gray-500 font-medium">{filteredQ.length} sawaal dikh rahe hain</span>
              <div className="flex gap-3">
                <button className="font-bold text-blue-600 hover:text-blue-800"
                  onClick={() => {
                    const ids = filteredQ.map(q=>q.id);
                    setSelectedQ(prev => [...new Set([...prev, ...ids])]);
                  }}>+ Select All Visible</button>
                <button className="font-bold text-red-500 hover:text-red-700"
                  onClick={() => {
                    const ids = new Set(filteredQ.map(q=>q.id));
                    setSelectedQ(prev => prev.filter(id => !ids.has(id)));
                  }}>− Remove Visible</button>
              </div>
            </div>

            {/* Question list */}
            <div className="max-h-72 overflow-y-auto p-3 space-y-2">
              {filteredQ.length === 0 ? (
                <p className="text-center text-gray-400 text-sm py-6">
                  {allQ.length === 0 ? "Add questions first from the Questions tab" : "No questions found"}
                </p>
              ) : filteredQ.map(q => {
                const isSelected = selectedQ.includes(q.id);
                return (
                  <div key={q.id} onClick={() => toggleQ(q.id)}
                    className={`p-3 rounded-xl border-2 cursor-pointer transition-all flex gap-3 items-start ${
                      isSelected ? "border-orange-400 bg-orange-50" : "border-gray-100 bg-white hover:border-orange-200"
                    }`}
                  >
                    <div className={`w-5 h-5 mt-0.5 rounded flex-shrink-0 border-2 flex items-center justify-center transition-all ${
                      isSelected ? "bg-orange-500 border-orange-500" : "border-gray-300"
                    }`}>
                      {isSelected && <span className="text-white text-[10px] font-black">✓</span>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs devanagari leading-relaxed text-gray-800">{q.question_text}</p>
                      <div className="flex gap-2 mt-1.5 flex-wrap">
                        <span className="text-[10px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded font-bold">{q.subject}</span>
                        <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded font-bold">{q.difficulty}</span>
                        <span className="text-[10px] bg-green-50 text-green-600 px-1.5 py-0.5 rounded font-bold">Ans: {q.correct_answer}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Save Button */}
          <button
            className={`w-full py-4 rounded-xl font-black text-lg transition-all ${
              selectedQ.length > 0 && form.set_name.trim()
                ? "btn-navy hover:bg-orange-500"
                : "bg-gray-200 text-gray-400 cursor-not-allowed"
            }`}
            onClick={saveSet}
            disabled={selectedQ.length === 0 || !form.set_name.trim()}
          >
            💾 {selectedQ.length > 0 ? `${selectedQ.length} सवालों के साथ Set Save करें` : "पहले सवाल चुनें"}
          </button>
        </div>
      )}

      {/* Existing Sets List */}
      <div className="card">
        <div className="flex justify-between items-center mb-4">
          <h3 className="font-bold">मौजूदा Practice Sets ({sets.length})</h3>
          {folders.length > 0 && <span className="text-xs text-gray-400">📁 icon click = folder assign karo</span>}
        </div>
        {loading ? (
          <div className="space-y-2">{[1,2,3].map(i=><div key={i} className="h-14 bg-gray-100 rounded-lg animate-pulse"></div>)}</div>
        ) : sets.length === 0 ? (
          <p className="text-center text-gray-400 text-sm py-6">Koi set nahi hai — upar se banao</p>
        ) : (
          <div className="space-y-2">
            {sets.map(s => {
              const folderObj = folders.find(f => f.id === s.folder_id);
              const rootFolders = folders.filter(f => !f.parent_id);
              const getChildren = (pid) => folders.filter(f => f.parent_id === pid);
              return (
                <div key={s.id} className="p-4 border rounded-xl bg-white hover:shadow-md transition-all">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-sm text-navy">{s.set_name}</p>
                      <div className="flex gap-2 mt-1.5 flex-wrap">
                        <span className="text-[10px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-bold">{s.exam_type || "UKPSC"}</span>
                        <span className="text-[10px] bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full font-bold">{s.subject || "Mixed"}</span>
                        {folderObj
                          ? <span className="text-[10px] bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full font-bold">📁 {folderObj.name}</span>
                          : <span className="text-[10px] bg-gray-50 text-gray-400 px-2 py-0.5 rounded-full font-bold border border-dashed">📂 No Folder</span>
                        }
                        {s.is_paid && <span className="text-[10px] bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full font-bold">💰 PRO</span>}
                      </div>
                    </div>
                    <button className="text-red-400 hover:text-red-600 font-bold flex-shrink-0 text-xl leading-none"
                      onClick={async () => {
                        if (!confirm("Are you sure you want to delete this?")) return;
                        const result = await supabase.adminWrite("delete_set", { id: s.id }, user?.access_token);
                        if (result.error) { setMsg("ERR: " + result.error); return; }
                        loadData();
                      }}>
                      ✕
                    </button>
                  </div>

                  {/* Folder assign row */}
                  {folders.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-dashed border-gray-100 flex items-center gap-2">
                      <span className="text-xs text-gray-400 font-medium whitespace-nowrap">📁 Folder:</span>
                      <select
                        className="text-xs flex-1 py-1 px-2 border border-gray-200 rounded-lg bg-gray-50 font-medium"
                        value={s.folder_id || ""}
                        onChange={async (e) => {
                          const newFId = e.target.value || null;
                          const result = await supabase.adminWrite("move_set_to_folder", { set_id: s.id, folder_id: newFId }, user?.access_token);
                          if (result.error) { setMsg("ERR: " + result.error); return; }
                          loadData();
                        }}
                      >
                        <option value="">— No Folder (Uncategorized) —</option>
                        {rootFolders.map(f => (
                          <optgroup key={f.id} label={"📁 " + f.name}>
                            <option value={f.id}>📁 {f.name}</option>
                            {getChildren(f.id).map(sf => (
                              <option key={sf.id} value={sf.id}>&nbsp;&nbsp;📂 {sf.name}</option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function AdminFolders() {
  const { user } = useAuth();
  const [folders, setFolders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dbError, setDbError] = useState("");
  const [msg, setMsg] = useState("");
  const [newName, setNewName] = useState("");
  const [newParent, setNewParent] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState("");

  useEffect(() => { loadFolders(); }, []);

  const loadFolders = async () => {
    setLoading(true);
    setDbError("");
    const result = await supabase.getFolders();
    if (result.ok) {
      setFolders(result.data);
    } else {
      setDbError(result.error);
      setFolders([]);
    }
    setLoading(false);
  };

  const createFolder = async () => {
    if (!newName.trim()) { setMsg("❌ Folder name is required"); return; }
    setMsg("⏳ Folder ban raha hai...");
    const result = await supabase.adminWrite("create_folder", {
      name: newName.trim(),
      ...(newParent ? { parent_id: newParent } : {})
    }, user?.access_token);
    if (!result?.error) {
      setNewName(""); setNewParent("");
      setMsg("✅ Folder \"" + newName.trim() + "\" bana diya!");
      await loadFolders();
    } else {
      setMsg("❌ Error: " + (result?.error || "Unknown error"));
    }
    setTimeout(() => setMsg(""), 4000);
  };

  const startEdit = (f) => { setEditingId(f.id); setEditName(f.name); };
  const saveEdit = async (id) => {
    if (!editName.trim()) return;
    const result = await supabase.adminWrite("update_folder", { id, name: editName.trim() }, user?.access_token);
    if (result?.error) { setMsg("ERR: " + result.error); return; }
    setEditingId(null);
    await loadFolders();
  };
  const deleteFolder = async (id) => {
    if (!confirm("Folder delete karne se uske andar ke sets unlinked ho jayenge. Pakka?")) return;
    const result = await supabase.adminWrite("delete_folder", { id }, user?.access_token);
    if (result?.error) { setMsg("ERR: " + result.error); return; }
    await loadFolders();
  };

  const rootFolders = folders.filter(f => !f.parent_id);
  const getChildren = (pid) => folders.filter(f => f.parent_id === pid);

  return (
    <div className="max-w-3xl space-y-6">
      <h2 className="text-xl font-black" style={{color:"var(--navy)"}}>📁 Folder Manager</h2>

      {/* ── DB Error Block ── */}
      {dbError && (
        <div className="p-4 rounded-xl bg-red-50 border border-red-300 space-y-3">
          <p className="font-black text-red-700">⚠️ Supabase Error — Folders load nahi hue</p>
          <p className="text-sm text-red-600 font-mono bg-red-100 p-2 rounded">{dbError}</p>
          <div className="bg-white border border-red-200 rounded-xl p-4 text-sm space-y-2">
            <p className="font-black text-gray-800">🔧 Fix karo — Supabase SQL Editor mein ye SQL run karo:</p>
            <pre className="bg-gray-900 text-green-400 p-3 rounded-lg text-xs overflow-x-auto whitespace-pre-wrap">{`-- Step 1: folders table banao
CREATE TABLE IF NOT EXISTS folders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  parent_id UUID REFERENCES folders(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Step 2: practice_sets mein folder_id add karo
ALTER TABLE practice_sets
ADD COLUMN IF NOT EXISTS folder_id UUID REFERENCES folders(id) ON DELETE SET NULL;

-- Step 3: RLS — Public read + Anon write allow karo
ALTER TABLE folders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "folders_read" ON folders;
DROP POLICY IF EXISTS "folders_write" ON folders;
CREATE POLICY "folders_read" ON folders FOR SELECT USING (true);
CREATE POLICY "folders_write" ON folders FOR ALL USING (true) WITH CHECK (true);`}</pre>
            <p className="text-xs text-gray-500">Run karne ke baad page refresh karo — folders dikhne lagenge.</p>
          </div>
          <button className="btn-primary text-sm" onClick={loadFolders}>🔄 Try Again</button>
        </div>
      )}

      {msg && <div className={`p-3 rounded-lg text-sm ${msg.startsWith("✅") ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>{msg}</div>}

      {/* ── Create Folder Form ── */}
      {!dbError && (
        <div className="card border-t-4 border-orange-500">
          <h3 className="font-bold mb-4">➕ Naya Folder Banao</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
            <div className="md:col-span-1">
              <label>Folder ka Naam *</label>
              <input
                placeholder="जैसे: UKSSSC, Hindi, GS..."
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => e.key === "Enter" && createFolder()}
              />
            </div>
            <div className="md:col-span-1">
              <label>Parent Folder (Subfolder banane ke liye)</label>
              <select value={newParent} onChange={e => setNewParent(e.target.value)}>
                <option value="">— Root Level —</option>
                {rootFolders.map(f => <option key={f.id} value={f.id}>📁 {f.name}</option>)}
              </select>
            </div>
            <div>
              <button className="btn-primary w-full" onClick={createFolder}>📁 Banao</button>
            </div>
          </div>
          <p className="text-xs text-gray-400 mt-3">
            💡 Tip: Pehle root folder banao (UKSSSC), phir uske andar subfolder (Hindi, GS, Reasoning)
          </p>
        </div>
      )}

      {/* ── Folder Tree ── */}
      {!dbError && (
        <div className="card">
          <div className="flex justify-between items-center mb-4">
            <h3 className="font-bold">📂 Folder Structure</h3>
            <span className="text-xs bg-gray-100 text-gray-600 px-3 py-1 rounded-full font-bold">{folders.length} folders</span>
          </div>
          {loading ? (
            <div className="space-y-2">{[1,2,3].map(i=><div key={i} className="h-10 bg-gray-100 rounded animate-pulse"></div>)}</div>
          ) : rootFolders.length === 0 ? (
            <div className="text-center py-10 text-gray-400">
              <div className="text-5xl mb-3">📭</div>
              <p className="text-sm font-medium">Koi folder nahi hai — upar se banao</p>
            </div>
          ) : (
            <div className="space-y-2">
              {rootFolders.map(folder => {
                const children = getChildren(folder.id);
                return (
                  <div key={folder.id} className="border rounded-xl overflow-hidden">
                    <div className="flex items-center gap-3 p-3 bg-orange-50">
                      <span className="text-xl">📁</span>
                      {editingId === folder.id ? (
                        <input className="flex-1 border-b-2 border-orange-500 bg-transparent outline-none font-bold px-1"
                          value={editName} onChange={e=>setEditName(e.target.value)}
                          onKeyDown={e=>{if(e.key==="Enter")saveEdit(folder.id);if(e.key==="Escape")setEditingId(null);}}
                          autoFocus />
                      ) : (
                        <span className="flex-1 font-black text-navy">{folder.name}</span>
                      )}
                      <div className="flex gap-2 items-center">
                        <span className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded font-bold">{children.length} sub</span>
                        {editingId === folder.id ? (
                          <>
                            <button className="text-xs bg-green-500 text-white px-3 py-1 rounded-lg font-bold" onClick={()=>saveEdit(folder.id)}>✓</button>
                            <button className="text-xs bg-gray-200 px-3 py-1 rounded-lg font-bold" onClick={()=>setEditingId(null)}>✕</button>
                          </>
                        ) : (
                          <>
                            <button className="text-xs bg-blue-100 text-blue-600 px-3 py-1 rounded-lg font-bold hover:bg-blue-200" onClick={()=>startEdit(folder)}>✏️ Rename</button>
                            <button className="text-xs bg-red-100 text-red-500 px-3 py-1 rounded-lg font-bold hover:bg-red-200" onClick={()=>deleteFolder(folder.id)}>🗑️</button>
                          </>
                        )}
                      </div>
                    </div>
                    {children.length > 0 && (
                      <div className="pl-8 py-2 space-y-1 bg-white">
                        {children.map(child => (
                          <div key={child.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50">
                            <span className="text-gray-300 text-sm">└─</span>
                            <span className="text-lg">📂</span>
                            {editingId === child.id ? (
                              <input className="flex-1 border-b-2 border-orange-500 bg-transparent outline-none font-bold px-1 text-sm"
                                value={editName} onChange={e=>setEditName(e.target.value)}
                                onKeyDown={e=>{if(e.key==="Enter")saveEdit(child.id);if(e.key==="Escape")setEditingId(null);}}
                                autoFocus />
                            ) : (
                              <span className="flex-1 font-bold text-navy text-sm">{child.name}</span>
                            )}
                            <div className="flex gap-2">
                              {editingId === child.id ? (
                                <>
                                  <button className="text-xs bg-green-500 text-white px-2 py-0.5 rounded font-bold" onClick={()=>saveEdit(child.id)}>✓</button>
                                  <button className="text-xs bg-gray-200 px-2 py-0.5 rounded font-bold" onClick={()=>setEditingId(null)}>✕</button>
                                </>
                              ) : (
                                <>
                                  <button className="text-xs bg-blue-100 text-blue-600 px-2 py-1 rounded-lg font-bold hover:bg-blue-200" onClick={()=>startEdit(child)}>✏️</button>
                                  <button className="text-xs bg-red-100 text-red-500 px-2 py-1 rounded-lg font-bold hover:bg-red-200" onClick={()=>deleteFolder(child.id)}>🗑️</button>
                                </>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
function AdminDaily() {
  const { user } = useAuth();
  const [scheduled, setScheduled] = useState([]);
  const [allQ, setAllQ] = useState([]);
  const [form, setForm] = useState({ date: new Date().toISOString().split("T")[0], question_id: "" });
  const [msg, setMsg] = useState("");

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    const [qRes, dcRes] = await Promise.all([supabase.getAll("questions"), supabase.getAll("daily_challenges")]);
    setAllQ(qRes.data || []);
    setScheduled(dcRes.data||[]);
  };

  const schedule = async () => {
    if (!form.date || !form.question_id) { setMsg("❌ Please select a date and question"); return; }
    setMsg("⏳ Save ho raha hai...");
    const result = await supabase.adminWrite("schedule_daily_challenge", { challenge_date: form.date, question_id: form.question_id }, user?.access_token);
    if (result?.error) { setMsg("âŒ Error: " + result.error); return; }
    setMsg("✅ Daily challenge schedule ho gaya!");
    await loadData();
    setTimeout(() => setMsg(""), 2000);
  };

  return (
    <div className="max-w-2xl space-y-6">
      <h2 className="text-xl font-black" style={{color:"var(--navy)"}}>🎯 Daily Challenge Manager</h2>

      {msg && <div className={`p-3 rounded-lg text-sm ${msg.startsWith("✅") ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>{msg}</div>}

      <div className="card">
        <h3 className="font-bold mb-4">Challenge Schedule Karo</h3>
        <div className="space-y-3">
          <div>
            <label>Date</label>
            <input type="date" value={form.date} onChange={e=>setForm({...form,date:e.target.value})} />
          </div>
          <div>
            <label>Question Select Karo</label>
            <select value={form.question_id} onChange={e=>setForm({...form,question_id:e.target.value})}>
              <option value="">-- Choose a question --</option>
              {allQ.map(q => <option key={q.id} value={q.id}>{q.question_text.slice(0,60)}...</option>)}
            </select>
          </div>
          <button className="btn-primary" onClick={schedule}>📅 Schedule Karo</button>
        </div>
      </div>

      {scheduled.length > 0 && (
        <div className="card">
          <h3 className="font-bold mb-4">Scheduled Challenges ({scheduled.length})</h3>
          <div className="space-y-2">
            {scheduled.sort((a,b)=>a.date>b.date?1:-1).map(s => {
              const q = allQ.find(q=>q.id===s.question_id);
              return (
                <div key={s.id} className="p-3 rounded-lg border text-sm" style={{background:"var(--cream)"}}>
                  <div className="font-bold text-orange-600">{s.date}</div>
                  <div className="devanagari text-gray-600">{q?.question_text?.slice(0,60)}...</div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function AdminReports() {
  const { user } = useAuth();
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("pending");

  useEffect(() => { loadReports(); }, []);

  const loadReports = async () => {
    setLoading(true);
    const data = await supabase.getReports();
    setReports(data);
    setLoading(false);
  };

  const resolve = async (id) => {
    const result = await supabase.adminWrite("resolve_report", { id }, user?.access_token);
    if (result?.error) return;
    await loadReports();
  };

  const typeLabel = {
    wrong_answer: "❌ गलत उत्तर",
    wrong_question: "📝 गलत प्रश्न",
    wrong_option: "🔤 गलत Option",
    other: "💬 अन्य"
  };

  const filtered = filter === "all" ? reports : reports.filter(r => r.status === filter);
  const pendingCount = reports.filter(r => r.status === "pending").length;

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-black" style={{color:"var(--navy)"}}>⚠️ Question Reports</h2>
          <p className="text-sm text-gray-500 mt-1">Students dwara report kiye gaye questions</p>
        </div>
        <div className="flex items-center gap-2">
          {pendingCount > 0 && (
            <span className="bg-red-500 text-white text-xs font-black px-3 py-1 rounded-full animate-pulse">
              {pendingCount} Pending
            </span>
          )}
          <button className="btn-outline text-sm py-1 px-3" onClick={loadReports}>🔄 Refresh</button>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2">
        {[
          { val:"pending", label:"⏳ Pending" },
          { val:"resolved", label:"✅ Resolved" },
          { val:"all", label:"📋 All" },
        ].map(f => (
          <button key={f.val}
            onClick={() => setFilter(f.val)}
            className={`px-4 py-2 rounded-full text-sm font-bold transition-all ${
              filter === f.val ? "bg-navy text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
            style={filter === f.val ? {background:"var(--navy)"} : {}}>
            {f.label} ({f.val === "all" ? reports.length : reports.filter(r=>r.status===f.val).length})
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-3">{[1,2,3].map(i=><div key={i} className="h-24 bg-gray-100 rounded-xl animate-pulse"></div>)}</div>
      ) : filtered.length === 0 ? (
        <div className="card text-center py-12">
          <div className="text-5xl mb-3">{filter === "pending" ? "🎉" : "📭"}</div>
          <p className="font-bold text-gray-500">
            {filter === "pending" ? "No pending reports — all good!" : "No reports found"}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(r => (
            <div key={r.id} className={`card border-l-4 ${r.status === "resolved" ? "border-green-400 opacity-70" : "border-red-400"}`}>
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <span className={`text-xs font-black px-2 py-0.5 rounded-full ${
                      r.status === "resolved" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-600"
                    }`}>
                      {r.status === "resolved" ? "✅ Resolved" : "⏳ Pending"}
                    </span>
                    <span className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full font-bold">
                      {typeLabel[r.report_type] || r.report_type}
                    </span>
                    {r.set_name && (
                      <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-bold">
                        📦 {r.set_name}
                      </span>
                    )}
                  </div>

                  <p className="text-sm font-medium devanagari text-gray-800 mb-1 line-clamp-2">
                    {r.question_text || "Question text unavailable"}
                  </p>

                  {r.note && (
                    <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-2 mt-2">
                      <p className="text-xs text-yellow-800 font-medium">💬 Student note: {r.note}</p>
                    </div>
                  )}

                  <div className="flex gap-3 mt-2 text-xs text-gray-400">
                    <span>👤 {r.student_email || "Anonymous"}</span>
                    <span>🕐 {r.created_at ? new Date(r.created_at).toLocaleDateString("hi-IN") : "—"}</span>
                  </div>
                </div>

                {r.status === "pending" && (
                  <button
                    onClick={() => resolve(r.id)}
                    className="flex-shrink-0 text-xs bg-green-500 text-white px-3 py-2 rounded-xl font-bold hover:bg-green-600 transition-all">
                    ✅ Resolve
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* SQL setup reminder */}
      {reports.length === 0 && !loading && (
        <div className="card bg-blue-50 border border-blue-200">
          <p className="font-bold text-blue-800 text-sm mb-2">📋 Pehli baar setup — Supabase mein ye SQL run karo:</p>
          <pre className="bg-gray-900 text-green-400 p-3 rounded-lg text-xs overflow-x-auto">{`CREATE TABLE IF NOT EXISTS question_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id TEXT,
  question_text TEXT,
  report_type TEXT NOT NULL,
  note TEXT,
  set_id TEXT,
  set_name TEXT,
  student_email TEXT,
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE question_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "reports_read" ON question_reports FOR SELECT USING (true);
CREATE POLICY "reports_write" ON question_reports FOR ALL USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE ON TABLE question_reports TO anon;
GRANT SELECT, INSERT, UPDATE ON TABLE question_reports TO authenticated;`}</pre>
        </div>
      )}
    </div>
  );
}

function AdminStudents() {
  const [students, setStudents] = useState([]);
  const [attempts, setAttempts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [visitorCount, setVisitorCount] = useState(0);
  const [visitorToday, setVisitorToday] = useState(0);
  const [visitorWeek, setVisitorWeek] = useState(0);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    const [sRes, aRes] = await Promise.all([
      supabase.getAll("students"),
      supabase.getAll("attempts")
    ]);
    setStudents(sRes.data || []);
    setAttempts(aRes.data || []);

    // Unique visitor stats load karo (visitor_id + visit_date se deduplicate)
    try {
      const vRes = await fetch(
        `${CONFIG.SUPABASE_URL}/rest/v1/visitor_stats?select=visitor_id,visit_date&apikey=${CONFIG.SUPABASE_ANON_KEY}`,
        { headers: SB_HEADERS }
      );
      const visitors = await vRes.json();
      if (Array.isArray(visitors)) {
        const today = new Date().toISOString().slice(0, 10);
        const weekAgo = new Date(Date.now() - 7*24*60*60*1000).toISOString().slice(0, 10);
        // Total unique visitors (unique visitor_id)
        const uniqueIds = new Set(visitors.map(v => v.visitor_id));
        setVisitorCount(uniqueIds.size);
        // Aaj ke unique visitors
        const todayIds = new Set(visitors.filter(v => v.visit_date === today).map(v => v.visitor_id));
        setVisitorToday(todayIds.size);
        // Is hafte ke unique visitors
        const weekIds = new Set(visitors.filter(v => v.visit_date >= weekAgo).map(v => v.visitor_id));
        setVisitorWeek(weekIds.size);
      }
    } catch(e) {}

    setLoading(false);
  };

  const today = new Date().toDateString();
  const todayAttempts = attempts.filter(a => new Date(a.completed_at || a.date).toDateString() === today).length;

  return (
    <div className="max-w-4xl space-y-6">
      <h2 className="text-xl font-black" style={{color:"var(--navy)"}}>👥 Students</h2>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label:"Total Students", value: loading ? "..." : students.length, icon:"👥" },
          { label:"Total Attempts", value: loading ? "..." : attempts.length, icon:"📝" },
          { label:"Aaj ke Attempts", value: loading ? "..." : todayAttempts, icon:"🎯" },
          { label:"Total Visitors", value: loading ? "..." : visitorCount, icon:"👀" },
        ].map(s => (
          <div key={s.label} className="card text-center">
            <div className="text-2xl mb-1">{s.icon}</div>
            <div className="text-2xl font-black" style={{color:"var(--saffron)"}}>{s.value}</div>
            <div className="text-xs text-gray-500 mt-1">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Visitor breakdown */}
      {!loading && visitorToday > 0 && (
        <div className="card">
          <h3 className="font-bold mb-3" style={{color:"var(--navy)"}}>👀 Visitor Stats</h3>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div className="p-3 rounded-lg" style={{background:"var(--cream)"}}>
              <div className="text-xl font-black" style={{color:"var(--saffron)"}}>{visitorToday}</div>
              <div className="text-xs text-gray-500">Aaj</div>
            </div>
            <div className="p-3 rounded-lg" style={{background:"var(--cream)"}}>
              <div className="text-xl font-black" style={{color:"var(--navy)"}}>{visitorWeek}</div>
              <div className="text-xs text-gray-500">Is Hafte</div>
            </div>
            <div className="p-3 rounded-lg" style={{background:"var(--cream)"}}>
              <div className="text-xl font-black text-green-600">{visitorCount}</div>
              <div className="text-xs text-gray-500">Total</div>
            </div>
          </div>
        </div>
      )}

      <div className="card">
        <h3 className="font-bold mb-4">Registered Students ({students.length})</h3>
        {loading ? (
          <div className="space-y-2">{[1,2,3].map(i=><div key={i} className="h-10 bg-gray-100 rounded animate-pulse"></div>)}</div>
        ) : students.length === 0 ? (
          <p className="text-gray-400 text-sm text-center py-4">Abhi koi student registered nahi hai</p>
        ) : (
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {students.map((s,i) => (
              <div key={s.id||i} className="flex items-center justify-between p-3 rounded-lg text-sm" style={{background:"var(--cream)"}}>
                <div>
                  <div className="font-bold">{s.full_name || s.email}</div>
                  <div className="text-xs text-gray-400">{s.email} • {s.exam_target || "—"}</div>
                </div>
                <span className={`badge ${s.subscription_plan === "pro" ? "badge-pro" : "badge-free"}`}>
                  {s.subscription_plan?.toUpperCase() || "FREE"}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <h3 className="font-bold mb-4">Recent Attempts ({attempts.length})</h3>
        {loading ? (
          <div className="space-y-2">{[1,2,3].map(i=><div key={i} className="h-8 bg-gray-100 rounded animate-pulse"></div>)}</div>
        ) : attempts.length === 0 ? (
          <p className="text-gray-400 text-sm text-center py-4">Koi attempt nahi hai abhi</p>
        ) : (
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {attempts.slice(-20).reverse().map((a,i) => (
              <div key={i} className="flex items-center justify-between p-2 rounded text-sm border">
                <span className="text-gray-600 text-xs">{new Date(a.completed_at||a.date).toLocaleDateString("hi-IN")}</span>
                <span className="font-bold" style={{color:"var(--saffron)"}}>{Math.round((a.score/(a.total_questions||a.total||1))*100)}%</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}


// ═══════════════════════════════════════════════
// 👤 PROFILE PAGE
// ═══════════════════════════════════════════════
function ProfilePage() {
  const { navigate } = useRouter();
  const { user, login, logout } = useAuth();

  const [tab, setTab] = useState("profile"); // "profile" | "password"
  const [form, setForm] = useState({
    name: user?.name || "",
    exam_target: user?.exam_target || "UKPSC",
  });
  const [pwForm, setPwForm] = useState({ current: "", newPw: "", confirm: "" });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState({ type:"", text:"" });
  const [attempts, setAttempts] = useState([]);

  useEffect(() => {
    // Load attempt history for stats
    const local = JSON.parse(localStorage.getItem("dronna_attempts") || "[]");
    // Also try DB
    fetch(`${CONFIG.SUPABASE_URL}/rest/v1/attempts?student_email=eq.${encodeURIComponent(user?.email)}&select=*&order=completed_at.desc&apikey=${CONFIG.SUPABASE_ANON_KEY}`, { headers: SB_HEADERS })
      .then(r => r.json())
      .then(data => setAttempts(Array.isArray(data) && data.length > 0 ? data : local))
      .catch(() => setAttempts(local));
  }, []);

  const showMsg = (type, text) => {
    setMsg({ type, text });
    setTimeout(() => setMsg({ type:"", text:"" }), 3500);
  };

  // ── Save Profile ──
  const saveProfile = async () => {
    if (!form.name.trim()) { showMsg("error", "❌ Name cannot be empty"); return; }
    setSaving(true);
    try {
      await fetch(
        `${CONFIG.SUPABASE_URL}/rest/v1/students?email=eq.${encodeURIComponent(user.email)}&apikey=${CONFIG.SUPABASE_ANON_KEY}`,
        { method:"PATCH", headers: SB_HEADERS, body: JSON.stringify({ full_name: form.name.trim(), exam_target: form.exam_target }) }
      );
      // localStorage bhi update karo
      await login({ ...user, name: form.name.trim(), exam_target: form.exam_target });
      showMsg("success", "✅ Profile update ho gayi!");
    } catch(e) { showMsg("error", "❌ Could not save — please try again"); }
    setSaving(false);
  };

  // ── Change Password ──
  const changePassword = async () => {
    if (!pwForm.current || !pwForm.newPw) { showMsg("error", "❌ Please fill all fields"); return; }
    if (pwForm.newPw.length < 6) { showMsg("error", "❌ New password must be at least 6 characters"); return; }
    if (pwForm.newPw !== pwForm.confirm) { showMsg("error", "❌ New password and confirm password do not match"); return; }
    setSaving(true);
    try {
      // Step 1: Verify current password by re-logging in
      const verifyRes = await fetch(`${CONFIG.SUPABASE_URL}/auth/v1/token?grant_type=password`, {
        method:"POST",
        headers: { "apikey": CONFIG.SUPABASE_ANON_KEY, "Content-Type":"application/json" },
        body: JSON.stringify({ email: user.email, password: pwForm.current })
      });
      const verifyData = await verifyRes.json();
      if (!verifyRes.ok || !verifyData.access_token) {
        showMsg("error", "❌ Current password is incorrect"); setSaving(false); return;
      }
      // Step 2: Update password using access token
      const updateRes = await fetch(`${CONFIG.SUPABASE_URL}/auth/v1/user`, {
        method:"PUT",
        headers: { "apikey": CONFIG.SUPABASE_ANON_KEY, "Content-Type":"application/json", "Authorization": `Bearer ${verifyData.access_token}` },
        body: JSON.stringify({ password: pwForm.newPw })
      });
      if (updateRes.ok) {
        setPwForm({ current:"", newPw:"", confirm:"" });
        showMsg("success", "✅ Password updated! Use your new password next time you login");
      } else {
        const err = await updateRes.json();
        showMsg("error", "❌ " + (err.message || "Password could not be updated"));
      }
    } catch(e) { showMsg("error", "❌ Network problem"); }
    setSaving(false);
  };

  // Stats
  const totalTests = attempts.length;
  const avgScore = totalTests > 0
    ? Math.round(attempts.reduce((a,b) => a + ((b.score/(b.total_questions||b.total||1))*100), 0) / totalTests)
    : 0;
  const bestScore = totalTests > 0
    ? Math.max(...attempts.map(a => Math.round((a.score/(a.total_questions||a.total||1))*100)))
    : 0;

  // Avatar color based on name
  const avatarColors = ["#E65100","#1565C0","#2E7D32","#6A1B9A","#00838F"];
  const colorIdx = (user?.name?.charCodeAt(0) || 0) % avatarColors.length;

  return (
    <div className="min-h-screen" style={{background:"#FAFAFA"}}>
      <Navbar />

      <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">

        {/* ── Header Card ── */}
        <div className="rounded-2xl overflow-hidden shadow-lg">
          {/* Cover */}
          <div className="h-28 relative" style={{background:"linear-gradient(135deg, #0D1B3E 0%, #1a3a6e 60%, #E65100 100%)"}}>
            <div className="absolute inset-0 opacity-10" style={{backgroundImage:"radial-gradient(rgba(255,255,255,0.8) 1px, transparent 1px)", backgroundSize:"20px 20px"}}></div>
          </div>
          {/* Avatar + Info */}
          <div className="bg-white px-6 pb-6">
            <div className="flex items-end justify-between -mt-10 mb-4">
              <div className="w-20 h-20 rounded-2xl border-4 border-white shadow-xl flex items-center justify-center text-3xl font-black text-white"
                style={{background: avatarColors[colorIdx]}}>
                {user?.name?.[0]?.toUpperCase() || "?"}
              </div>
              <span className={`px-3 py-1 rounded-full text-xs font-black ${user?.subscription_plan === "pro" ? "bg-yellow-100 text-yellow-700" : "bg-gray-100 text-gray-600"}`}>
                {user?.subscription_plan?.toUpperCase() || "FREE"}
              </span>
            </div>
            <h1 className="text-2xl font-black text-navy">{user?.name}</h1>
            <p className="text-gray-400 text-sm">{user?.email}</p>
            <p className="text-sm mt-1 font-medium" style={{color:"#E65100"}}>🎯 Target: {user?.exam_target}</p>
          </div>
        </div>

        {/* ── Stats Row ── */}
        <div className="grid grid-cols-3 gap-4">
          {[
            { label:"Tests दिए", value: totalTests, icon:"📝" },
            { label:"Avg Score", value: totalTests > 0 ? avgScore+"%" : "—", icon:"📊" },
            { label:"Best Score", value: totalTests > 0 ? bestScore+"%" : "—", icon:"🏆" },
          ].map(s => (
            <div key={s.label} className="bg-white rounded-2xl p-5 text-center shadow-sm border" style={{borderColor:"#EEEEEE"}}>
              <div className="text-2xl mb-1">{s.icon}</div>
              <div className="text-2xl font-black" style={{color:"#0D1B3E"}}>{s.value}</div>
              <div className="text-xs font-bold text-gray-400 mt-1 uppercase tracking-wide">{s.label}</div>
            </div>
          ))}
        </div>

        {/* ── Tabs ── */}
        <div className="bg-white rounded-2xl shadow-sm border overflow-hidden" style={{borderColor:"#EEEEEE"}}>
          <div className="flex border-b" style={{borderColor:"#EEEEEE"}}>
            {[
              { id:"profile", label:"✏️ Profile Edit" },
              { id:"password", label:"🔒 Password" },
            ].map(t => (
              <button key={t.id}
                onClick={() => { setTab(t.id); setMsg({type:"",text:""}); }}
                className={`flex-1 py-4 text-sm font-black transition-all ${
                  tab === t.id
                    ? "border-b-2 text-orange-600"
                    : "text-gray-400 hover:text-gray-600"
                }`}
                style={tab === t.id ? {borderColor:"#E65100"} : {}}>
                {t.label}
              </button>
            ))}
          </div>

          <div className="p-6">
            {/* Message */}
            {msg.text && (
              <div className={`mb-4 p-3 rounded-xl text-sm font-medium ${
                msg.type === "success" ? "bg-green-50 text-green-700 border border-green-200" : "bg-red-50 text-red-600 border border-red-200"
              }`}>{msg.text}</div>
            )}

            {/* ── Profile Tab ── */}
            {tab === "profile" && (
              <div className="space-y-5">
                <div>
                  <label>👤 पूरा नाम</label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={e => setForm({...form, name: e.target.value})}
                    placeholder="Enter your name"
                  />
                </div>
                <div>
                  <label>📧 Email (बदल नहीं सकते)</label>
                  <input type="email" value={user?.email} disabled
                    style={{background:"#F5F5F5", color:"#9E9E9E", cursor:"not-allowed"}} />
                  <p className="text-xs text-gray-400 mt-1">Email change ke liye admin se contact karo</p>
                </div>
                <div>
                  <label>🎯 Target Exam</label>
                  <select value={form.exam_target} onChange={e => setForm({...form, exam_target: e.target.value})}>
                    <option value="UKPSC">UKPSC (LT Grade / PCS / Lecturer)</option>
                    <option value="UKSSSC">UKSSSC (Group C / VDO / Forest Guard)</option>
                    <option value="Both">दोनों की तैयारी</option>
                  </select>
                </div>
                <button
                  onClick={saveProfile}
                  disabled={saving}
                  className="btn-primary w-full justify-center py-3">
                  {saving ? "⏳ Save ho raha hai..." : "💾 Profile Save Karo"}
                </button>

                <div className="pt-4 border-t border-dashed border-gray-100">
                  <button
                    onClick={() => { if(confirm("Are you sure you want to logout?")) { logout(); navigate("/"); } }}
                    className="w-full py-3 rounded-xl font-bold text-red-500 border-2 border-red-100 hover:bg-red-50 transition-all text-sm">
                    🚪 Logout
                  </button>
                </div>
              </div>
            )}

            {/* ── Password Tab ── */}
            {tab === "password" && (
              <div className="space-y-5">
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-3">
                  <p className="text-xs text-blue-700 font-medium">🔐 Pehle purana password verify hoga, phir naya set hoga</p>
                </div>
                <div>
                  <label>🔑 Purana Password</label>
                  <input
                    type="password"
                    placeholder="Your current password"
                    value={pwForm.current}
                    onChange={e => setPwForm({...pwForm, current: e.target.value})}
                  />
                </div>
                <div>
                  <label>🆕 Naya Password</label>
                  <input
                    type="password"
                    placeholder="New password (at least 6 characters)"
                    value={pwForm.newPw}
                    onChange={e => setPwForm({...pwForm, newPw: e.target.value})}
                  />
                </div>
                <div>
                  <label>✅ Naya Password Confirm Karo</label>
                  <input
                    type="password"
                    placeholder="Confirm new password"
                    value={pwForm.confirm}
                    onChange={e => setPwForm({...pwForm, confirm: e.target.value})}
                    onKeyDown={e => e.key === "Enter" && changePassword()}
                  />
                  {pwForm.confirm && pwForm.newPw && (
                    <p className={`text-xs mt-1 font-bold ${pwForm.newPw === pwForm.confirm ? "text-green-600" : "text-red-500"}`}>
                      {pwForm.newPw === pwForm.confirm ? "✓ Passwords match" : "✗ Passwords do not match"}
                    </p>
                  )}
                </div>
                <button
                  onClick={changePassword}
                  disabled={saving || pwForm.newPw !== pwForm.confirm || !pwForm.current}
                  className={`w-full py-3 rounded-xl font-bold transition-all ${
                    !saving && pwForm.newPw === pwForm.confirm && pwForm.current
                      ? "btn-navy"
                      : "bg-gray-200 text-gray-400 cursor-not-allowed"
                  }`}>
                  {saving ? "⏳ Update ho raha hai..." : "🔒 Password Badlo"}
                </button>
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════
// 🚀 MAIN APP
// ═══════════════════════════════════════════════
// Track visitor silently
// Visitor ID — localStorage mein save, agar nahi hai to ek baar banao
function getVisitorId() {
  let vid = localStorage.getItem("dronna_vid");
  if (!vid) {
    vid = "v_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
    localStorage.setItem("dronna_vid", vid);
  }
  return vid;
}

async function trackVisit(page) {
  try {
    const vid = getVisitorId();
    const today = new Date().toISOString().slice(0, 10); // "2025-03-21"

    // Check: aaj is visitor ki entry already hai?
    const checkUrl = `${CONFIG.SUPABASE_URL}/rest/v1/visitor_stats?visitor_id=eq.${vid}&visit_date=eq.${today}&select=id&limit=1&apikey=${CONFIG.SUPABASE_ANON_KEY}`;
    const checkRes = await fetch(checkUrl, { headers: SB_HEADERS });
    const existing = await checkRes.json();

    if (Array.isArray(existing) && existing.length > 0) {
      // Aaj pehle aa chuka hai — sirf last_page update karo, count mat badhao
      await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/visitor_stats?visitor_id=eq.${vid}&visit_date=eq.${today}&apikey=${CONFIG.SUPABASE_ANON_KEY}`, {
        method: "PATCH",
        headers: { ...SB_HEADERS, "Prefer": "return=minimal" },
        body: JSON.stringify({ last_page: page || "/" })
      });
    } else {
      // Naya visit — insert karo
      await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/visitor_stats?apikey=${CONFIG.SUPABASE_ANON_KEY}`, {
        method: "POST",
        headers: { ...SB_HEADERS, "Prefer": "return=minimal" },
        body: JSON.stringify({
          visitor_id: vid,
          visit_date: today,
          last_page: page || "/",
          page: page || "/"
        })
      });
    }
  } catch(e) {}
}



function App() {
  const { page } = useRouter();
  const { user, loading } = useAuth();

  useEffect(() => { trackVisit(page); }, [page]);

  if (loading) return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-8" style={{background:"#0D1B3E"}}>
      {/* Mountain icon */}
      <div style={{animation:"mountainRise 0.6s ease forwards", opacity:0, animationDelay:"0.1s"}}>
        <span style={{fontSize:"42px", filter:"drop-shadow(0 0 12px rgba(249,115,22,0.5))"}}>⛰</span>
      </div>

      {/* DRONNA letter by letter */}
      <div className="flex items-end gap-1" style={{letterSpacing:"0.08em"}}>
        {["D","R","O","N","N","A"].map((ch, i) => (
          <span
            key={i}
            className="dronna-letter font-headline font-black"
            style={{
              fontSize: "clamp(32px, 8vw, 52px)",
              color: i === 0 || i === 5 ? "#F97316" : "white",
              animationDelay: `${0.15 + i * 0.1}s`
            }}
          >
            {ch}
          </span>
        ))}
      </div>

      {/* Loading bar */}
      <div style={{width:"160px", background:"rgba(255,255,255,0.1)", borderRadius:"999px", overflow:"hidden", animationDelay:"0.9s", opacity:0, animation:"mountainRise 0.4s ease 0.9s forwards"}}>
        <div className="loader-bar" style={{animationDuration:"1.6s"}}></div>
      </div>

      {/* Tagline */}
      <p className="font-hindi text-sm font-medium" style={{color:"rgba(255,255,255,0.35)", animation:"mountainRise 0.4s ease 1.1s forwards", opacity:0}}>
        UKPSC & UKSSSC Exam Preparation
      </p>
    </div>
  );

  // Route matching
  const quizMatch = page.match(/^\/quiz\/(.+)$/);
  if (quizMatch) return <QuizPage setId={quizMatch[1]} />;

  switch (page) {
    case "/": return user ? <Dashboard /> : <LandingPage />;
    case "/login": return user ? <Dashboard /> : <LoginPage />;
    case "/signup": return user ? <Dashboard /> : <SignupPage />;
    case "/dashboard": return user ? <Dashboard /> : <LoginPage />;
    case "/practice": return <PracticePage />;
    case "/profile": return user ? <ProfilePage /> : <LoginPage />;
    case "/daily": return <DailyChallenge />;
    case "/leaderboard": return <LeaderboardPage />;
    case "/syllabus": return <SyllabusPage />;
    case "/admin": return <AdminPanel />;
    default: return (
      <div className="min-h-screen flex items-center justify-center" style={{background:"var(--cream)"}}>
        <div className="text-center">
          <div className="text-6xl mb-4">🗺️</div>
          <h2 className="text-2xl font-black mb-2" style={{color:"var(--navy)"}}>Page nahi mila</h2>
          <button className="btn-primary mt-4" onClick={() => window.location.hash = "/"}>Home pe jao</button>
        </div>
      </div>
    );
  }
}


export { Router, AuthProvider };
export default App;
