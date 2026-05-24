import { useEffect, useState } from 'react';
import { AIFeedbackCard } from '../components/AIFeedbackCard.jsx';
import { MathText } from '../components/MathText.jsx';
import { Navbar } from '../components/Navbar.jsx';
import { ShareBtn } from '../components/ShareBtn.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { getRouteSearchParams, useRouter } from '../context/RouterContext.jsx';
import { isNumericalQuestion } from '../services/aiFeedback.js';
import { supabase } from '../services/supabaseClient.js';
import { normalizeAttemptRecord, readStoredAttempts, writeStoredAttempts } from '../utils/attempts.js';
import { normalizeEmail } from '../utils/authStorage.js';
import { getDemoQuestionsForSet, getDemoSet, isDemoSetId } from '../utils/demoData.js';
import { isPublicDemoSet } from '../utils/folders.js';

export function QuizPage({ setId }) {
  const { page, navigate } = useRouter();
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
  // Review mode  already attempted, just view answers
  const [reviewMode, setReviewMode] = useState(false);
  const [prevAttempt, setPrevAttempt] = useState(null);
  // Report Issue state
  const [reportModal, setReportModal] = useState(null); // { qid, qtext }
  const [reportType, setReportType] = useState("");
  const [reportNote, setReportNote] = useState("");
  const [reportSent, setReportSent] = useState(false);
  const [reportedQids, setReportedQids] = useState(new Set());
  const [saveIssue, setSaveIssue] = useState("");
  const [resultFilter, setResultFilter] = useState("all");

  const NEGATIVE_MARK = 0.25;
  const isPublicDemoMode = isDemoSetId(setId) || getRouteSearchParams(page).get("demo") === "1";

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
      student_email: normalizeEmail(user?.email) || "anonymous",
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
    const demoSet = getDemoSet(setId);
    if (demoSet) {
      setSet(demoSet);
      setTimeLeft((demoSet.time_limit_minutes || 20) * 60);
      setQuestions(getDemoQuestionsForSet(demoSet));

      const attempts = readStoredAttempts();
      const prev = attempts.filter(a => a.setId === setId);
      if (prev.length > 0) {
        setPrevAttempt(prev[prev.length - 1]);
      }

      setLoadingQ(false);
      return;
    }

    const { data } = await supabase.getAll("practice_sets");
    let foundSet = (data || []).find(s => s.id === setId);
    if (!foundSet) { setLoadingQ(false); return; }

    if (!user && isPublicDemoMode) {
      const foldersResult = await supabase.getFolders();
      const folders = foldersResult.ok ? foldersResult.data : [];
      if (!isPublicDemoSet(foundSet, folders)) {
        setLoadingQ(false);
        navigate("/login");
        return;
      }
    }
    
    setSet(foundSet);
    setTimeLeft((foundSet.time_limit_minutes || 20) * 60);

    let qs = [];
      const { data: sqResult } = await supabase.getSetQuestions(setId, user?.access_token);
    if (sqResult && sqResult.length > 0) {
      qs = sqResult;
    } else if (foundSet.question_ids) {
      const { data: allDbQ } = await supabase.getAll("questions", "select=*", { accessToken: user?.access_token });
      qs = foundSet.question_ids.map(qid => 
        (allDbQ||[]).find(q => q.id === qid)
      ).filter(Boolean);
    }
    setQuestions(qs);

    // Check if already attempted
    const attempts = readStoredAttempts();
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
    setSaveIssue("");
    setResultFilter("all");
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
    const attemptedCount = correct + wrong;
    const accuracyPercent = attemptedCount > 0 ? Math.round((correct / attemptedCount) * 100) : 0;

    const attempt = {
      setId, setName: set?.set_name,
      score: netScore, 
      correct, wrong,
      total: questions.length,
      total_questions: questions.length,
      time: (set?.time_limit_minutes * 60) - timeLeft,
      time_limit_seconds: (set?.time_limit_minutes || 0) * 60,
      accuracy_percent: accuracyPercent,
      date: new Date().toISOString()
    };

    // Save locally (with answers snapshot for review)
    const attemptWithAnswers = {
      ...attempt,
      answers: userAnswers,
      question_breakdown: questions.map(q => {
        const selectedAnswer = userAnswers[q.id] || null;
        return {
          question_id: q.id,
          question_text: q.question_text,
          subject: q.subject || "",
          topic: q.topic || "",
          selected_answer: selectedAnswer,
          correct_answer: q.correct_answer,
          is_correct: Boolean(selectedAnswer) && selectedAnswer === q.correct_answer,
          is_numerical: isNumericalQuestion(q)
        };
      })
    };
    const prev = readStoredAttempts();
    writeStoredAttempts([...prev, normalizeAttemptRecord(attemptWithAnswers)]);

    // Save to Supabase only for signed-in users. Demo attempts remain local.
    if (user?.access_token && !isPublicDemoMode) {
      try {
        const saveResult = await supabase.saveAttempt({
          set_id: setId,
          score: netScore,
          total_questions: questions.length,
          time_taken_seconds: attempt.time,
          student_email: normalizeEmail(user?.email),
          set_name: set?.set_name
        }, user?.access_token);
        if (saveResult?.error) {
          setSaveIssue(saveResult.error);
        }
      } catch(e) { console.error(e); }
    }
  };

  if (loadingQ) return <div className="p-20 text-center devanagari">Loading test...</div>;

  //  Shared result/review renderer 
  const renderResultPage = (answersMap, isReview) => {
    const getQuestionStatus = (question) => {
      const ans = answersMap[question.id];
      if (!ans) return "skipped";
      return ans === question.correct_answer ? "correct" : "wrong";
    };
    let correct = 0; let wrong = 0; let skipped = 0;
    questions.forEach(q => {
      const status = getQuestionStatus(q);
      if (status === "correct") correct++;
      else if (status === "wrong") wrong++;
      else skipped++;
    });
    const netScore = (correct - (wrong * NEGATIVE_MARK)).toFixed(2);
    const attempted = correct + wrong;
    const accuracy = attempted > 0 ? Math.round((correct / attempted) * 100) : 0;
    const pct = Math.round((parseFloat(netScore) / Math.max(questions.length,1)) * 100);
    const grade = pct >= 80 ? {label:"Excellent! ", color:"#16a34a"} : pct >= 60 ? {label:"Good ", color:"#2563eb"} : pct >= 40 ? {label:"Average ", color:"#d97706"} : {label:"Needs Work ", color:"#dc2626"};
    const optionLabels = { A:"option_a", B:"option_b", C:"option_c", D:"option_d" };
    const feedbackAttempts = readStoredAttempts();
    const feedbackTotal = feedbackAttempts.length;
    const feedbackAvg = feedbackTotal > 0
      ? Math.round(feedbackAttempts.reduce((sum, attempt) => sum + Math.round((attempt.score / Math.max(attempt.total_questions || attempt.total || 1, 1)) * 100), 0) / feedbackTotal)
      : pct;
    const feedbackBest = feedbackTotal > 0
      ? Math.max(...feedbackAttempts.map(attempt => Math.round((attempt.score / Math.max(attempt.total_questions || attempt.total || 1, 1)) * 100)))
      : pct;
    const latestAttemptContext = {
      setName: set?.set_name,
      totalQuestions: questions.length,
      accuracy,
      timeTakenSeconds: isReview
        ? Number(prevAttempt?.time || prevAttempt?.time_taken_seconds || 0)
        : Math.max(((set?.time_limit_minutes || 0) * 60) - timeLeft, 0),
      timeLimitSeconds: (set?.time_limit_minutes || 0) * 60,
      allQuestions: questions.map(q => ({
        question_id: q.id,
        question_text: q.question_text,
        subject: q.subject || "",
        topic: q.topic || "",
        selected_answer: answersMap[q.id] || null,
        correct_answer: q.correct_answer,
        is_correct: Boolean(answersMap[q.id]) && answersMap[q.id] === q.correct_answer,
        is_numerical: isNumericalQuestion(q)
      })),
      wrongQuestions: questions
        .filter(q => {
          const selectedAnswer = answersMap[q.id];
          return Boolean(selectedAnswer) && selectedAnswer !== q.correct_answer;
        })
        .map(q => ({
          question_id: q.id,
          question_text: q.question_text,
          subject: q.subject || "",
          topic: q.topic || "",
          selected_answer: answersMap[q.id] || null,
          correct_answer: q.correct_answer,
          is_numerical: isNumericalQuestion(q)
        }))
    };
    const filterMeta = {
      all: { label: "All", count: questions.length, tone: "var(--navy)", bg: "#EEF2FF" },
      wrong: { label: "Wrong", count: wrong, tone: "#DC2626", bg: "#FEF2F2" },
      correct: { label: "Correct", count: correct, tone: "#16A34A", bg: "#F0FDF4" },
      skipped: { label: "Skipped", count: skipped, tone: "#6B7280", bg: "#F9FAFB" }
    };
    const filteredQuestions = questions.filter((question) => {
      if (resultFilter === "all") return true;
      return getQuestionStatus(question) === resultFilter;
    });

    return (
      <div className="min-h-screen pb-20" style={{background:"#F5F5F5"}}>
        <Navbar />
        <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
          {saveIssue && (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
              Attempt was completed, but cloud sync failed: {saveIssue}
            </div>
          )}

          {/* Score Card */}
          <div className="rounded-3xl overflow-hidden shadow-xl">
            <div className="p-8 text-white text-center" style={{background:"linear-gradient(135deg, var(--navy), #1a3a6e)"}}>
              {isReview && (
                <div className="inline-flex items-center gap-2 bg-white/10 px-4 py-1.5 rounded-full text-sm font-bold mb-4">
                   Review Mode  Previous Attempt
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
            <button className="btn-primary flex-1 justify-center py-3" onClick={() => navigate(isPublicDemoMode ? "/demo" : "/practice")}> Back to Practice</button>
            <ShareBtn
              title={`${set?.set_name}  Result`}
              text={` Dronna Practice  ${set?.set_name}\nScore: ${(correct - (wrong * NEGATIVE_MARK)).toFixed(2)}/${questions.length} | Accuracy: ${accuracy}%\n UKPSC & UKSSSC Exam Preparation`}
              url={window.location.href}
              label=" Share Result"
              className="flex-1 justify-center py-3 btn-outline"
            />
            {isReview && (
              <button className="btn-navy flex-1 justify-center py-3" onClick={() => { setPrevAttempt(null); setReviewMode(false); }}>
                 Retake Test
              </button>
            )}
          </div>

          <AIFeedbackCard
            attempts={feedbackAttempts}
            name={user?.name || "Demo Student"}
            examTarget={user?.exam_target || set?.exam_type || "UKPSC"}
            avgScore={feedbackAvg}
            bestScore={feedbackBest}
            totalAttempts={feedbackTotal}
            compact={true}
            latestAttemptContext={latestAttemptContext}
            isPro={isPublicDemoMode || user?.subscription_plan === "pro"}
            accessToken={user?.access_token}
            onUpgrade={() => navigate("/practice")}
            autoLoad={!isReview}
            coachLanguage={user?.ai_coach_language}
            />

          {/* Answer Key with Explanations */}
          <div>
            <h2 className="text-xl font-black mb-4" style={{color:"var(--navy)"}}>Answer Key & Explanation</h2>
            <div className="flex flex-wrap gap-2 mb-4">
              {Object.entries(filterMeta).map(([key, meta]) => {
                const active = resultFilter === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setResultFilter(key)}
                    className="px-4 py-2 rounded-full text-sm font-black border transition-all"
                    style={{
                      color: active ? "white" : meta.tone,
                      background: active ? meta.tone : meta.bg,
                      borderColor: active ? meta.tone : "transparent"
                    }}
                  >
                    {meta.label} ({meta.count})
                  </button>
                );
              })}
            </div>
            {filteredQuestions.length === 0 ? (
              <div className="rounded-2xl border border-dashed p-8 text-center" style={{borderColor:"#D1D5DB", background:"#FFFFFF"}}>
                <div className="text-3xl mb-2">Nothing Here</div>
                <p className="text-sm font-semibold" style={{color:"#4B5563"}}>
                  No {filterMeta[resultFilter].label.toLowerCase()} questions in this attempt.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {filteredQuestions.map((q) => {
                  const originalIndex = questions.findIndex(item => item.id === q.id);
                  const studentAns = answersMap[q.id];
                  const isCorrect = studentAns === q.correct_answer;
                  const isWrong = studentAns && !isCorrect;
                  const sc = isCorrect
                    ? {border:"#16a34a", bg:"#f0fdf4", badge:"Correct", badgeBg:"#dcfce7", badgeColor:"#16a34a"}
                    : isWrong
                    ? {border:"#dc2626", bg:"#fef2f2", badge:"Wrong", badgeBg:"#fee2e2", badgeColor:"#dc2626"}
                    : {border:"#9ca3af", bg:"#f9fafb", badge:"Skipped", badgeBg:"#f3f4f6", badgeColor:"#6b7280"};
                  return (
                    <div key={q.id} className="rounded-2xl overflow-hidden shadow-sm border-l-4" style={{borderColor:sc.border, background:sc.bg}}>
                      <div className="p-5">
                        <div className="flex items-start justify-between gap-3 mb-4">
                          <div className="flex items-start gap-3 flex-1">
                            <span className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-black flex-shrink-0 text-white mt-0.5" style={{background:"var(--navy)"}}>{originalIndex + 1}</span>
                            <MathText
                              as="div"
                              content={q.question_text}
                              className="font-semibold devanagari text-gray-800 leading-relaxed"
                            />
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <span className="text-xs font-black px-2 py-1 rounded-full" style={{background:sc.badgeBg, color:sc.badgeColor}}>{sc.badge}</span>
                            <button onClick={() => openReport(q)}
                              className={`text-xs px-2 py-1 rounded-full font-bold border transition-all ${reportedQids.has(q.id) ? "bg-green-50 text-green-600 border-green-200" : "bg-white text-red-400 border-red-200 hover:bg-red-50"}`}>
                              {reportedQids.has(q.id) ? "Done" : "Report"}
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
                                <MathText
                                  as="div"
                                  content={q[optionLabels[opt]]}
                                  className="devanagari flex-1"
                                />
                                {isCorr && <span className="text-green-600 font-black">OK</span>}
                                {isStu && !isCorr && <span className="text-red-500 font-black">Wrong</span>}
                              </div>
                            );
                          })}
                        </div>
                        {/* Explanation */}
                        <div className="rounded-xl p-4 border" style={{background:"rgba(13,27,62,0.04)", borderColor:"rgba(13,27,62,0.1)"}}>
                          <div className="flex items-center gap-2 mb-2">
                            <span>Tip</span>
                            <span className="text-xs font-black uppercase tracking-wider" style={{color:"var(--navy)"}}>Explanation</span>
                          </div>
                          <MathText
                            as="div"
                            content={
                              q.explanation
                                ? q.explanation
                                : `Correct answer: ${q.correct_answer}  ${q[optionLabels[q.correct_answer]]}${q.topic ? ` | Topic: ${q.topic}` : ""}`
                            }
                            className="text-sm devanagari leading-relaxed text-gray-700"
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  if (finished) return renderResultPage(userAnswers, false);
  if (reviewMode && prevAttempt) return renderResultPage(prevAttempt.answers || {}, true);

  // If previously attempted  show choice screen
  if (prevAttempt && !reviewMode) {
    const prevPct = Math.round(((prevAttempt.score||0) / Math.max(prevAttempt.total||questions.length,1)) * 100);
    return (
      <div className="min-h-screen flex items-center justify-center p-4" style={{background:"var(--cream)"}}>
        <div className="max-w-md w-full space-y-4 fade-in">
          <div className="card text-center">
            <div className="text-5xl mb-4"></div>
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
                <div className="text-2xl font-black text-green-600">{prevAttempt.correct || ""}</div>
                <div className="text-xs text-gray-400 font-bold uppercase">Correct</div>
              </div>
            </div>
            <div className="space-y-3">
              <button className="btn-primary w-full justify-center py-3" onClick={() => setReviewMode(true)}>
                 View Answers & Explanations
              </button>
              <button className="btn-outline w-full justify-center py-3" onClick={() => setPrevAttempt(null)}>
                 Retake Test
              </button>
              <button className="w-full py-2 text-sm text-gray-400 hover:text-gray-600" onClick={() => navigate(isPublicDemoMode ? "/demo" : "/practice")}>
                 Back to Practice
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }
  const q = questions[current];
  if (!q) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4" style={{background:"var(--cream)"}}>
        <div className="card max-w-md text-center">
          <h2 className="text-xl font-black text-navy mb-2">Demo test is not available</h2>
          <p className="text-sm text-gray-500 mb-5">Questions could not be loaded for this set.</p>
          <button className="btn-primary justify-center" onClick={() => navigate(isPublicDemoMode ? "/demo" : "/practice")}>Go Back</button>
        </div>
      </div>
    );
  }
  const mins = Math.floor(timeLeft / 60);
  const secs = timeLeft % 60;

  return (
    <div className="page bg-gray-50 min-h-screen">
      <div className="bg-navy text-white p-4 sticky top-0 z-50 flex justify-between items-center shadow-lg" style={{background: 'var(--navy)'}}>
        <div className="flex items-center gap-4">
          <button onClick={() => confirm("Do you want to leave this test?") && navigate(isPublicDemoMode ? "/demo" : "/practice")} className="text-white/70 hover:text-white"></button>
          <span className="font-bold hidden md:inline">{set?.set_name}</span>
        </div>
        <div className="text-xl font-mono font-bold bg-white/10 px-4 py-1 rounded-lg">
           {mins}:{secs < 10 ? '0'+secs : secs}
        </div>
        <button className="bg-green-600 hover:bg-green-700 px-4 py-1 rounded font-bold text-sm" onClick={() => confirm("Do you want to submit this test?") && finishQuiz()}>SUBMIT</button>
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
                  {reportedQids.has(q.id) ? " Reported" : " Issue?"}
                </button>
              </div>
            </div>
            
            <MathText
              as="h2"
              content={q.question_text}
              className="text-xl font-bold mb-8 devanagari leading-relaxed text-navy"
            />

            <div className="space-y-3">
              {['A','B','C','D'].map(opt => {
                const optText = q[`option_${opt.toLowerCase()}`];
                const isSelected = userAnswers[q.id] === opt;
                return (
                  <div key={opt} 
                    onClick={() => selectOption(opt)}
                    className={`option-card flex items-center gap-4 transition-all ${isSelected ? 'selected ring-2 ring-orange-500 border-orange-500' : ''}`}>
                    <span className={`w-8 h-8 rounded-full flex items-center justify-center font-bold border-2 ${isSelected ? 'bg-orange-500 text-white border-orange-500' : 'text-gray-400 border-gray-200'}`}>{opt}</span>
                    <MathText
                      as="div"
                      content={optText}
                      className="devanagari flex-1"
                    />
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex justify-between items-center bg-white p-4 rounded-xl shadow-sm">
            <button className="btn-outline px-6 py-2" disabled={current === 0} onClick={() => setCurrent(current-1)}> Back</button>
            <button className={`px-6 py-2 rounded-lg font-bold border-2 transition-all ${markedForReview.has(q.id) ? 'bg-purple-600 border-purple-600 text-white' : 'border-purple-600 text-purple-600 hover:bg-purple-50'}`} 
              onClick={toggleReview}>
              {markedForReview.has(q.id) ? 'Maked for Review ' : 'Mark for Review'}
            </button>
            <button className="btn-navy px-8 py-2" onClick={() => current < questions.length - 1 ? setCurrent(current+1) : null}>Next </button>
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
                **Note:** Negative marking (0.25) is active. Chose options carefully. Submitting will end the test immediately.
             </p>
          </div>
        </div>
      </div>
      {/*  Report Issue Modal  */}
      {reportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{background:"rgba(0,0,0,0.6)"}}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 fade-in">
            {reportSent ? (
              <div className="text-center py-6">
                <div className="text-5xl mb-3"></div>
                <p className="font-black text-green-600 text-lg">Report sent successfully!</p>
                <p className="text-sm text-gray-500 mt-1">The admin team will review it soon.</p>
              </div>
            ) : (
              <>
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h3 className="font-black text-navy text-lg"> Report an Issue</h3>
                    <p className="text-xs text-gray-400 mt-1 devanagari line-clamp-2">{reportModal.qtext}</p>
                  </div>
                  <button className="text-gray-400 hover:text-gray-600 text-2xl font-bold leading-none ml-3" onClick={() => setReportModal(null)}></button>
                </div>

                <div className="space-y-3">
                  <div>
                    <label className="text-sm font-bold text-navy block mb-2">Choose issue type *</label>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { val:"wrong_answer", label:" Wrong Answer", desc:"The correct answer is wrong" },
                        { val:"wrong_question", label:" Wrong Question", desc:"There is a typo or error in the question" },
                        { val:"wrong_option", label:" Wrong Option", desc:"There is a mistake in the options" },
                        { val:"other", label:" Other", desc:"Something else" },
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
                     Report Bhejo
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
