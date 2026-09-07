import { useEffect, useRef, useState } from 'react';
import { AIFeedbackCard } from '../components/AIFeedbackCard.jsx';
import { BrandLockup } from '../components/BrandLockup.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useRouter } from '../context/RouterContext.jsx';
import { loadChartJs } from '../services/externalScripts.js';
import { supabase } from '../services/supabaseClient.js';
import { getLastItem, normalizeAttemptRecord, normalizeQuestionBreakdown, readStoredAttempts } from '../utils/attempts.js';

export function Dashboard() {
  const { navigate } = useRouter();
  const { user } = useAuth();
  const [feedback, setFeedback] = useState("");
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [dbAttempts, setDbAttempts] = useState([]);
  const [streak, setStreak] = useState(0);
  const [dailyDone, setDailyDone] = useState(false);
  const [purchasedCourses, setPurchasedCourses] = useState([]);
  const [coursesLoading, setCoursesLoading] = useState(true);
  const today = new Date().toDateString();
  const todayDate = new Date().toISOString().split("T")[0];
  const chartRef = useRef(null);

  useEffect(() => { loadAttempts(); }, [user?.email, user?.access_token]);
  useEffect(() => { loadStudentStats(); }, [user?.email, user?.access_token]);
  useEffect(() => { loadPurchasedCourses(); }, [user?.access_token]);

  const loadAttempts = async () => {
    if (!user?.email) return;
    try {
      const data = await supabase.getStudentAttempts(user?.email, user?.access_token, "asc");
      if (Array.isArray(data)) {
        setDbAttempts(data.map((attempt) => normalizeAttemptRecord(attempt)).filter(Boolean));
      }
    } catch(e) {}
  };

  const loadStudentStats = async () => {
    if (!user?.email) return;
    const data = await supabase.getStudentData(user.email, user?.access_token);
    if (data) {
      setStreak(data.streak || 0);
      setDailyDone(data.last_daily_date === todayDate);
    } else {
      setStreak(parseInt(localStorage.getItem("dronna_streak") || "0"));
      setDailyDone(localStorage.getItem("dronna_daily_date") === today);
    }
  };

  const loadPurchasedCourses = async () => {
    if (!user?.access_token) {
      setPurchasedCourses([]);
      setCoursesLoading(false);
      return;
    }

    setCoursesLoading(true);
    try {
      const [purchaseRes, folderRes] = await Promise.all([
        supabase.getCoursePurchases(user.access_token),
        supabase.getFolders()
      ]);
      const purchases = purchaseRes.data || [];
      const folders = folderRes.ok ? folderRes.data || [] : [];
      const folderById = new Map(folders.map((folder) => [folder.id, folder]));

      const getFolderPathNames = (folderId) => {
        const path = [];
        const seen = new Set();
        let current = folderById.get(folderId);
        while (current && !seen.has(current.id)) {
          path.unshift(current.name);
          seen.add(current.id);
          current = current.parent_id ? folderById.get(current.parent_id) : null;
        }
        return path;
      };

      const courses = purchases
        .map((purchase) => {
          const folder = folderById.get(purchase.folder_id);
          if (!folder) return null;
          return {
            id: folder.id,
            name: folder.name,
            path: getFolderPathNames(folder.id).join(" / "),
            status: purchase.status || "active"
          };
        })
        .filter(Boolean);

      setPurchasedCourses(Array.from(new Map(courses.map((course) => [course.id, course])).values()));
    } catch(e) {
      setPurchasedCourses([]);
    } finally {
      setCoursesLoading(false);
    }
  };

  useEffect(() => {
    let isActive = true;

    const renderPerformanceChart = async () => {
      const canvas = document.getElementById("performanceChart");
      if (dbAttempts.length === 0 || !canvas) return;

      const Chart = await loadChartJs();
      if (!isActive) return;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      if (chartRef.current) chartRef.current.destroy();

      const last7 = dbAttempts.slice(-7);
      const labels = last7.map((a, i) => "Test " + (i + 1));
      const scores = last7.map(a => Math.round((a.score / (a.total_questions || 1)) * 100));

      chartRef.current = new Chart(ctx, {
        type: "line",
        data: {
          labels: labels,
          datasets: [{ label: "Score %", data: scores, borderColor: "#F47B20", backgroundColor: "rgba(244,123,32,0.1)", borderWidth: 3, tension: 0.4, fill: true, pointBackgroundColor: "#F47B20", pointRadius: 5 }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          scales: { y: { beginAtZero: true, max: 100, grid: { display: false } }, x: { grid: { display: false } } },
          plugins: { legend: { display: false } }
        }
      });
    };

    renderPerformanceChart();

    return () => {
      isActive = false;
    };
  }, [dbAttempts]);

  const totalAttempts = dbAttempts.length;
  const avgScore = totalAttempts > 0 ? Math.round(dbAttempts.reduce((a,b) => a + ((b.score/(b.total_questions||1))*100), 0) / totalAttempts) : 0;
  const bestScore = totalAttempts > 0 ? Math.max(...dbAttempts.map(a => Math.round((a.score/(a.total_questions||1))*100))) : 0;
  let localFeedbackAttempts = [];
  try {
    localFeedbackAttempts = readStoredAttempts();
  } catch(e) {}
  const feedbackAttempts = localFeedbackAttempts.length > 0 ? localFeedbackAttempts : dbAttempts;
  const feedbackAttemptTotal = feedbackAttempts.length;
  const feedbackAvgScore = feedbackAttemptTotal > 0
    ? Math.round(feedbackAttempts.reduce((sum, attempt) => sum + Math.round((attempt.score / Math.max(attempt.total_questions || attempt.total || 1, 1)) * 100), 0) / feedbackAttemptTotal)
    : avgScore;
  const feedbackBestScore = feedbackAttemptTotal > 0
    ? Math.max(...feedbackAttempts.map(attempt => Math.round((attempt.score / Math.max(attempt.total_questions || attempt.total || 1, 1)) * 100)))
    : bestScore;
  const latestLocalAttempt = getLastItem(localFeedbackAttempts);
  const latestQuestionBreakdown = normalizeQuestionBreakdown(latestLocalAttempt?.question_breakdown);
  const hasPurchasedCourse = purchasedCourses.length > 0;
  const dashboardLatestContext = latestQuestionBreakdown.length > 0 ? {
    setName: latestLocalAttempt.setName || latestLocalAttempt.set_name || "Latest test",
    totalQuestions: latestLocalAttempt.total_questions || latestLocalAttempt.total || latestQuestionBreakdown.length,
    accuracy: latestLocalAttempt.accuracy_percent || 0,
    timeTakenSeconds: latestLocalAttempt.time || latestLocalAttempt.time_taken_seconds || 0,
    timeLimitSeconds: latestLocalAttempt.time_limit_seconds || 0,
    allQuestions: latestQuestionBreakdown,
    wrongQuestions: latestQuestionBreakdown.filter(q => q?.selected_answer && !q?.is_correct)
  } : null;

  if (!user) return <div className="p-8 text-center">Please login first</div>;

  const primaryCoursePath = hasPurchasedCourse ? `/practice?mine=1&folder=${purchasedCourses[0].id}` : "/practice?mine=1";
  const dashboardRibbonItems = [
    { label: "Course Store", path: "/practice", active: false },
    { label: "Dashboard", path: "/dashboard", active: true },
    { label: "My Course", path: primaryCoursePath, active: false },
    { label: "Daily", path: "/daily", active: false },
    { label: "Leaderboard", path: "/leaderboard", active: false },
    { label: "Syllabus", path: "/syllabus", active: false },
    { label: "Ebooks", path: "/ebooks", active: false },
    ...(user.isAdmin ? [{ label: "Admin", path: "/admin", active: false, admin: true }] : [])
  ];

  return (
    <div className="font-body min-h-screen" style={{background:"#FAFAFA"}}>      
      {/* TOP NAV */}
      <nav className="bg-white/80 backdrop-blur-xl border-b sticky top-0 z-50" style={{borderColor:"#E0E0E0"}}>
        <div className="flex flex-wrap justify-between items-center gap-3 w-full px-4 py-3 sm:px-6 max-w-screen-2xl mx-auto">
          <div className="flex flex-1 flex-wrap items-center gap-x-4 gap-y-2 min-w-0 lg:gap-x-8">
            <BrandLockup logoSize={34} textClassName="text-xl" onClick={() => navigate("/dashboard")} />
            <div className="hidden md:flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 whitespace-nowrap lg:gap-x-4 xl:gap-x-6">
              {dashboardRibbonItems.map((item) => (
                <span
                  key={item.label}
                  className="font-headline font-bold text-sm cursor-pointer border-b-2 px-2 pb-1 text-center transition-colors"
                  style={{
                    color: item.active || item.admin ? "var(--saffron-dark)" : "#616161",
                    borderColor: item.active ? "var(--saffron-dark)" : "transparent"
                  }}
                  onClick={() => navigate(item.path)}
                >
                  {item.label}
                </span>
              ))}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-3 sm:gap-4">
            <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold border-2 shadow-sm" style={{background:"var(--navy)", borderColor:"#E0E0E0"}}>
              {user.name?.[0]?.toUpperCase() || "U"}
            </div>
            <button className="text-sm font-bold px-4 py-2 rounded-full border hover:bg-gray-100 transition-all" style={{color:"var(--navy)", borderColor:"#E0E0E0"}} onClick={() => { localStorage.removeItem("dronna_user"); window.location.reload(); }}>Logout</button>
          </div>
        </div>
      </nav>

      <main className="w-full max-w-screen-2xl mx-auto px-4 pb-28 pt-5 sm:px-6 sm:py-8 grid grid-cols-1 lg:grid-cols-12 gap-5 sm:gap-8">
        {/* LEFT MAIN */}
        <div className="lg:col-span-8 space-y-8">

          {/* GREETING HEADER */}
          <header className="relative p-5 sm:p-10 rounded-2xl text-white overflow-hidden shadow-xl" style={{background:"var(--navy)"}}>
            <div className="absolute inset-0 pointer-events-none" style={{opacity:0.06, backgroundImage:"radial-gradient(rgba(255,255,255,0.8) 1px, transparent 1px)", backgroundSize:"20px 20px"}}></div>
            <div className="relative z-10 space-y-2">
              <h1 className="text-2xl sm:text-3xl md:text-5xl font-headline font-extrabold tracking-tight">
                Hello, <span style={{color:"#F47B20"}}>{user.name || "Aspirant"}</span>
              </h1>
              <p className="font-medium text-sm sm:text-lg md:text-xl max-w-xl" style={{color:"rgba(197,202,233,0.9)"}}>
                Target: <strong>{user.exam_target}</strong> | Plan: <span className="px-2 py-0.5 rounded-full text-xs font-black" style={{background:"rgba(244,123,32,0.2)", color:"#F47B20"}}>{user.subscription_plan?.toUpperCase() || "FREE"}</span>
              </p>
            </div>
          </header>

          <section>
            <div className="bg-white p-4 sm:p-6 rounded-2xl border shadow-sm" style={{borderColor:"#EEEEEE"}}>
              <div className="flex flex-col items-start justify-between gap-4 min-[420px]:flex-row">
                <div>
                  <p className="text-xs font-black uppercase tracking-widest" style={{color:"var(--saffron-dark)"}}>Purchased Course</p>
                  <h2 className="mt-2 text-2xl font-headline font-extrabold" style={{color:"var(--navy)"}}>
                    {coursesLoading
                      ? "Checking course access..."
                      : hasPurchasedCourse
                        ? purchasedCourses.length === 1 ? purchasedCourses[0].name : `${purchasedCourses.length} Courses Active`
                        : "No purchased course found"}
                  </h2>
                  <p className="mt-2 text-sm leading-relaxed" style={{color:"#616161"}}>
                    {hasPurchasedCourse
                      ? "Your paid course access is active for the course listed below."
                      : user.subscription_plan === "pro"
                        ? "Your profile shows Pro, but no active course purchase row was found."
                        : "Demo and free areas are open. After purchase, this dashboard becomes your main learning area."}
                  </p>
                  {hasPurchasedCourse && (
                    <div className="mt-4 space-y-2">
                      {purchasedCourses.map((course) => (
                        <div key={course.id} className="rounded-xl border border-orange-100 bg-orange-50 px-4 py-3">
                          <div className="text-sm font-black" style={{color:"var(--navy)"}}>{course.name}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <span className={`px-3 py-2 rounded-lg text-xs font-black text-white ${hasPurchasedCourse ? "bg-purple-600" : "bg-gray-500"}`}>
                  {hasPurchasedCourse ? "ACTIVE" : "BASIC"}
                </span>
              </div>
              <div className="mt-5 flex flex-col sm:flex-row gap-3">
                <button className="btn-primary justify-center" onClick={() => navigate(hasPurchasedCourse ? `/practice?mine=1&folder=${purchasedCourses[0].id}` : "/practice")}>
                  {hasPurchasedCourse ? "Open My Course" : "Buy Course"}
                </button>
                <button className="btn-outline justify-center" onClick={() => navigate("/syllabus")}>View Syllabus</button>
              </div>
            </div>
          </section>

          {/* STATS ROW */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              {label:"Total Tests", value: totalAttempts || 0, extra: totalAttempts > 0 ? "+"+totalAttempts : ""},
              {label:"Avg Score %", value: avgScore + "%", extra: ""},
              {label:"Best Score", value: bestScore + "%", extra: bestScore >= 90 ? "Top 5%" : ""},
              {label:"Day Streak", value: streak, extra: "Days"},
            ].map((s, i) => (
              <div key={i} className="bg-white p-4 sm:p-6 rounded-xl border shadow-sm hover:shadow-md transition-all subtle-aipan-border" style={{borderColor:"#EEEEEE"}}>
                <span className="text-xs font-extrabold uppercase tracking-widest block mb-2" style={{color:"#9E9E9E"}}>{s.label}</span>
                <div className="flex items-end gap-2">
                  <span className="text-2xl sm:text-3xl font-headline font-extrabold" style={{color:"var(--navy)"}}>{s.value}</span>
                  {s.extra && <span className="text-xs font-bold mb-1.5 px-2 py-0.5 rounded-full" style={{color:"var(--saffron-dark)", background:"rgba(230,81,0,0.1)"}}>{s.extra}</span>}
                </div>
              </div>
            ))}
          </div>

          {/* CHART + AI */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="md:col-span-2 bg-white p-4 sm:p-8 rounded-2xl border shadow-sm" style={{borderColor:"#EEEEEE"}}>
              <div className="flex justify-between items-center mb-6">
                <div>
                  <h2 className="font-headline font-bold text-xl" style={{color:"var(--navy)"}}>Performance Trend</h2>
                  <p className="text-xs mt-1" style={{color:"#9E9E9E"}}>Last 7 attempts</p>
                </div>
                <span className="text-xs font-extrabold tracking-widest uppercase" style={{color:"#9E9E9E"}}>Score %</span>
              </div>
              <div className="h-48 w-full">
                {totalAttempts > 0 ? (
                  <canvas id="performanceChart"></canvas>
                ) : (
                  <div className="h-full flex items-center justify-center border-2 border-dashed rounded-2xl" style={{borderColor:"#E0E0E0"}}>
                    <p className="text-sm font-hindi" style={{color:"#9E9E9E"}}>Complete your first test to view the graph</p>
                  </div>
                )}
              </div>
              {totalAttempts > 0 && (
                <div className="flex justify-between mt-4 px-1">
                  {dbAttempts.slice(-7).map((_, i) => (
                    <span key={i} className="text-xs font-extrabold" style={{color:"#9E9E9E"}}>T{i + 1}</span>
                  ))}
                </div>
              )}
            </div>

            {/* AI FEEDBACK */}
            <AIFeedbackCard
              attempts={feedbackAttempts}
              name={user?.name}
              examTarget={user?.exam_target}
              avgScore={feedbackAvgScore}
              bestScore={feedbackBestScore}
              totalAttempts={feedbackAttemptTotal}
              latestAttemptContext={dashboardLatestContext}
              isPro={hasPurchasedCourse}
              accessToken={user?.access_token}
              onUpgrade={() => navigate("/practice")}
              autoLoad={false}
              coachLanguage={user?.ai_coach_language}
            />
          </div>

          {/* DAILY CHALLENGE BANNER */}
          <div className="relative p-0.5 rounded-2xl" style={{background:"linear-gradient(135deg, #F47B20, var(--saffron-dark))"}}>
            <div className="bg-white px-4 py-5 sm:px-8 sm:py-8 rounded-2xl flex flex-col md:flex-row items-stretch sm:items-center justify-between gap-5 sm:gap-6">
              <div className="flex items-center gap-4 sm:gap-6">
                <div className="w-14 h-14 sm:w-16 sm:h-16 shrink-0 rounded-full flex items-center justify-center text-xs sm:text-sm font-black shadow-inner" style={{background:"#FFF3E0", color:"var(--saffron-dark)"}}>TODAY</div>
                <div>
                  <h3 className="text-xl sm:text-2xl font-headline font-extrabold" style={{color:"var(--navy)"}}>{dailyDone ? "Daily Challenge Done!" : "Daily Challenge"}</h3>
                  <p className="text-base mt-1" style={{color:"#616161"}}>
                    {dailyDone ? "Come back tomorrow for 5 new questions" : "Solve today's 5 questions and build your streak"}
                  </p>
                </div>
              </div>
              {!dailyDone && (
                <button className="w-full sm:w-auto px-8 sm:px-10 py-3 sm:py-4 rounded-full font-headline font-bold text-base sm:text-lg text-white shadow-2xl hover:-translate-y-1 transition-all" style={{background:"var(--navy)"}} onClick={() => navigate("/daily")}>
                  Start Now
                </button>
              )}
            </div>
          </div>
        </div>

        {/* RIGHT SIDEBAR */}
        <aside className="lg:col-span-4 space-y-8">
          {/* QUICK ACTIONS */}
          <div className="p-4 sm:p-8 rounded-2xl space-y-4 border" style={{background:"#F9F9F9", borderColor:"#EEEEEE"}}>
            <h3 className="font-headline font-extrabold text-lg flex items-center gap-2" style={{color:"var(--navy)"}}>
              Quick Actions
              <div className="h-1 flex-grow rounded-full" style={{background:"rgba(13,27,62,0.05)"}}></div>
            </h3>
            {[
              {icon:"school", label:"Course Store", path:"/practice"},
              {icon:"leaderboard", label:"Leaderboard", path:"/leaderboard"},
              {icon:"menu_book", label:"Syllabus Guide", path:"/syllabus"},
              {icon:"auto_stories", label:"Ebook Store", path:"/ebooks"},
            ].map(a => (
              <div key={a.path} className="flex items-center justify-between p-4 bg-white rounded-xl border hover:border-orange-400 hover:shadow-lg transition-all cursor-pointer group" style={{borderColor:"#EEEEEE"}} onClick={() => navigate(a.path)}>
                <div className="flex items-center gap-4">
                  <span className="material-symbols-outlined text-xl text-saffron-dark" style={{ fontVariationSettings: "'FILL' 1" }}>{a.icon}</span>
                  <span className="font-bold" style={{color:"var(--navy)"}}>{a.label}</span>
                </div>
                <span className="material-symbols-outlined text-gray-400 group-hover:text-orange-500 transition-colors">arrow_forward</span>
              </div>
            ))}
          </div>

          {/* RECENT ACTIVITY */}
          <div className="bg-white p-4 sm:p-8 rounded-2xl border shadow-sm" style={{borderColor:"#EEEEEE"}}>
            <h3 className="font-headline font-extrabold text-lg mb-6 flex items-center gap-2" style={{color:"var(--navy)"}}>
              Recent Activity
              <div className="h-1 flex-grow rounded-full" style={{background:"rgba(13,27,62,0.05)"}}></div>
            </h3>
            {totalAttempts === 0 ? (
              <div className="text-center py-6">
                <div className="text-3xl mb-2">Coach</div>
                <p className="text-sm font-hindi" style={{color:"#9E9E9E"}}>No activity yet</p>
                <button className="mt-3 px-4 py-2 rounded-full text-sm font-bold text-white" style={{background:"var(--navy)"}} onClick={() => navigate(hasPurchasedCourse ? `/practice?mine=1&folder=${purchasedCourses[0].id}` : "/practice")}>Open Course</button>
              </div>
            ) : (
              <div className="space-y-6 relative">
                <div className="absolute left-3 top-2 bottom-2 w-0.5" style={{background:"#EEEEEE"}}></div>
                {dbAttempts.slice(-3).reverse().map((a, i) => {
                  const pct = Math.round((a.score/(a.total_questions||1))*100);
                  return (
                    <div key={i} className="relative flex gap-5 pl-10">
                      <div className="absolute left-1.5 top-1.5 w-3 h-3 rounded-full ring-4 ring-white" style={{background: i === 0 ? "#F47B20" : "var(--navy)"}}></div>
                      <div className="space-y-1">
                        <p className="text-sm font-bold" style={{color:"var(--navy)"}}>{a.set_name || "Practice Test"}</p>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-extrabold uppercase tracking-widest" style={{color:"#9E9E9E"}}>{new Date(a.completed_at||a.date).toLocaleDateString("en-IN")}</span>
                          <div className="text-xs font-bold px-2 py-0.5 rounded-full" style={{background:"rgba(230,81,0,0.1)", color:"var(--saffron-dark)"}}>{pct}%</div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* MOTIVATIONAL CARD */}
          <div className="relative rounded-2xl overflow-hidden h-44 shadow-lg group">
            <img alt="Mountains" className="absolute inset-0 w-full h-full object-cover group-hover:scale-110 transition-transform duration-1000" src="https://lh3.googleusercontent.com/aida-public/AB6AXuDf-eOtoMMiONwUnsurYmk7ocLEt8S781v8XKg60gFImLvZBCkcZw8e3XL-STEng7QdiHBGrw_pnEkM_QNy6FZ3gT4kxqZ4Ed0_zL8ALt_kf1TaXE8aIltMC5XYdsUO-I7dmsw4GcY3tpD6A0Mht-T_4zV6cvVsOcst2NIEuXh1kenUBclGFJ14AaSBifdXHb1LlHhb7BcrF2CtxmU2rTodQZQNqXj2U1w1fodeDj0KaEI8gVVI-itlkZIhHw7ePPsxLYxP2JUvkg"/>
            <div className="absolute inset-0" style={{background:"linear-gradient(to top, rgba(13,27,62,0.95), rgba(13,27,62,0.4), transparent)"}}></div>
            <div className="absolute bottom-5 left-6 right-6">
              <p className="text-white font-headline font-bold text-sm leading-tight italic border-l-2 pl-4" style={{borderColor:"#F47B20"}}>
                "No mountain is higher than your effort."
              </p>
            </div>
          </div>
        </aside>
      </main>

      {/* MOBILE BOTTOM NAV */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-xl border-t z-50 grid grid-cols-5 items-center px-2 pb-[calc(0.6rem+env(safe-area-inset-bottom))] pt-2 shadow-[0_-14px_30px_rgba(13,27,62,0.08)]" style={{borderColor:"#E0E0E0"}}>
        {[
          {icon:"school", label:"Courses", path:"/practice"},
          {icon:"dashboard", label:"Home", path:"/dashboard"},
          {icon:"auto_stories", label:"Ebooks", path:"/ebooks"},
          {icon:"leaderboard", label:"Ranks", path:"/leaderboard"},
          {icon:"person", label:"Profile", path:"/profile"},
        ].map(m => (
          <button key={m.path} className="flex min-w-0 flex-col items-center gap-0.5 rounded-lg px-1 py-1.5" style={{color: m.path === "/dashboard" ? "var(--saffron-dark)" : "#9E9E9E"}} onClick={() => navigate(m.path)}>
            <span className="material-symbols-outlined text-[22px]" style={{ fontVariationSettings: m.path === "/dashboard" ? "'FILL' 1" : "'FILL' 0" }}>{m.icon}</span>
            <span className="max-w-full truncate text-[10px] font-extrabold uppercase tracking-normal">{m.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
