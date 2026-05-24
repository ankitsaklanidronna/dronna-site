import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { supabase } from '../services/supabaseClient.js';

export function AdminDaily() {
  const { user } = useAuth();
  const [scheduled, setScheduled] = useState([]);
  const [allQ, setAllQ] = useState([]);
  const [form, setForm] = useState({ date: new Date().toISOString().split("T")[0], question_id: "" });
  const [msg, setMsg] = useState("");

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    const [qRes, dcRes] = await Promise.all([
      supabase.getAll("questions", "select=*", { accessToken: user?.access_token }),
      supabase.getAll("daily_challenges")
    ]);
    setAllQ(qRes.data || []);
    setScheduled(dcRes.data||[]);
  };

  const schedule = async () => {
    if (!form.date || !form.question_id) { setMsg(" Please select a date and question"); return; }
    setMsg(" Saving...");
    const result = await supabase.adminWrite("schedule_daily_challenge", { challenge_date: form.date, question_id: form.question_id }, user?.access_token);
    if (result?.error) { setMsg(" Error: " + result.error); return; }
    setMsg(" Daily challenge scheduled successfully!");
    await loadData();
    setTimeout(() => setMsg(""), 2000);
  };

  return (
    <div className="max-w-2xl space-y-6">
      <h2 className="text-xl font-black" style={{color:"var(--navy)"}}> Daily Challenge Manager</h2>

      {msg && <div className={`p-3 rounded-lg text-sm ${msg.startsWith("") ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>{msg}</div>}

      <div className="card">
        <h3 className="font-bold mb-4">Schedule a Challenge</h3>
        <div className="space-y-3">
          <div>
            <label>Date</label>
            <input type="date" value={form.date} onChange={e=>setForm({...form,date:e.target.value})} />
          </div>
          <div>
            <label>Select Question</label>
            <select value={form.question_id} onChange={e=>setForm({...form,question_id:e.target.value})}>
              <option value="">-- Choose a question --</option>
              {allQ.map(q => <option key={q.id} value={q.id}>{q.question_text.slice(0,60)}...</option>)}
            </select>
          </div>
          <button className="btn-primary" onClick={schedule}> Schedule</button>
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
