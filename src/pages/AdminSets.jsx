import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { supabase } from '../services/supabaseClient.js';
import { parseQuestionsCsv } from '../utils/csv.js';

export function AdminSets() {
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
    const [setsRes, qRes, fRes, countRes] = await Promise.all([
      supabase.getAll("practice_sets"),
      supabase.getAll("questions", "select=*", { accessToken: user?.access_token }),
      supabase.getFolders(),
      supabase.getSetQuestionCounts({ accessToken: user?.access_token })
    ]);
    const countMap = countRes?.data || {};
    setSets((setsRes.data || []).map((set) => ({
      ...set,
      question_count: countMap[set.id] ?? set.question_ids?.length ?? 0
    })));
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
      setMsg(" Set name and at least 1 question are required!"); return;
    }
    setMsg(" Creating practice set...");
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
      setMsg(`OK: "${form.set_name}" was saved with ${selectedQ.length} questions.`);
      setForm({ set_name:"", exam_type:"UKPSC", time_limit_minutes:30, is_paid:false, folder_id:"", subject:"Mixed" });
      setSelectedQ([]);
      setCreating(false);
      loadData();
    } catch(e) { setMsg(" Error: " + e.message); }
  };

  const handleCsvUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setCsvMsg("WAIT: Reading CSV...");
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
      setCsvMsg(`OK: ${result.questions.length} questions are ready.`);
    } catch (e) {
      setCsvQuestions([]);
      setCsvMsg(`ERR: Could not read the CSV: ${e.message}`);
    } finally {
      event.target.value = "";
    }
  };

  const saveSetFromCsv = async () => {
    if (!form.set_name.trim()) { setMsg("ERR: Set name is required"); return; }
    if (csvQuestions.length === 0) { setMsg("ERR: Upload a CSV first"); return; }

    setMsg("WAIT: Uploading CSV questions and creating the set...");
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
      setMsg(`OK: "${form.set_name}" was created from CSV. ${secureResult.data?.inserted_question_count || csvQuestions.length} questions were also added to the question bank.`);
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
      opts.push(<option key={f.id} value={f.id}> {f.name}</option>);
      getChildren(f.id).forEach(sf => {
        opts.push(<option key={sf.id} value={sf.id}>&nbsp;&nbsp;&nbsp; {sf.name}</option>);
      });
    });
    return opts;
  };

  const updateSetAccess = async (set, isPaid) => {
    setMsg(`WAIT: Marking "${set.set_name}" as ${isPaid ? "paid" : "free"}...`);
    const result = await supabase.adminWrite("update_set_access", { id: set.id, is_paid: isPaid }, user?.access_token);
    if (result.error) { setMsg("ERR: " + result.error); return; }
    setMsg(`OK: "${set.set_name}" is now ${isPaid ? "paid" : "free"}.`);
    await loadData();
  };

  const removeSetFromFolder = async (set) => {
    setMsg(`WAIT: Removing "${set.set_name}" from its folder...`);
    const result = await supabase.adminWrite("move_set_to_folder", { set_id: set.id, folder_id: null }, user?.access_token);
    if (result.error) { setMsg("ERR: " + result.error); return; }
    setMsg(`OK: "${set.set_name}" was removed from its folder.`);
    await loadData();
  };

  const deleteSet = async (set) => {
    if (!confirm(`Delete "${set.set_name}" permanently? Attempts and question links for this set will also be removed.`)) return;
    setMsg(`WAIT: Deleting "${set.set_name}"...`);
    const result = await supabase.adminWrite("delete_set", { id: set.id }, user?.access_token);
    if (result.error) { setMsg("ERR: " + result.error); return; }
    setMsg(`OK: "${set.set_name}" was deleted.`);
    await loadData();
  };

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-black text-navy"> Practice Sets Manager</h2>
        <button className="btn-primary text-sm" onClick={() => { setCreating(!creating); setMsg(""); }}>
          {creating ? " Close" : "+ Create New Set"}
        </button>
      </div>

      {msg && (
        <div className={`p-3 rounded-lg text-sm ${(msg.startsWith("") || msg.startsWith("OK:") || msg.startsWith("WAIT:")) ? "bg-green-50 text-green-700 border border-green-200" : "bg-red-50 text-red-700 border border-red-200"}`}>
          {msg}
        </div>
      )}

      {creating && (
        <div className="card fade-in border-t-4 border-orange-500 space-y-6">
          <h3 className="font-bold text-navy"> New Practice Set</h3>

          {/*  Row 1: Set Name  */}
          <div>
            <label> Set Name *</label>
            <input
              placeholder="Example: UKSSSC GS Mock Test 1, Hindi Practice Set A..."
              value={form.set_name}
              onChange={e => setForm({...form, set_name: e.target.value})}
            />
          </div>

          {/*  Row 2: Folder + Exam Type + Time  */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label> Add to Folder</label>
              <select value={form.folder_id} onChange={e => setForm({...form, folder_id: e.target.value})}>
                <option value=""> Uncategorized </option>
                {buildFolderOptions()}
              </select>
              {folders.length === 0 && (
                <p className="text-xs text-amber-600 mt-1 font-medium"> Create a folder first from the "Folders" tab</p>
              )}
            </div>
            <div>
              <label> Exam Type</label>
              <select value={form.exam_type} onChange={e => setForm({...form, exam_type: e.target.value})}>
                <option value="UKPSC">UKPSC</option>
                <option value="UKSSSC">UKSSSC</option>
                <option value="Common">Common (Both)</option>
              </select>
            </div>
            <div>
              <label> Time Limit (Minutes)</label>
              <input type="number" min="5" max="180" value={form.time_limit_minutes}
                onChange={e => setForm({...form, time_limit_minutes: e.target.value})} />
            </div>
          </div>

          {/*  Row 3: Paid toggle  */}
          <div className="flex items-center gap-3 p-3 rounded-xl bg-yellow-50 border border-yellow-200">
            <input type="checkbox" id="isPaid" checked={form.is_paid}
              onChange={e => setForm({...form, is_paid: e.target.checked})}
              className="w-4 h-4 accent-orange-500" />
            <label htmlFor="isPaid" className="font-bold text-sm text-yellow-800 cursor-pointer">
               PRO / Paid Set (free users will see it locked)
            </label>
          </div>

          {/*  Row 4: Question Bank  */}
          <div className="rounded-2xl border border-dashed border-orange-300 bg-orange-50 p-4 space-y-3">
            <div>
              <h4 className="font-black text-sm text-orange-700">Create a paper directly from CSV upload</h4>
              <p className="text-xs text-orange-700 mt-1">
                Uploading a CSV will save the questions to the question bank and link them to this set automatically.
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
              Create Set from CSV Upload
            </button>
          </div>

          <div className="bg-gray-50 rounded-2xl border border-gray-200 overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b bg-white">
              <div>
                <h4 className="font-black text-navy text-sm"> Choose from the Question Bank</h4>
                <p className="text-xs text-gray-400 mt-0.5">You can choose questions from multiple subjects to create a mixed paper.</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="bg-orange-500 text-white text-xs font-black px-3 py-1 rounded-full">
                  {selectedQ.length} selected
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
                placeholder=" Search questions..."
                value={qSearch}
                onChange={e => setQSearch(e.target.value)}
                className="text-sm"
                style={{padding:"8px 12px"}}
              />
            </div>

            {/* Select All / Clear for filtered */}
            <div className="flex justify-between items-center px-4 py-2 bg-gray-50 border-b text-xs">
              <span className="text-gray-500 font-medium">{filteredQ.length} questions shown</span>
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
                  }}> Remove Visible</button>
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
                      {isSelected && <span className="text-white text-[10px] font-black"></span>}
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
             {selectedQ.length > 0 ? `Save Set with ${selectedQ.length} Questions` : "Select questions first"}
          </button>
        </div>
      )}

      {/* Existing Sets List */}
      <div className="card">
        <div className="flex justify-between items-center mb-4">
          <h3 className="font-bold">Existing Practice Sets ({sets.length})</h3>
          {folders.length > 0 && <span className="text-xs text-gray-400"> Click the icon to assign a folder</span>}
        </div>
        {loading ? (
          <div className="space-y-2">{[1,2,3].map(i=><div key={i} className="h-14 bg-gray-100 rounded-lg animate-pulse"></div>)}</div>
        ) : sets.length === 0 ? (
          <p className="text-center text-gray-400 text-sm py-6">No sets yet. Create one above.</p>
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
                        <span className="text-[10px] bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full font-bold">
                          {s.question_count || s.question_ids?.length || 0} Questions
                        </span>
                        {folderObj
                          ? <span className="text-[10px] bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full font-bold"> {folderObj.name}</span>
                          : <span className="text-[10px] bg-gray-50 text-gray-400 px-2 py-0.5 rounded-full font-bold border border-dashed"> No Folder</span>
                        }
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${s.is_paid ? "bg-yellow-100 text-yellow-700" : "bg-green-100 text-green-700"}`}>
                          {s.is_paid ? "PAID" : "FREE"}
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="text-xs bg-red-100 text-red-600 px-3 py-1.5 rounded-lg font-bold hover:bg-red-200"
                      onClick={() => deleteSet(s)}
                    >
                      Delete
                    </button>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      className={`text-xs px-3 py-1.5 rounded-lg font-bold ${s.is_paid ? "bg-yellow-500 text-white" : "bg-gray-100 text-gray-600 hover:bg-yellow-100"}`}
                      onClick={() => updateSetAccess(s, true)}
                      disabled={Boolean(s.is_paid)}
                    >
                      Mark Paid
                    </button>
                    <button
                      type="button"
                      className={`text-xs px-3 py-1.5 rounded-lg font-bold ${!s.is_paid ? "bg-green-500 text-white" : "bg-gray-100 text-gray-600 hover:bg-green-100"}`}
                      onClick={() => updateSetAccess(s, false)}
                      disabled={!s.is_paid}
                    >
                      Mark Free
                    </button>
                    {s.folder_id && (
                      <button
                        type="button"
                        className="text-xs bg-gray-100 text-gray-600 px-3 py-1.5 rounded-lg font-bold hover:bg-gray-200"
                        onClick={() => removeSetFromFolder(s)}
                      >
                        Remove from Folder
                      </button>
                    )}
                  </div>

                  {/* Folder assign row */}
                  {folders.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-dashed border-gray-100 flex items-center gap-2">
                      <span className="text-xs text-gray-400 font-medium whitespace-nowrap"> Folder:</span>
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
                        <option value=""> No Folder (Uncategorized) </option>
                        {rootFolders.map(f => (
                          <optgroup key={f.id} label={" " + f.name}>
                            <option value={f.id}> {f.name}</option>
                            {getChildren(f.id).map(sf => (
                              <option key={sf.id} value={sf.id}>&nbsp;&nbsp; {sf.name}</option>
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
