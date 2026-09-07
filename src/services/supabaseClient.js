import { CONFIG, FUNCTIONS_BASE } from '../config/appConfig.js';
import { ADMIN_ATTEMPT_FIELDS, ATTEMPT_TIMESTAMP_FIELDS, buildAttemptPayload, getLocalDayIsoRange, mergeUniqueAttempts, parseCountFromContentRange, sortAttemptsByTime, stripAttemptFields } from '../utils/attempts.js';
import { isAccessTokenFresh, normalizeEmail, readStoredAuthUser, removeStoredAuthUser, writeStoredAuthUser } from '../utils/authStorage.js';

const PUBLIC_API_TIMEOUT_MS = 10000;

function getFetchErrorMessage(error, fallback = "Request could not be loaded") {
  if (error?.name === "AbortError") return "Request timed out. Please try again.";
  return error?.message || fallback;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = PUBLIC_API_TIMEOUT_MS) {
  if (typeof AbortController === "undefined") {
    return fetch(url, options);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function invokeEdgeFunction(name, { accessToken, body = {} } = {}) {
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
  if (!r.ok) throw new Error(data?.error || data?.message || `Function ${name} failed (${r.status})`);
  return data;
}

export async function fetchPublicTableCount(table) {
  const result = await fetchPublicTableCountResult(table);
  return result.data;
}

async function fetchPublicTableCountResult(table) {
  if (!CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_ANON_KEY) {
    return { data: null, error: "" };
  }

  try {
    const url = `${CONFIG.SUPABASE_URL}/rest/v1/${table}?select=id&limit=1&apikey=${CONFIG.SUPABASE_ANON_KEY}`;
    const response = await fetchWithTimeout(url, {
      headers: {
        ...SB_HEADERS,
        "Prefer": "count=exact"
      }
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return { data: null, error: errorData?.message || errorData?.hint || `${table} count could not be loaded` };
    }
    const range = response.headers.get("content-range");
    const count = parseCountFromContentRange(range, null);
    return {
      data: Number.isFinite(count) ? count : null,
      error: Number.isFinite(count) ? "" : `${table} count could not be loaded`
    };
  } catch (e) {
    return { data: null, error: getFetchErrorMessage(e, `${table} count could not be loaded`) };
  }
}

export async function fetchSetQuestionCountMap(headers = SB_HEADERS) {
  if (!CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_ANON_KEY) {
    return { data: {}, error: "" };
  }

  try {
    const countMap = {};
    const batchSize = 1000;
    let offset = 0;

    while (true) {
      const url = `${CONFIG.SUPABASE_URL}/rest/v1/set_questions?select=set_id,question_id&order=set_id.asc,question_id.asc&limit=${batchSize}&offset=${offset}&apikey=${CONFIG.SUPABASE_ANON_KEY}`;
      const response = await fetchWithTimeout(url, { headers });
      const rows = await response.json().catch(() => []);

      if (!response.ok) {
        return { data: countMap, error: rows?.message || rows?.hint || "Question counts could not be loaded" };
      }

      if (!Array.isArray(rows) || rows.length === 0) break;

      rows.forEach((row) => {
        if (!row?.set_id) return;
        countMap[row.set_id] = (countMap[row.set_id] || 0) + 1;
      });

      if (rows.length < batchSize) break;
      offset += batchSize;
    }

    return { data: countMap, error: "" };
  } catch(e) {
    return { data: {}, error: getFetchErrorMessage(e, "Question counts could not be loaded") };
  }
}

export async function fetchPublicPracticeSetPreview(limit = 8) {
  const result = await fetchPublicPracticeSetPreviewResult(limit);
  return result.data;
}

async function fetchPublicPracticeSetPreviewResult(limit = 8) {
  if (!CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_ANON_KEY) {
    return { data: [], error: "" };
  }
  try {
    const setsUrl = `${CONFIG.SUPABASE_URL}/rest/v1/practice_sets?select=id,set_name,subject,exam_type,time_limit_minutes,is_paid&order=set_name.asc&limit=${limit}&apikey=${CONFIG.SUPABASE_ANON_KEY}`;
    const [setsResponse, countResult] = await Promise.all([
      fetchWithTimeout(setsUrl, { headers: SB_HEADERS }),
      fetchSetQuestionCountMap(SB_HEADERS)
    ]);
    const sets = await setsResponse.json().catch(() => []);
    if (!setsResponse.ok || !Array.isArray(sets)) {
      return { data: [], error: sets?.message || sets?.hint || "Practice sets could not be loaded" };
    }
    const questionCountBySet = countResult.data || {};

    return {
      data: sets.map((set) => ({
        ...set,
        question_count: countResult.error ? (questionCountBySet[set.id] ?? null) : (questionCountBySet[set.id] || 0),
        question_count_unavailable: Boolean(countResult.error && questionCountBySet[set.id] === undefined)
      })),
      error: countResult.error || ""
    };
  } catch (e) {
    return { data: [], error: getFetchErrorMessage(e, "Practice sets could not be loaded") };
  }
}

export async function fetchPublicCourseCatalog() {
  if (!CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_ANON_KEY) {
    return { folders: [], sets: [], error: "" };
  }

  try {
    const foldersUrl = `${CONFIG.SUPABASE_URL}/rest/v1/folders?select=*&order=name.asc&apikey=${CONFIG.SUPABASE_ANON_KEY}`;
    const setsUrl = `${CONFIG.SUPABASE_URL}/rest/v1/practice_sets?select=id,set_name,subject,exam_type,time_limit_minutes,is_paid,folder_id&order=set_name.asc&apikey=${CONFIG.SUPABASE_ANON_KEY}`;

    const [foldersResponse, setsResponse, countResult] = await Promise.all([
      fetchWithTimeout(foldersUrl, { headers: SB_HEADERS }),
      fetchWithTimeout(setsUrl, { headers: SB_HEADERS }),
      fetchSetQuestionCountMap(SB_HEADERS)
    ]);

    const folders = await foldersResponse.json().catch(() => []);
    const sets = await setsResponse.json().catch(() => []);

    if (!foldersResponse.ok || !setsResponse.ok) {
      return {
        folders: [],
        sets: [],
        error: folders?.message || sets?.message || "Course catalog could not be loaded"
      };
    }

    const questionCountBySet = countResult.data || {};

    return {
      folders: Array.isArray(folders) ? folders : [],
      sets: Array.isArray(sets)
        ? sets.map((set) => ({
            ...set,
            question_count: countResult.error ? (questionCountBySet[set.id] ?? null) : (questionCountBySet[set.id] || 0),
            question_count_unavailable: Boolean(countResult.error && questionCountBySet[set.id] === undefined)
          }))
        : [],
      error: "",
      questionCountError: countResult.error || ""
    };
  } catch (e) {
    return { folders: [], sets: [], error: getFetchErrorMessage(e, "Course catalog could not be loaded") };
  }
}

export async function getPublicLandingStats() {
  const [questions, practiceSets, setQuestions, leaderboardEntries, practiceSetPreviewResult, courseCatalog] = await Promise.all([
    fetchPublicTableCountResult("questions"),
    fetchPublicTableCountResult("practice_sets"),
    fetchPublicTableCountResult("set_questions"),
    fetchPublicTableCountResult("daily_leaderboard"),
    fetchPublicPracticeSetPreviewResult(),
    fetchPublicCourseCatalog()
  ]);

  const statsErrors = [
    questions.error,
    practiceSets.error,
    setQuestions.error,
    leaderboardEntries.error
  ].filter(Boolean);
  const dataErrors = [
    practiceSetPreviewResult.error,
    courseCatalog.questionCountError
  ].filter(Boolean);

  return {
    questions: questions.data,
    practiceSets: practiceSets.data,
    setQuestions: setQuestions.data,
    leaderboardEntries: leaderboardEntries.data,
    practiceSetPreview: practiceSetPreviewResult.data,
    courseFolders: courseCatalog.folders,
    courseSets: courseCatalog.sets,
    courseCatalogError: courseCatalog.error,
    countError: [...statsErrors, ...dataErrors][0] || "",
    statsError: statsErrors[0] || "",
    questionCountError: courseCatalog.questionCountError || practiceSetPreviewResult.error || ""
  };
}

export function getSupabaseHeaders(accessToken, extraHeaders = {}) {
  return {
    "apikey": CONFIG.SUPABASE_ANON_KEY,
    "Authorization": `Bearer ${accessToken || CONFIG.SUPABASE_ANON_KEY}`,
    "Content-Type": "application/json",
    "Prefer": "return=representation",
    ...extraHeaders
  };
}

export const SB_HEADERS = getSupabaseHeaders();

export const supabase = {
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
    requestPasswordResetCode: async ({ email }) => {
      try {
        const r = await fetch(`${CONFIG.SUPABASE_URL}/auth/v1/recover`, {
          method: "POST",
          headers: { "apikey": CONFIG.SUPABASE_ANON_KEY, "Content-Type": "application/json" },
          body: JSON.stringify({ email })
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) {
          return {
            data: null,
            error: data?.error_description || data?.msg || data?.message || data?.error || "Reset code could not be sent.",
            status: r.status
          };
        }
        return { data, error: null, status: r.status };
      } catch (e) {
        return { data: null, error: e.message || "Reset code could not be sent.", status: 0 };
      }
    },
    verifyPasswordResetCode: async ({ email, token }) => {
      try {
        const r = await fetch(`${CONFIG.SUPABASE_URL}/auth/v1/verify`, {
          method: "POST",
          headers: { "apikey": CONFIG.SUPABASE_ANON_KEY, "Content-Type": "application/json" },
          body: JSON.stringify({ email, token, type: "recovery" })
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok || !data?.access_token) {
          return {
            data: null,
            error: data?.error_description || data?.msg || data?.message || data?.error || "The code is invalid or has expired.",
            status: r.status
          };
        }
        return { data, error: null, status: r.status };
      } catch (e) {
        return { data: null, error: e.message || "The code could not be verified.", status: 0 };
      }
    },
    updatePassword: async ({ accessToken, password }) => {
      try {
        const r = await fetch(`${CONFIG.SUPABASE_URL}/auth/v1/user`, {
          method: "PUT",
          headers: {
            "apikey": CONFIG.SUPABASE_ANON_KEY,
            "Authorization": `Bearer ${accessToken}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ password })
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) {
          return {
            data: null,
            error: data?.error_description || data?.msg || data?.message || data?.error || "Password could not be updated.",
            status: r.status
          };
        }
        return { data, error: null, status: r.status };
      } catch (e) {
        return { data: null, error: e.message || "Password could not be updated.", status: 0 };
      }
    },
    signOut: async (accessToken) => {
      if (!accessToken) return { error: null };
      try {
        const r = await fetch(`${CONFIG.SUPABASE_URL}/auth/v1/logout`, {
          method: "POST",
          headers: {
            "apikey": CONFIG.SUPABASE_ANON_KEY,
            "Authorization": `Bearer ${accessToken}`
          }
        });
        return { error: r.ok ? null : "Recovery session could not be closed." };
      } catch (e) {
        return { error: e.message || "Recovery session could not be closed." };
      }
    },
    refreshSession: async (refreshToken) => {
      try {
        const r = await fetch(`${CONFIG.SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
          method: "POST",
          headers: { "apikey": CONFIG.SUPABASE_ANON_KEY, "Content-Type": "application/json" },
          body: JSON.stringify({ refresh_token: refreshToken })
        });
        const data = await r.json();
        if (!r.ok || data?.error) {
          return { data: null, error: data?.error_description || data?.error || data?.message || "Session refresh failed" };
        }
        return { data, error: null };
      } catch (e) {
        return { data: null, error: e.message };
      }
    },
    ensureAccessToken: async (accessToken, { forceRefresh = false } = {}) => {
      if (!forceRefresh && isAccessTokenFresh(accessToken)) {
        return { accessToken, error: null };
      }

      const storedUser = readStoredAuthUser();
      if (!forceRefresh && isAccessTokenFresh(storedUser?.access_token)) {
        return { accessToken: storedUser.access_token, error: null };
      }

      if (!storedUser?.refresh_token) {
        return { accessToken: null, error: "Session expired. Please log in again and try once more." };
      }

      const refreshed = await supabase.auth.refreshSession(storedUser.refresh_token);
      if (refreshed.error || !refreshed.data?.access_token) {
        removeStoredAuthUser();
        return { accessToken: null, error: refreshed.error || "Session expired. Please log in again and try once more." };
      }

      const nextUser = {
        ...storedUser,
        access_token: refreshed.data.access_token,
        refresh_token: refreshed.data.refresh_token || storedUser.refresh_token,
        auth_id: refreshed.data.user?.id || storedUser.auth_id,
        email: refreshed.data.user?.email || storedUser.email
      };
      writeStoredAuthUser(nextUser);
      return { accessToken: nextUser.access_token, error: null, user: nextUser };
    },
  },
  getAuthorizedHeaders: async (accessToken, extraHeaders = {}) => {
    if (!accessToken) {
      return { headers: getSupabaseHeaders(null, extraHeaders), error: null, accessToken: null };
    }
    const session = await supabase.auth.ensureAccessToken(accessToken);
    if (session.error || !session.accessToken) {
      return { headers: null, error: session.error || "Session expired. Please log in again and try once more.", accessToken: null };
    }
    return {
      headers: getSupabaseHeaders(session.accessToken, extraHeaders),
      error: null,
      accessToken: session.accessToken,
      user: session.user || null
    };
  },
  getRequiredAuthHeaders: async (accessToken, extraHeaders = {}) => {
    const candidateToken = accessToken || readStoredAuthUser()?.access_token || null;
    const session = await supabase.auth.ensureAccessToken(candidateToken);
    if (session.error || !session.accessToken) {
      return {
        headers: null,
        error: session.error || "Session expired. Please log in again and try once more.",
        accessToken: null
      };
    }
    return {
      headers: getSupabaseHeaders(session.accessToken, extraHeaders),
      error: null,
      accessToken: session.accessToken,
      user: session.user || null
    };
  },
  getAll: async (table, query = "select=*", { accessToken } = {}) => {
    try {
      const url = `${CONFIG.SUPABASE_URL}/rest/v1/${table}?${query}&apikey=${CONFIG.SUPABASE_ANON_KEY}`;
      const auth = await supabase.getAuthorizedHeaders(accessToken);
      if (auth.error) {
        return { data: [], error: auth.error };
      }
      const r = await fetchWithTimeout(url, { headers: auth.headers });
      const data = await r.json();
      if (!r.ok) {
        return { data: [], error: data?.message || data?.hint || "Fetch failed" };
      }
      return { data: Array.isArray(data) ? data : [], error: null };
    } catch(e) { return { data: [], error: getFetchErrorMessage(e, "Fetch failed") }; }
  },
  getSetQuestionCounts: async ({ accessToken } = {}) => {
    try {
      const auth = await supabase.getAuthorizedHeaders(accessToken);
      if (auth.error) return { data: {}, error: auth.error };
      return await fetchSetQuestionCountMap(auth.headers);
    } catch(e) { return { data: {}, error: getFetchErrorMessage(e, "Question counts could not be loaded") }; }
  },
  insert: async (table, row, { accessToken } = {}) => {
    try {
      const url = `${CONFIG.SUPABASE_URL}/rest/v1/${table}?apikey=${CONFIG.SUPABASE_ANON_KEY}`;
      const auth = await supabase.getAuthorizedHeaders(accessToken);
      if (auth.error) {
        return { data: null, error: auth.error };
      }
      const r = await fetch(url, { method:"POST", headers: auth.headers, body: JSON.stringify(row) });
      const data = await r.json();
      if (!r.ok) {
        return { data: null, error: data?.message || data?.hint || "Insert failed" };
      }
      return { data, error: null };
    } catch(e) { return { data: null, error: e.message }; }
  },
  getAdminStatus: async (accessToken) => {
    try {
      const session = await supabase.auth.ensureAccessToken(accessToken);
      if (session.error) return { isAdmin: false, error: session.error };
      return await invokeEdgeFunction("admin-status", { accessToken: session.accessToken });
    } catch (e) {
      return { isAdmin: false, error: e.message };
    }
  },
  adminWrite: async (action, payload, accessToken) => {
    try {
      const session = await supabase.auth.ensureAccessToken(accessToken);
      if (session.error) return { error: session.error };
      return await invokeEdgeFunction("admin-write", {
        accessToken: session.accessToken,
        body: { action, payload }
      });
    } catch (e) {
      if (/unauthorized|missing authorization|bearer token/i.test(e.message || "")) {
        const refreshed = await supabase.auth.ensureAccessToken(accessToken, { forceRefresh: true });
        if (refreshed.error) return { error: refreshed.error };
        try {
          return await invokeEdgeFunction("admin-write", {
            accessToken: refreshed.accessToken,
            body: { action, payload }
          });
        } catch (retryError) {
          return { error: retryError.message };
        }
      }
      return { error: e.message };
    }
  },
  sendWelcomeEmail: async (payload, accessToken) => {
    try {
      const session = await supabase.auth.ensureAccessToken(accessToken);
      if (session.error) return { error: session.error };
      return await invokeEdgeFunction("send-email", {
        accessToken: session.accessToken,
        body: { action: "welcome", payload }
      });
    } catch (e) {
      return { error: e.message };
    }
  },
  sendCoursePurchaseEmail: async (payload, accessToken) => {
    try {
      const session = await supabase.auth.ensureAccessToken(accessToken);
      if (session.error) return { error: session.error };
      return await invokeEdgeFunction("send-email", {
        accessToken: session.accessToken,
        body: { action: "course_purchase", payload }
      });
    } catch (e) {
      return { error: e.message };
    }
  },
  createRazorpayOrder: async (payload, accessToken) => {
    try {
      const session = await supabase.auth.ensureAccessToken(accessToken);
      if (session.error) return { error: session.error };
      return await invokeEdgeFunction("razorpay-payment", {
        accessToken: session.accessToken,
        body: { action: "create_order", payload }
      });
    } catch (e) {
      return { error: e.message };
    }
  },
  verifyRazorpayPayment: async (payload, accessToken) => {
    try {
      const session = await supabase.auth.ensureAccessToken(accessToken);
      if (session.error) return { error: session.error };
      return await invokeEdgeFunction("razorpay-payment", {
        accessToken: session.accessToken,
        body: { action: "verify_payment", payload }
      });
    } catch (e) {
      return { error: e.message };
    }
  },
  validateRazorpayCoupon: async (payload, accessToken) => {
    try {
      const session = await supabase.auth.ensureAccessToken(accessToken);
      if (session.error) return { error: session.error };
      return await invokeEdgeFunction("razorpay-payment", {
        accessToken: session.accessToken,
        body: { action: "validate_coupon", payload }
      });
    } catch (e) {
      return { error: e.message };
    }
  },
  // Student ka streak aur daily_date fetch karo
  getStudentData: async (email, accessToken) => {
    try {
      const normalizedEmail = normalizeEmail(email);
      const url = CONFIG.SUPABASE_URL + "/rest/v1/students?email=eq." + encodeURIComponent(normalizedEmail) + "&select=*&apikey=" + CONFIG.SUPABASE_ANON_KEY;
      const auth = await supabase.getRequiredAuthHeaders(accessToken);
      if (auth.error) return null;
      const r = await fetch(url, { headers: auth.headers });
      const data = await r.json();
      return Array.isArray(data) && data[0] ? data[0] : null;
    } catch(e) { return null; }
  },

  // Student ka streak aur daily_date update karo
  updateStudentData: async (email, updates, accessToken) => {
    try {
      const normalizedEmail = normalizeEmail(email);
      const url = CONFIG.SUPABASE_URL + "/rest/v1/students?email=eq." + encodeURIComponent(normalizedEmail) + "&apikey=" + CONFIG.SUPABASE_ANON_KEY;
      const auth = await supabase.getRequiredAuthHeaders(accessToken);
      if (auth.error) return { error: auth.error };
      const r = await fetch(url, {
        method: "PATCH",
        headers: auth.headers,
        body: JSON.stringify(updates)
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        return { error: data?.message || data?.hint || "Student update failed" };
      }
      return { error: null };
    } catch(e) { return { error: e.message }; }
  },
  getAdminAttemptsOverview: async ({ accessToken, order = "desc", recentLimit = 20 } = {}) => {
    try {
      const auth = await supabase.getRequiredAuthHeaders(accessToken, { "Prefer": "count=planned" });
      if (auth.error) {
        return { recentAttempts: [], totalCount: 0, todayCount: 0, error: auth.error };
      }

      const recentQueries = [
        ...ATTEMPT_TIMESTAMP_FIELDS.map((field) =>
          `${CONFIG.SUPABASE_URL}/rest/v1/attempts?select=${ADMIN_ATTEMPT_FIELDS}&order=${field}.${order}&limit=${recentLimit}&apikey=${CONFIG.SUPABASE_ANON_KEY}`
        ),
        `${CONFIG.SUPABASE_URL}/rest/v1/attempts?select=${ADMIN_ATTEMPT_FIELDS}&limit=${recentLimit}&apikey=${CONFIG.SUPABASE_ANON_KEY}`
      ];

      const recentResults = await Promise.all(
        recentQueries.map(async (url) => {
          try {
            const r = await fetch(url, { headers: auth.headers });
            const data = await r.json().catch(() => []);
            return {
              ok: r.ok && Array.isArray(data),
              data: Array.isArray(data) ? data : [],
              count: parseCountFromContentRange(r.headers.get("content-range"), Array.isArray(data) ? data.length : 0)
            };
          } catch {
            return { ok: false, data: [], count: 0 };
          }
        })
      );

      const recentCandidates = [];
      let totalCount = 0;
      recentResults.forEach((result) => {
        if (!result.ok) return;
        recentCandidates.push(...result.data);
        totalCount = Math.max(totalCount, result.count);
      });

      const recentAttempts = sortAttemptsByTime(mergeUniqueAttempts(recentCandidates), order).slice(0, recentLimit);
      if (!totalCount && recentAttempts.length > 0) {
        totalCount = recentAttempts.length;
      }

      const { startIso, endIso, startDate, endDate } = getLocalDayIsoRange();
      const todayCountQueries = [
        `${CONFIG.SUPABASE_URL}/rest/v1/attempts?completed_at=gte.${encodeURIComponent(startIso)}&completed_at=lt.${encodeURIComponent(endIso)}&select=id&limit=1000&apikey=${CONFIG.SUPABASE_ANON_KEY}`,
        `${CONFIG.SUPABASE_URL}/rest/v1/attempts?date=gte.${encodeURIComponent(startIso)}&date=lt.${encodeURIComponent(endIso)}&select=id&limit=1000&apikey=${CONFIG.SUPABASE_ANON_KEY}`,
        `${CONFIG.SUPABASE_URL}/rest/v1/attempts?date=gte.${encodeURIComponent(startDate)}&date=lt.${encodeURIComponent(endDate)}&select=id&limit=1000&apikey=${CONFIG.SUPABASE_ANON_KEY}`,
        `${CONFIG.SUPABASE_URL}/rest/v1/attempts?created_at=gte.${encodeURIComponent(startIso)}&created_at=lt.${encodeURIComponent(endIso)}&select=id&limit=1000&apikey=${CONFIG.SUPABASE_ANON_KEY}`
      ];

      const todayResults = await Promise.all(
        todayCountQueries.map(async (url) => {
          try {
            const r = await fetch(url, { headers: auth.headers });
            const data = await r.json().catch(() => []);
            return r.ok && Array.isArray(data) ? data : [];
          } catch {
            return [];
          }
        })
      );

      const todayIds = new Set();
      todayResults.flat().forEach((attempt) => {
        if (attempt?.id !== undefined && attempt?.id !== null && attempt.id !== "") {
          todayIds.add(String(attempt.id));
        }
      });

      return {
        recentAttempts,
        totalCount,
        todayCount: todayIds.size,
        error: null
      };
    } catch (e) {
      return { recentAttempts: [], totalCount: 0, todayCount: 0, error: e.message };
    }
  },

  getAttempts: async ({ studentEmail = null, accessToken, order = "desc" } = {}) => {
    try {
      const auth = await supabase.getRequiredAuthHeaders(accessToken);
      if (auth.error) return [];
      const normalizedEmail = normalizeEmail(studentEmail);
      const filter = normalizedEmail ? `student_email=eq.${encodeURIComponent(normalizedEmail)}&` : "";
      const queries = [
        `${CONFIG.SUPABASE_URL}/rest/v1/attempts?${filter}select=*&order=completed_at.${order}&apikey=${CONFIG.SUPABASE_ANON_KEY}`,
        `${CONFIG.SUPABASE_URL}/rest/v1/attempts?${filter}select=*&order=date.${order}&apikey=${CONFIG.SUPABASE_ANON_KEY}`,
        `${CONFIG.SUPABASE_URL}/rest/v1/attempts?${filter}select=*&apikey=${CONFIG.SUPABASE_ANON_KEY}`
      ];

      for (const url of queries) {
        const r = await fetch(url, { headers: auth.headers });
        const data = await r.json().catch(() => []);
        if (!r.ok) continue;
        if (Array.isArray(data)) return sortAttemptsByTime(data, order);
      }
      return [];
    } catch(e) { return []; }
  },

  getStudentAttempts: async (email, accessToken, order = "desc") => {
    return await supabase.getAttempts({
      studentEmail: email,
      accessToken,
      order
    });
  },

  saveAttempt: async (attempt, accessToken) => {
    try {
      const auth = await supabase.getRequiredAuthHeaders(accessToken);
      if (auth.error) return { error: auth.error };
      const payload = buildAttemptPayload(attempt);
      const payloadVariants = [
        payload,
        stripAttemptFields(payload, ["completed_at"]),
        stripAttemptFields(payload, ["date"]),
        stripAttemptFields(payload, ["completed_at", "date"])
      ];

      let lastError = "Attempt save failed";
      for (const variant of payloadVariants) {
        const r = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/attempts?apikey=${CONFIG.SUPABASE_ANON_KEY}`, {
          method: "POST",
          headers: auth.headers,
          body: JSON.stringify(variant)
        });
        const data = await r.json().catch(() => ({}));
        if (r.ok) {
          return { error: null };
        }
        lastError = data?.message || data?.hint || lastError;
      }
      return { error: lastError };
    } catch(e) { return { error: e.message }; }
  },

  // Leaderboard entry save karo
  saveLeaderboard: async (entry, accessToken) => {
    try {
      const auth = await supabase.getRequiredAuthHeaders(accessToken);
      if (auth.error) return { error: auth.error };
      const normalizedEntry = {
        ...entry,
        email: normalizeEmail(entry.email)
      };
      const challengeDate = entry.challenge_date || entry.date;
      // Pehle check karo aaj ki entry hai kya
      const url = CONFIG.SUPABASE_URL + "/rest/v1/daily_leaderboard?email=eq." + encodeURIComponent(normalizedEntry.email) + "&challenge_date=eq." + challengeDate + "&apikey=" + CONFIG.SUPABASE_ANON_KEY;
      const r = await fetch(url, { headers: auth.headers });
      const existing = await r.json();
      if (Array.isArray(existing) && existing.length > 0) {
        // Update karo
        const updateRes = await fetch(url, {
          method: "PATCH",
          headers: auth.headers,
          body: JSON.stringify({ score: normalizedEntry.score, total: normalizedEntry.total })
        });
        if (!updateRes.ok) {
          const updateData = await updateRes.json().catch(() => ({}));
          return { error: updateData?.message || updateData?.hint || "Leaderboard update failed" };
        }
      } else {
        // Insert karo
        const iUrl = CONFIG.SUPABASE_URL + "/rest/v1/daily_leaderboard?apikey=" + CONFIG.SUPABASE_ANON_KEY;
        const insertRes = await fetch(iUrl, { method: "POST", headers: auth.headers, body: JSON.stringify(normalizedEntry) });
        if (!insertRes.ok) {
          const insertData = await insertRes.json().catch(() => ({}));
          return { error: insertData?.message || insertData?.hint || "Leaderboard insert failed" };
        }
      }
      return { error: null };
    } catch(e) { return { error: e.message }; }
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

  //  FOLDER CRUD 
  getFolders: async () => {
    try {
      const url = CONFIG.SUPABASE_URL + "/rest/v1/folders?select=*&order=name.asc&apikey=" + CONFIG.SUPABASE_ANON_KEY;
      const r = await fetchWithTimeout(url, { headers: SB_HEADERS });
      const data = await r.json();
      if (Array.isArray(data)) return { ok: true, data };
      // Supabase error  table missing ya RLS blocking
      return { ok: false, error: data?.message || data?.hint || JSON.stringify(data) };
    } catch(e) { return { ok: false, error: getFetchErrorMessage(e, "Folders could not be loaded") }; }
  },
  getCoursePurchases: async (accessToken) => {
    try {
      const auth = await supabase.getRequiredAuthHeaders(accessToken);
      if (auth.error) return { data: [], error: auth.error };
      const purchasesUrl = CONFIG.SUPABASE_URL + "/rest/v1/course_purchases?select=folder_id,status&status=eq.active&apikey=" + CONFIG.SUPABASE_ANON_KEY;
      const paymentsUrl = CONFIG.SUPABASE_URL + "/rest/v1/payment_transactions?select=folder_id,status&status=eq.paid&folder_id=not.is.null&apikey=" + CONFIG.SUPABASE_ANON_KEY;
      const [purchaseResponse, paymentResponse] = await Promise.all([
        fetch(purchasesUrl, { headers: auth.headers }),
        fetch(paymentsUrl, { headers: auth.headers })
      ]);
      const purchases = await purchaseResponse.json().catch(() => []);
      const payments = await paymentResponse.json().catch(() => []);

      if (!purchaseResponse.ok && !paymentResponse.ok) {
        return { data: [], error: purchases?.message || payments?.message || "Course purchases could not be loaded" };
      }

      const rows = [
        ...(purchaseResponse.ok && Array.isArray(purchases) ? purchases : []),
        ...(paymentResponse.ok && Array.isArray(payments) ? payments.map((row) => ({ ...row, status: "active" })) : [])
      ];
      const uniqueRows = Array.from(new Map(rows.filter((row) => row.folder_id).map((row) => [row.folder_id, row])).values());
      return { data: uniqueRows, error: null };
    } catch(e) { return { data: [], error: e.message }; }
  },
  getPublicEbooks: async () => {
    if (!CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_ANON_KEY) {
      return { data: [], error: "" };
    }

    try {
      const columns = [
        "id",
        "title",
        "subtitle",
        "description",
        "cover_url",
        "preview_url",
        "price_inr",
        "mrp_inr",
        "discount_percent",
        "pages",
        "file_type",
        "tags",
        "is_active"
      ].join(",");
      const url = `${CONFIG.SUPABASE_URL}/rest/v1/ebooks?select=${columns}&is_active=eq.true&order=sort_order.asc,title.asc&apikey=${CONFIG.SUPABASE_ANON_KEY}`;
      const response = await fetchWithTimeout(url, { headers: SB_HEADERS });
      const data = await response.json().catch(() => []);
      if (!response.ok || !Array.isArray(data)) {
        return { data: [], error: data?.message || data?.hint || "Ebooks could not be loaded." };
      }
      return { data, error: null };
    } catch (e) {
      return { data: [], error: getFetchErrorMessage(e, "Ebooks could not be loaded.") };
    }
  },
  getMyEbookLibrary: async (accessToken) => {
    try {
      const auth = await supabase.getRequiredAuthHeaders(accessToken);
      if (auth.error) return { data: [], error: auth.error };
      const url = `${CONFIG.SUPABASE_URL}/rest/v1/rpc/get_my_ebook_library?apikey=${CONFIG.SUPABASE_ANON_KEY}`;
      const response = await fetchWithTimeout(url, {
        method: "POST",
        headers: auth.headers,
        body: JSON.stringify({})
      });
      const data = await response.json().catch(() => []);
      if (!response.ok || !Array.isArray(data)) {
        return { data: [], error: data?.message || data?.hint || "Purchased ebooks could not be loaded." };
      }
      return { data, error: null };
    } catch (e) {
      return { data: [], error: getFetchErrorMessage(e, "Purchased ebooks could not be loaded.") };
    }
  },
  prepareEbookAccess: async (ebookId, accessToken) => {
    try {
      const session = await supabase.auth.ensureAccessToken(accessToken);
      if (session.error) return { error: session.error };
      return await invokeEdgeFunction("ebook-access", {
        accessToken: session.accessToken,
        body: { ebook_id: ebookId }
      });
    } catch (e) {
      return { error: e.message || "Ebook access could not be prepared." };
    }
  },
  reportQuestion: async (payload) => {
    try {
      const url = CONFIG.SUPABASE_URL + "/rest/v1/question_reports?apikey=" + CONFIG.SUPABASE_ANON_KEY;
      const r = await fetch(url, { method:"POST", headers:{...SB_HEADERS,"Prefer":"return=minimal"}, body: JSON.stringify(payload) });
      return r.ok;
    } catch(e) { return false; }
  },
  getReports: async (accessToken) => {
    try {
      const url = CONFIG.SUPABASE_URL + "/rest/v1/question_reports?select=*&order=created_at.desc&apikey=" + CONFIG.SUPABASE_ANON_KEY;
      const auth = await supabase.getRequiredAuthHeaders(accessToken);
      if (auth.error) return [];
      const r = await fetch(url, { headers: auth.headers });
      const data = await r.json();
      return Array.isArray(data) ? data : [];
    } catch(e) { return []; }
  },
  getSetQuestions: async (setId, accessToken) => {
    try {
      const auth = await supabase.getAuthorizedHeaders(accessToken);
      if (auth.error) return { data: [], error: auth.error };
      // Step 1: set_questions se question_ids lo
      const url = CONFIG.SUPABASE_URL + "/rest/v1/set_questions?set_id=eq." + setId + "&select=question_id&apikey=" + CONFIG.SUPABASE_ANON_KEY;
      const r = await fetch(url, { headers: auth.headers });
      const data = await r.json();
      if (!Array.isArray(data) || data.length === 0) return { data: [], error: null };
      const ids = data.map(function(d){ return d.question_id; }).filter(Boolean);
      if (ids.length === 0) return { data: [], error: null };
      // Step 2: Correct IN filter  id=in.(uuid1,uuid2)
      const qUrl = CONFIG.SUPABASE_URL + "/rest/v1/questions?id=in.(" + ids.join(",") + ")&apikey=" + CONFIG.SUPABASE_ANON_KEY;
      const qr = await fetch(qUrl, { headers: auth.headers });
      const questions = await qr.json();
      return { data: Array.isArray(questions) ? questions : [], error: null };
    } catch(e) { return { data: [], error: e.message }; }
  }
};
