import { useEffect, useMemo, useState } from 'react';
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
  const [questionsLoading, setQuestionsLoading] = useState(false);
  const [questionsLoaded, setQuestionsLoaded] = useState(false);
  const [questionBankOpen, setQuestionBankOpen] = useState(false);
  const [qSubjectFilter, setQSubjectFilter] = useState("All");
  const [qSearch, setQSearch] = useState("");
  const [csvFiles, setCsvFiles] = useState([]);
  const [csvMsg, setCsvMsg] = useState("");
  const [setSearch, setSetSearch] = useState("");
  const [examFilter, setExamFilter] = useState("All");
  const [accessFilter, setAccessFilter] = useState("All");
  const [folderFilter, setFolderFilter] = useState("All");
  const [sortMode, setSortMode] = useState("name");
  const [page, setPage] = useState(1);
  const pageSize = 15;

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setLoading(true);
    const [setsRes, fRes, countRes] = await Promise.all([
      supabase.getAll("practice_sets", "select=id,set_name,subject,exam_type,time_limit_minutes,is_paid,folder_id&order=set_name.asc"),
      supabase.getFolders(),
      supabase.getSetQuestionCounts({ accessToken: user?.access_token })
    ]);
    const countMap = countRes?.data || {};
    setSets((setsRes.data || []).map((set) => ({
      ...set,
      question_count: countMap[set.id] ?? set.question_ids?.length ?? 0
    })));
    setFolders(fRes.ok ? fRes.data : []);
    setLoading(false);
  };

  const loadQuestionBank = async () => {
    if (questionsLoaded || questionsLoading) return;
    setQuestionsLoading(true);
    const qRes = await supabase.getAll("questions", "select=*", { accessToken: user?.access_token });
    setAllQ(qRes.data || []);
    setQuestionsLoaded(true);
    setQuestionsLoading(false);
  };

  // Unique subjects from questions
  const allSubjects = useMemo(() => ["All", ...new Set((allQ).map(q => q.subject || "Uncategorized"))], [allQ]);

  // Questions filtered by subject tab + search
  const filteredQ = useMemo(() => allQ.filter(q => {
    const subOk = qSubjectFilter === "All" || q.subject === qSubjectFilter;
    const searchOk = !qSearch || q.question_text?.toLowerCase().includes(qSearch.toLowerCase());
    return subOk && searchOk;
  }), [allQ, qSearch, qSubjectFilter]);

  const questionById = useMemo(() => new Map(allQ.map(q => [q.id, q])), [allQ]);

  // Selected questions breakdown by subject
  const selectedBreakdown = useMemo(() => selectedQ.reduce((acc, qid) => {
    const q = questionById.get(qid);
    const sub = q?.subject || "?";
    acc[sub] = (acc[sub] || 0) + 1;
    return acc;
  }, {}), [questionById, selectedQ]);

  const csvQuestions = csvFiles.flatMap(file => file.questions);
  const csvBreakdown = useMemo(() => csvQuestions.reduce((acc, q) => {
    const sub = q.subject || "Mixed";
    acc[sub] = (acc[sub] || 0) + 1;
    return acc;
  }, {}), [csvQuestions]);

  // Folder tree helpers
  const rootFolders = folders.filter(f => !f.parent_id);
  const getChildren = (pid) => folders.filter(f => f.parent_id === pid);
  const folderById = useMemo(() => new Map(folders.map(f => [f.id, f])), [folders]);
  const examOptions = useMemo(() => ["All", ...new Set(sets.map(s => s.exam_type || "UKPSC"))], [sets]);
  const folderOptions = useMemo(() => [
    { id: "All", name: "All folders" },
    { id: "none", name: "No folder" },
    ...folders.map(f => ({ id: f.id, name: f.name }))
  ], [folders]);

  const filteredSets = useMemo(() => {
    const query = setSearch.trim().toLowerCase();
    const list = sets.filter(set => {
      const folder = folderById.get(set.folder_id);
      const text = `${set.set_name || ""} ${set.subject || ""} ${set.exam_type || ""} ${folder?.name || ""}`.toLowerCase();
      const searchOk = !query || text.includes(query);
      const examOk = examFilter === "All" || (set.exam_type || "UKPSC") === examFilter;
      const accessOk = accessFilter === "All" || (accessFilter === "Paid" ? set.is_paid : !set.is_paid);
      const folderOk = folderFilter === "All" || (folderFilter === "none" ? !set.folder_id : set.folder_id === folderFilter);
      return searchOk && examOk && accessOk && folderOk;
    });

    return [...list].sort((a, b) => {
      if (sortMode === "questions_desc") return (b.question_count || 0) - (a.question_count || 0);
      if (sortMode === "questions_asc") return (a.question_count || 0) - (b.question_count || 0);
      if (sortMode === "folder") {
        const aFolder = folderById.get(a.folder_id)?.name || "zz";
        const bFolder = folderById.get(b.folder_id)?.name || "zz";
        return aFolder.localeCompare(bFolder) || (a.set_name || "").localeCompare(b.set_name || "");
      }
      return (a.set_name || "").localeCompare(b.set_name || "");
    });
  }, [accessFilter, examFilter, folderById, folderFilter, setSearch, sets, sortMode]);

  const totalPages = Math.max(1, Math.ceil(filteredSets.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const visibleSets = filteredSets.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const paidCount = sets.filter(s => s.is_paid).length;
  const uncategorizedCount = sets.filter(s => !s.folder_id).length;

  useEffect(() => { setPage(1); }, [setSearch, examFilter, accessFilter, folderFilter, sortMode]);

  const resetForm = () => {
    setForm({ set_name:"", exam_type:"UKPSC", time_limit_minutes:30, is_paid:false, folder_id:"", subject:"Mixed" });
    setSelectedQ([]);
    setCsvFiles([]);
    setCsvMsg("");
    setQuestionBankOpen(false);
  };

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
      resetForm();
      setCreating(false);
      loadData();
    } catch(e) { setMsg(" Error: " + e.message); }
  };

  const handleCsvUpload = async (event) => {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;

    setCsvMsg(`WAIT: Reading ${files.length} CSV file${files.length > 1 ? "s" : ""}...`);

    try {
      const existingKeys = new Set(csvFiles.map(file => file.key));
      const parsedFiles = [];

      for (const file of files) {
        const key = `${file.name}-${file.size}-${file.lastModified}`;
        if (existingKeys.has(key)) continue;

        const text = await file.text();
        const result = parseQuestionsCsv(text, form.exam_type);
        if (!result.ok) {
          setCsvMsg(`ERR: ${file.name}: ${result.error}`);
          return;
        }

        parsedFiles.push({
          key,
          name: file.name,
          questions: result.questions,
          subjects: result.questions.reduce((acc, q) => {
            const sub = q.subject || "Mixed";
            acc[sub] = (acc[sub] || 0) + 1;
            return acc;
          }, {})
        });
      }

      if (parsedFiles.length === 0) {
        setCsvMsg("ERR: Selected CSV file is already added.");
        return;
      }

      const nextCsvFiles = [...csvFiles, ...parsedFiles];
      const totalQuestions = nextCsvFiles.reduce((sum, file) => sum + file.questions.length, 0);
      setCsvFiles(nextCsvFiles);
      setCsvMsg(`OK: ${nextCsvFiles.length} CSV file${nextCsvFiles.length > 1 ? "s" : ""} ready with ${totalQuestions} total questions.`);
    } catch (e) {
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
      resetForm();
      setQuestionsLoaded(false);
      setAllQ([]);
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

  const renderFolderOptions = () => {
    const roots = folders.filter(f => !f.parent_id);
    return roots.map(f => (
      <optgroup key={f.id} label={" " + f.name}>
        <option value={f.id}> {f.name}</option>
        {folders.filter(child => child.parent_id === f.id).map(sf => (
          <option key={sf.id} value={sf.id}>&nbsp;&nbsp; {sf.name}</option>
        ))}
      </optgroup>
    ));
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
    <div className="max-w-screen-xl space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-xs font-black uppercase text-saffron-dark">Admin Library</p>
          <h2 className="mt-1 text-2xl font-black text-navy">Practice Sets Manager</h2>
          <p className="mt-1 text-sm text-gray-500">Fast list management for course tests, folders, and access status.</p>
        </div>
        <button className="btn-primary justify-center text-sm" onClick={() => { setCreating(!creating); setMsg(""); }}>
          {creating ? "Close" : "+ Create New Set"}
        </button>
      </div>

      {msg && (
        <div className={`p-3 rounded-lg text-sm ${msg.startsWith("ERR:") || msg.startsWith(" Error") ? "bg-red-50 text-red-700 border border-red-200" : "bg-green-50 text-green-700 border border-green-200"}`}>
          {msg}
        </div>
      )}

      {creating && (
        <div className="card fade-in space-y-6 border border-orange-100 shadow-sm">
          <div className="flex flex-col gap-1">
            <h3 className="font-black text-navy">New Practice Set</h3>
            <p className="text-sm text-gray-500">CSV upload stays fastest. Open the question bank only when you need manual selection.</p>
          </div>

          {/*  Row 1: Set Name  */}
          <div>
            <label>Set Name *</label>
            <input
              placeholder="Example: UKSSSC GS Mock Test 1, Hindi Practice Set A..."
              value={form.set_name}
              onChange={e => setForm({...form, set_name: e.target.value})}
            />
          </div>

          {/*  Row 2: Folder + Exam Type + Time  */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label>Add to Folder</label>
              <select value={form.folder_id} onChange={e => setForm({...form, folder_id: e.target.value})}>
                <option value="">Uncategorized</option>
                {buildFolderOptions()}
              </select>
              {folders.length === 0 && (
                <p className="text-xs text-amber-600 mt-1 font-medium"> Create a folder first from the "Folders" tab</p>
              )}
            </div>
            <div>
              <label>Exam Type</label>
              <select value={form.exam_type} onChange={e => setForm({...form, exam_type: e.target.value})}>
                <option value="UKPSC">UKPSC</option>
                <option value="UKSSSC">UKSSSC</option>
                <option value="Common">Common (Both)</option>
              </select>
            </div>
            <div>
              <label>Time Limit (Minutes)</label>
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
              <h4 className="font-black text-sm text-orange-700">Create a paper from multiple CSV uploads</h4>
              <p className="text-xs text-orange-700 mt-1">
                Upload 2-3 topic CSVs together, or add them one by one. All questions will be saved and linked to this set.
              </p>
            </div>
            <div className="text-xs bg-white border border-orange-200 rounded-xl p-3 overflow-x-auto">
              <strong>Required headers:</strong> question_text, option_a, option_b, option_c, option_d, correct_answer
              <br />
              <strong>Optional:</strong> subject, topic, difficulty, exam_type, explanation
            </div>
            <div className="flex flex-col md:flex-row md:items-center gap-3">
              <input type="file" accept=".csv,text/csv" multiple onChange={handleCsvUpload} className="bg-white" />
              {csvQuestions.length > 0 && (
                <button
                  type="button"
                  className="text-xs bg-white border border-orange-200 text-orange-700 px-3 py-2 rounded-lg font-bold hover:bg-orange-100"
                  onClick={() => { setCsvFiles([]); setCsvMsg(""); }}
                >
                  Clear CSVs
                </button>
              )}
            </div>
            {csvFiles.length > 0 && (
              <div className="space-y-2">
                {csvFiles.map(file => (
                  <div key={file.key} className="flex items-start justify-between gap-3 rounded-xl bg-white border border-orange-200 p-3">
                    <div className="min-w-0">
                      <p className="text-xs font-black text-orange-800 truncate">{file.name}</p>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        <span className="text-[10px] bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full font-bold">
                          {file.questions.length} questions
                        </span>
                        {Object.entries(file.subjects).map(([subject, count]) => (
                          <span key={subject} className="text-[10px] bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full font-bold">
                            {subject}: {count}
                          </span>
                        ))}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="text-xs bg-red-50 text-red-600 px-2.5 py-1 rounded-lg font-bold hover:bg-red-100"
                      onClick={() => setCsvFiles(prev => prev.filter(item => item.key !== file.key))}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
            {csvQuestions.length > 0 && (
              <div className="flex flex-wrap gap-2 rounded-xl bg-white border border-orange-200 p-3">
                <span className="text-xs font-black text-orange-800">
                  Total: {csvQuestions.length} questions from {csvFiles.length} CSV file{csvFiles.length > 1 ? "s" : ""}
                </span>
                {Object.entries(csvBreakdown).map(([subject, count]) => (
                  <span key={subject} className="text-[10px] bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full font-bold">
                    {subject}: {count}
                  </span>
                ))}
              </div>
            )}
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
              {csvQuestions.length > 0 ? `Create Set from ${csvQuestions.length} CSV Questions` : "Create Set from CSV Uploads"}
            </button>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-gray-50 overflow-hidden">
            <div className="flex flex-col gap-3 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h4 className="font-black text-navy text-sm">Choose from Question Bank</h4>
                <p className="text-xs text-gray-400 mt-0.5">Manual selection is lazy-loaded to keep this admin tab quick.</p>
              </div>
              <button
                type="button"
                className="rounded-lg border border-navy px-4 py-2 text-sm font-black text-navy hover:bg-slate-50"
                onClick={() => {
                  const nextOpen = !questionBankOpen;
                  setQuestionBankOpen(nextOpen);
                  if (nextOpen) loadQuestionBank();
                }}
              >
                {questionBankOpen ? "Hide Question Bank" : questionsLoaded ? "Open Question Bank" : "Load Question Bank"}
              </button>
            </div>

            {questionBankOpen && (
              <>
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
              {questionsLoading ? (
                <div className="space-y-2">{[1,2,3,4].map(i => <div key={i} className="h-16 rounded-xl bg-white animate-pulse"></div>)}</div>
              ) : filteredQ.length === 0 ? (
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
              </>
            )}
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
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-xl border border-line bg-white p-4 shadow-sm">
          <p className="text-xs font-black uppercase text-gray-400">Total Sets</p>
          <p className="mt-1 text-2xl font-black text-navy">{sets.length}</p>
        </div>
        <div className="rounded-xl border border-line bg-white p-4 shadow-sm">
          <p className="text-xs font-black uppercase text-gray-400">Paid</p>
          <p className="mt-1 text-2xl font-black text-saffron-dark">{paidCount}</p>
        </div>
        <div className="rounded-xl border border-line bg-white p-4 shadow-sm">
          <p className="text-xs font-black uppercase text-gray-400">Free</p>
          <p className="mt-1 text-2xl font-black text-green-600">{sets.length - paidCount}</p>
        </div>
        <div className="rounded-xl border border-line bg-white p-4 shadow-sm">
          <p className="text-xs font-black uppercase text-gray-400">No Folder</p>
          <p className="mt-1 text-2xl font-black text-gray-700">{uncategorizedCount}</p>
        </div>
      </div>

      {/* Existing Sets List */}
      <div className="card border border-line shadow-sm">
        <div className="mb-5 flex flex-col gap-4">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h3 className="font-black text-navy">Existing Practice Sets</h3>
              <p className="text-sm text-gray-500">{filteredSets.length} shown from {sets.length} total</p>
            </div>
            <button className="w-fit rounded-lg border border-gray-200 px-3 py-2 text-xs font-bold text-gray-600 hover:bg-gray-50" onClick={loadData}>
              Refresh
            </button>
          </div>
          <div className="grid gap-3 lg:grid-cols-[1.4fr_0.8fr_0.8fr_0.9fr_0.9fr]">
            <input
              placeholder="Search by set, subject, exam, folder..."
              value={setSearch}
              onChange={e => setSetSearch(e.target.value)}
              className="text-sm"
            />
            <select value={examFilter} onChange={e => setExamFilter(e.target.value)} className="text-sm">
              {examOptions.map(option => <option key={option} value={option}>{option === "All" ? "All exams" : option}</option>)}
            </select>
            <select value={accessFilter} onChange={e => setAccessFilter(e.target.value)} className="text-sm">
              <option value="All">All access</option>
              <option value="Paid">Paid only</option>
              <option value="Free">Free only</option>
            </select>
            <select value={folderFilter} onChange={e => setFolderFilter(e.target.value)} className="text-sm">
              {folderOptions.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}
            </select>
            <select value={sortMode} onChange={e => setSortMode(e.target.value)} className="text-sm">
              <option value="name">Sort: Name</option>
              <option value="folder">Sort: Folder</option>
              <option value="questions_desc">Most questions</option>
              <option value="questions_asc">Fewest questions</option>
            </select>
          </div>
        </div>
        {loading ? (
          <div className="space-y-2">{[1,2,3,4,5].map(i=><div key={i} className="h-16 bg-gray-100 rounded-lg animate-pulse"></div>)}</div>
        ) : sets.length === 0 ? (
          <p className="text-center text-gray-400 text-sm py-6">No sets yet. Create one above.</p>
        ) : filteredSets.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 py-10 text-center">
            <p className="font-bold text-gray-500">No practice set matches these filters.</p>
            <button className="mt-3 text-sm font-black text-saffron-dark" onClick={() => { setSetSearch(""); setExamFilter("All"); setAccessFilter("All"); setFolderFilter("All"); }}>
              Clear filters
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {visibleSets.map(s => {
              const folderObj = folders.find(f => f.id === s.folder_id);
              return (
                <div key={s.id} className="rounded-xl border border-gray-100 bg-white p-4 transition hover:border-orange-200">
                  <div className="grid gap-3 lg:grid-cols-[1.2fr_0.8fr_0.9fr_auto] lg:items-center">
                    <div className="min-w-0">
                      <p className="truncate font-black text-sm text-navy" title={s.set_name}>{s.set_name}</p>
                      <div className="mt-1.5 flex flex-wrap gap-2">
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
                    <div className="min-w-0">
                      <p className="mb-1 text-[10px] font-black uppercase text-gray-400">Folder</p>
                      <select
                        className="w-full rounded-lg border border-gray-200 bg-gray-50 px-2 py-2 text-xs font-medium"
                        value={s.folder_id || ""}
                        onChange={async (e) => {
                          const newFId = e.target.value || null;
                          const result = await supabase.adminWrite("move_set_to_folder", { set_id: s.id, folder_id: newFId }, user?.access_token);
                          if (result.error) { setMsg("ERR: " + result.error); return; }
                          loadData();
                        }}
                      >
                        <option value="">No Folder</option>
                        {renderFolderOptions()}
                      </select>
                    </div>
                    <div>
                      <p className="mb-1 text-[10px] font-black uppercase text-gray-400">Access</p>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          className={`flex-1 rounded-lg px-3 py-2 text-xs font-bold ${s.is_paid ? "bg-yellow-500 text-white" : "bg-gray-100 text-gray-600 hover:bg-yellow-100"}`}
                          onClick={() => updateSetAccess(s, true)}
                          disabled={Boolean(s.is_paid)}
                        >
                          Paid
                        </button>
                        <button
                          type="button"
                          className={`flex-1 rounded-lg px-3 py-2 text-xs font-bold ${!s.is_paid ? "bg-green-500 text-white" : "bg-gray-100 text-gray-600 hover:bg-green-100"}`}
                          onClick={() => updateSetAccess(s, false)}
                          disabled={!s.is_paid}
                        >
                          Free
                        </button>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 lg:justify-end">
                      {s.folder_id && (
                        <button
                          type="button"
                          className="rounded-lg bg-gray-100 px-3 py-2 text-xs font-bold text-gray-600 hover:bg-gray-200"
                          onClick={() => removeSetFromFolder(s)}
                        >
                          Unfolder
                        </button>
                      )}
                      <button
                        type="button"
                        className="rounded-lg bg-red-50 px-3 py-2 text-xs font-bold text-red-600 hover:bg-red-100"
                        onClick={() => deleteSet(s)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
            {totalPages > 1 && (
              <div className="flex flex-col gap-3 pt-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs font-bold text-gray-400">
                  Page {currentPage} of {totalPages} · Showing {(currentPage - 1) * pageSize + 1}-{Math.min(currentPage * pageSize, filteredSets.length)} of {filteredSets.length}
                </p>
                <div className="flex gap-2">
                  <button className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-bold disabled:opacity-40" disabled={currentPage === 1} onClick={() => setPage(prev => Math.max(1, prev - 1))}>Previous</button>
                  <button className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-bold disabled:opacity-40" disabled={currentPage === totalPages} onClick={() => setPage(prev => Math.min(totalPages, prev + 1))}>Next</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
