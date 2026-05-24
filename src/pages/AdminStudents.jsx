import { useEffect, useState } from 'react';
import { CONFIG } from '../config/appConfig.js';
import { useAuth } from '../context/AuthContext.jsx';
import { SB_HEADERS, supabase } from '../services/supabaseClient.js';

export function AdminStudents() {
  const { user } = useAuth();
  const [students, setStudents] = useState([]);
  const [attempts, setAttempts] = useState([]);
  const [attemptStats, setAttemptStats] = useState({ total: 0, today: 0 });
  const [loading, setLoading] = useState(true);
  const [visitorCount, setVisitorCount] = useState(0);
  const [visitorToday, setVisitorToday] = useState(0);
  const [visitorWeek, setVisitorWeek] = useState(0);

  useEffect(() => {
    loadData();
  }, [user?.access_token]);

  const loadData = async () => {
    if (!user?.access_token) return;
    setLoading(true);
    const [sRes, aRes] = await Promise.all([
      supabase.getAll("students", "select=*&order=created_at.desc", { accessToken: user.access_token }),
      supabase.getAdminAttemptsOverview({ accessToken: user.access_token, order: "desc", recentLimit: 20 })
    ]);
    setStudents(sRes.data || []);
    setAttempts(aRes?.recentAttempts || []);
    setAttemptStats({
      total: Number(aRes?.totalCount || 0),
      today: Number(aRes?.todayCount || 0)
    });

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

  return (
    <div className="max-w-4xl space-y-6">
      <h2 className="text-xl font-black" style={{color:"var(--navy)"}}> Students</h2>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label:"Total Students", value: loading ? "..." : students.length, icon:"" },
          { label:"Total Attempts", value: loading ? "..." : attemptStats.total, icon:"" },
          { label:"Today's Attempts", value: loading ? "..." : attemptStats.today, icon:"" },
          { label:"Total Visitors", value: loading ? "..." : visitorCount, icon:"" },
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
          <h3 className="font-bold mb-3" style={{color:"var(--navy)"}}> Visitor Stats</h3>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div className="p-3 rounded-lg" style={{background:"var(--cream)"}}>
              <div className="text-xl font-black" style={{color:"var(--saffron)"}}>{visitorToday}</div>
              <div className="text-xs text-gray-500">Today</div>
            </div>
            <div className="p-3 rounded-lg" style={{background:"var(--cream)"}}>
              <div className="text-xl font-black" style={{color:"var(--navy)"}}>{visitorWeek}</div>
              <div className="text-xs text-gray-500">This Week</div>
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
          <p className="text-gray-400 text-sm text-center py-4">No students are registered yet.</p>
        ) : (
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {students.map((s,i) => (
              <div key={s.id||i} className="flex items-center justify-between p-3 rounded-lg text-sm" style={{background:"var(--cream)"}}>
                <div>
                  <div className="font-bold">{s.full_name || s.email}</div>
                  <div className="text-xs text-gray-400">{s.email}  {s.exam_target || ""}</div>
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
        <div className="flex items-center justify-between gap-3 mb-4">
          <h3 className="font-bold">Recent Attempts</h3>
          {!loading && attemptStats.total > attempts.length && (
            <span className="text-xs text-gray-400">Showing latest {attempts.length} of {attemptStats.total}</span>
          )}
        </div>
        {loading ? (
          <div className="space-y-2">{[1,2,3].map(i=><div key={i} className="h-8 bg-gray-100 rounded animate-pulse"></div>)}</div>
        ) : attemptStats.total === 0 ? (
          <p className="text-gray-400 text-sm text-center py-4">No attempts have been recorded yet.</p>
        ) : (
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {attempts.map((a,i) => (
              <div key={a.id || i} className="flex items-center justify-between gap-3 p-3 rounded text-sm border">
                <div className="min-w-0">
                  <div className="font-bold truncate" style={{color:"var(--navy)"}}>{a.student_email || "Unknown student"}</div>
                  <div className="text-gray-500 text-xs truncate">
                    {(a.set_name || "Practice set")}  {new Date(a.completed_at||a.date||a.created_at).toLocaleDateString("en-IN")}
                  </div>
                </div>
                <span className="font-bold shrink-0" style={{color:"var(--saffron)"}}>{Math.round((a.score/(a.total_questions||a.total||1))*100)}%</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
