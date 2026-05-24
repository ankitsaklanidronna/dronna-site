import { useEffect, useState } from 'react';
import { MathText } from '../components/MathText.jsx';
import { Navbar } from '../components/Navbar.jsx';
import { ShareBtn } from '../components/ShareBtn.jsx';
import { CONFIG } from '../config/appConfig.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useRouter } from '../context/RouterContext.jsx';
import { SB_HEADERS, supabase } from '../services/supabaseClient.js';
import { normalizeEmail } from '../utils/authStorage.js';

export function DailyChallenge() {
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
    const data = await supabase.getStudentData(user.email, user?.access_token);
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
        // Fallback  Supabase questions table se random 5 lo
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
          <p className="text-gray-400 text-sm">Today's questions are loading...</p>
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
        }, user?.access_token);
        // Save leaderboard to Supabase
        await supabase.saveLeaderboard({
          name: user.name || "Anonymous",
          email: normalizeEmail(user.email),
          score: score,
          total: questions.length,
          challenge_date: todayDate
        }, user?.access_token);
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
              <div className="text-5xl mb-3"></div>
              <h2 className="text-xl font-black mb-2" style={{color:"var(--navy)"}}>Today's challenge is complete!</h2>
              <p className="text-gray-500 text-sm">Come back tomorrow for 5 new questions.</p>
              <div className="mt-4 flex gap-3 justify-center flex-wrap">
                <button className="btn-primary" onClick={() => navigate("/leaderboard")}> Leaderboard</button>
                <ShareBtn
                  title="Dronna Daily Challenge"
                  text={" Dronna Daily Challenge  today's challenge is complete!\nWant to try it too?\n UKPSC & UKSSSC Free Practice"}
                  url={window.location.href.split("#")[0]}
                  label=" Share"
                  className="px-5 py-2 rounded-lg border-2 border-orange-300 text-orange-600 font-bold hover:bg-orange-50 text-sm"
                />
                <button className="btn-outline" onClick={() => navigate("/practice")}>Practice More</button>
              </div>
            </div>
          ) : (
            <div className="card text-center">
              <div className="text-5xl mb-3">{pct >= 80 ? "" : pct >= 60 ? "" : ""}</div>
              <h2 className="text-2xl font-black mb-2" style={{color:"var(--navy)"}}>
                {pct >= 80 ? "Excellent!" : pct >= 60 ? "Good effort!" : "Come back stronger tomorrow!"}
              </h2>
              <div className="text-5xl font-black my-3" style={{color: pct>=80?"var(--green)":pct>=60?"var(--saffron)":"var(--red)"}}>{pct}%</div>
              <div className="flex justify-center gap-6 text-sm text-gray-500 mb-4">
                <div><div className="text-2xl font-bold text-green-600">{score}</div><div>Correct</div></div>
                <div><div className="text-2xl font-bold text-red-500">{questions.length-score}</div><div>Wrong</div></div>
                <div><div className="text-2xl font-bold text-orange-500">{streak+1}</div><div> Streak</div></div>
              </div>
              <div className="space-y-2 text-left mb-4">
                {questions.map((ques,i) => {
                  const ans = finalAnswers[i];
                  const ok = ans?.selected === ques.correct_answer;
                  return (
                    <div key={i} className={`p-2 rounded text-xs border devanagari ${ok?"border-green-200 bg-green-50":"border-red-200 bg-red-50"}`}>
                      <MathText
                        as="div"
                        content={`${i+1}. ${ques.question_text}`}
                        className="font-medium mb-1"
                      />
                      <MathText
                        as="div"
                        content={ok ? " Correct" : ` Correct answer: ${ques.correct_answer}`}
                        className={ok ? "text-green-600" : "text-red-500"}
                      />
                    </div>
                  );
                })}
              </div>
              <div className="flex gap-3 justify-center flex-wrap">
                <button className="btn-primary" onClick={() => navigate("/leaderboard")}> Leaderboard</button>
                <ShareBtn
                  title="Dronna Daily Challenge"
                  text={` I scored ${pct}% in the Daily Challenge!\n${score}/${questions.length} correct | Streak: ${streak+1} days\n Dronna  UKPSC & UKSSSC Practice`}
                  url={window.location.href.split("#")[0]}
                  label=" Share"
                  className="px-5 py-2 rounded-lg border-2 border-orange-300 text-orange-600 font-bold hover:bg-orange-50 transition-all text-sm"
                />
                <button className="btn-outline" onClick={() => navigate("/practice")}>Practice More</button>
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
            <h1 className="text-xl font-black" style={{color:"var(--navy)"}}> Daily Challenge</h1>
            <p className="text-gray-500 text-sm">{new Date().toLocaleDateString("en-IN", {day:"numeric",month:"long"})}</p>
          </div>
          <div className="text-right">
            <div className="font-black text-orange-500"> {streak} Streak</div>
            <div className="text-xs text-gray-400">Question {current+1}/5</div>
          </div>
        </div>

        <div className="progress-bar mb-6">
          <div className="progress-fill" style={{width:`${((current+1)/5)*100}%`}}></div>
        </div>

        <div className="card mb-4">
          <div className="flex items-start gap-3 mb-4">
            <span className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold text-white" style={{background:"var(--saffron)"}}>{current+1}</span>
            <MathText
              as="div"
              content={q?.question_text}
              className="text-base font-semibold leading-relaxed devanagari"
            />
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
                    <MathText
                      as="div"
                      content={optTexts[opt]}
                      className="devanagari text-sm"
                    />
                  </div>
                </div>
              );
            })}
          </div>
          {answered && (
            <MathText
              as="div"
              content={selected===q.correct_answer ? " Exactly right!" : ` Correct answer: ${q.correct_answer}  ${optTexts[q.correct_answer]}`}
              className={`mt-3 p-3 rounded-lg text-sm devanagari ${selected===q.correct_answer?"bg-green-50 text-green-700 border border-green-200":"bg-red-50 text-red-700 border border-red-200"}`}
            />
          )}
        </div>

        {answered && (
          <button className="btn-primary w-full justify-center py-3" onClick={nextQ}>
            {current < questions.length-1 ? "Next Question " : "View Result "}
          </button>
        )}
      </div>
    </div>
  );
}
