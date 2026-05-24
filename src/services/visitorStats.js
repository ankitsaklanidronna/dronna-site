import { CONFIG, VISITOR_STORAGE_KEY } from '../config/appConfig.js';
import { SB_HEADERS } from './supabaseClient.js';

export function getVisitorId() {
  let vid = localStorage.getItem(VISITOR_STORAGE_KEY);
  if (!vid) {
    vid = "v_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
    localStorage.setItem(VISITOR_STORAGE_KEY, vid);
  }
  return vid;
}

export function clearVisitorId() {
  localStorage.removeItem(VISITOR_STORAGE_KEY);
}

export async function removeVisitorFromStats(visitorId) {
  if (!visitorId) return;
  try {
    await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/visitor_stats?visitor_id=eq.${visitorId}&apikey=${CONFIG.SUPABASE_ANON_KEY}`, {
      method: "DELETE",
      headers: { ...SB_HEADERS, "Prefer": "return=minimal" }
    });
  } catch(e) {}
}

export async function trackVisit(page, user) {
  try {
    const existingVisitorId = localStorage.getItem(VISITOR_STORAGE_KEY);
    if (user?.isAdmin) {
      if (existingVisitorId) {
        await removeVisitorFromStats(existingVisitorId);
        clearVisitorId();
      }
      return;
    }

    const vid = getVisitorId();
    const today = new Date().toISOString().slice(0, 10); // "2025-03-21"

    // Check: aaj is visitor ki entry already hai?
    const checkUrl = `${CONFIG.SUPABASE_URL}/rest/v1/visitor_stats?visitor_id=eq.${vid}&visit_date=eq.${today}&select=id&limit=1&apikey=${CONFIG.SUPABASE_ANON_KEY}`;
    const checkRes = await fetch(checkUrl, { headers: SB_HEADERS });
    const existing = await checkRes.json();

    if (Array.isArray(existing) && existing.length > 0) {
      // Aaj pehle aa chuka hai  sirf last_page update karo, count mat badhao
      await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/visitor_stats?visitor_id=eq.${vid}&visit_date=eq.${today}&apikey=${CONFIG.SUPABASE_ANON_KEY}`, {
        method: "PATCH",
        headers: { ...SB_HEADERS, "Prefer": "return=minimal" },
        body: JSON.stringify({ last_page: page || "/" })
      });
    } else {
      // Naya visit  insert karo
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
