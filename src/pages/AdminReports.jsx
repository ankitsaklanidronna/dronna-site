import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { supabase } from '../services/supabaseClient.js';

export function AdminReports() {
  const { user } = useAuth();
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("pending");

  useEffect(() => { loadReports(); }, []);

  const loadReports = async () => {
    setLoading(true);
    const data = await supabase.getReports(user?.access_token);
    setReports(data);
    setLoading(false);
  };

  const resolve = async (id) => {
    const result = await supabase.adminWrite("resolve_report", { id }, user?.access_token);
    if (result?.error) return;
    await loadReports();
  };

  const typeLabel = {
    wrong_answer: " Wrong Answer",
    wrong_question: " Wrong Question",
    wrong_option: " Wrong Option",
    other: " Other"
  };

  const filtered = filter === "all" ? reports : reports.filter(r => r.status === filter);
  const pendingCount = reports.filter(r => r.status === "pending").length;

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-black" style={{color:"var(--navy)"}}> Question Reports</h2>
          <p className="text-sm text-gray-500 mt-1">Questions reported by students</p>
        </div>
        <div className="flex items-center gap-2">
          {pendingCount > 0 && (
            <span className="bg-red-500 text-white text-xs font-black px-3 py-1 rounded-full animate-pulse">
              {pendingCount} Pending
            </span>
          )}
          <button className="btn-outline text-sm py-1 px-3" onClick={loadReports}> Refresh</button>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2">
        {[
          { val:"pending", label:" Pending" },
          { val:"resolved", label:" Resolved" },
          { val:"all", label:" All" },
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
          <div className="text-5xl mb-3">{filter === "pending" ? "" : ""}</div>
          <p className="font-bold text-gray-500">
            {filter === "pending" ? "No pending reports  all good!" : "No reports found"}
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
                      {r.status === "resolved" ? " Resolved" : " Pending"}
                    </span>
                    <span className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full font-bold">
                      {typeLabel[r.report_type] || r.report_type}
                    </span>
                    {r.set_name && (
                      <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-bold">
                         {r.set_name}
                      </span>
                    )}
                  </div>

                  <p className="text-sm font-medium devanagari text-gray-800 mb-1 line-clamp-2">
                    {r.question_text || "Question text unavailable"}
                  </p>

                  {r.note && (
                    <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-2 mt-2">
                      <p className="text-xs text-yellow-800 font-medium"> Student note: {r.note}</p>
                    </div>
                  )}

                  <div className="flex gap-3 mt-2 text-xs text-gray-400">
                    <span> {r.student_email || "Anonymous"}</span>
                    <span> {r.created_at ? new Date(r.created_at).toLocaleDateString("en-IN") : ""}</span>
                  </div>
                </div>

                {r.status === "pending" && (
                  <button
                    onClick={() => resolve(r.id)}
                    className="flex-shrink-0 text-xs bg-green-500 text-white px-3 py-2 rounded-xl font-bold hover:bg-green-600 transition-all">
                     Resolve
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
          <p className="font-bold text-blue-800 text-sm mb-2"> First-time setup  run this SQL in Supabase:</p>
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
DROP POLICY IF EXISTS "reports_insert" ON question_reports;
DROP POLICY IF EXISTS "reports_admin_read" ON question_reports;
CREATE POLICY "reports_insert" ON question_reports FOR INSERT WITH CHECK (true);
CREATE POLICY "reports_admin_read" ON question_reports FOR SELECT TO authenticated USING (public.is_admin_email());
REVOKE UPDATE, DELETE ON question_reports FROM anon, authenticated;
GRANT INSERT ON TABLE question_reports TO anon, authenticated;
GRANT SELECT ON TABLE question_reports TO authenticated;`}</pre>
        </div>
      )}
    </div>
  );
}
