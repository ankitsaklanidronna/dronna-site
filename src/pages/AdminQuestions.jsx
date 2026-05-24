import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { supabase } from '../services/supabaseClient.js';

export function AdminQuestions() {
  const { user } = useAuth();
  const [questions, setQuestions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ question_text:"", option_a:"", option_b:"", option_c:"", option_d:"", correct_answer:"A", subject:"General Knowledge", topic:"", difficulty:"easy", exam_type:"UKPSC", explanation:"" });
  const [msg, setMsg] = useState("");

  // Load from Supabase on mount
  useEffect(() => {
    loadQuestions();
  }, []);

  const loadQuestions = async () => {
    setLoading(true);
    const { data } = await supabase.getAll("questions", "select=*", { accessToken: user?.access_token });
    setQuestions(data || []);
    setLoading(false);
  };

  const allQ = questions;

  const saveQuestion = async () => {
    if (!form.question_text || !form.option_a || !form.option_b || !form.option_c || !form.option_d) { setMsg(" Please fill in all fields"); return; }
    setMsg(" Saving...");
    const { error } = await supabase.adminWrite("create_question", form, user?.access_token);
    if (error) { setMsg(" Error: " + error); return; }
    setForm({ question_text:"", option_a:"", option_b:"", option_c:"", option_d:"", correct_answer:"A", subject:"General Knowledge", topic:"", difficulty:"easy", exam_type:"UKPSC", explanation:"" });
    setMsg(" Question saved successfully!");
    await loadQuestions();
    setTimeout(() => setMsg(""), 2000);
  };

  const deleteQ = async (id) => {
    const { error } = await supabase.adminWrite("delete_question", { id }, user?.access_token);
    if (error) { setMsg(" Error: " + error); return; }
    await loadQuestions();
  };

  return (
    <div className="max-w-4xl space-y-6">
      <h2 className="text-xl font-black" style={{color:"var(--navy)"}}> Question Manager</h2>

      {/* Add Question Form */}
      <div className="card">
        <h3 className="font-bold mb-4">New Question Add Karo</h3>
        {msg && <div className={`p-3 rounded-lg text-sm mb-4 ${msg.startsWith("") ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>{msg}</div>}
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
                {["General Knowledge","Geography","Polity","History","Science","Mathematics","Mixed"].map(s => <option key={s} value={s}>{s}</option>)}
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
            <label> Explanation (optional, visible to students after the answer)</label>
            <textarea rows={3} placeholder="Why is this the correct answer? Add explanation here..." value={form.explanation} onChange={e=>setForm({...form,explanation:e.target.value})} />
          </div>
          <button className="btn-primary" onClick={saveQuestion}> Save Question</button>
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
            <div className="text-3xl mb-2"></div>
            <p className="text-sm">No questions yet. Add one above or import a CSV.</p>
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
              <button className="text-red-400 hover:text-red-600 text-sm font-bold flex-shrink-0" onClick={() => deleteQ(q.id)}></button>
            </div>
          ))}
        </div>
        )}
      </div>
    </div>
  );
}
