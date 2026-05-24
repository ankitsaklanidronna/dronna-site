import { useEffect, useState } from 'react';
import { Navbar } from '../components/Navbar.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useRouter } from '../context/RouterContext.jsx';
import { fetchPublicCourseCatalog } from '../services/supabaseClient.js';
import { DEMO_SETS } from '../utils/demoData.js';
import { isPublicDemoSet } from '../utils/folders.js';

export function DemoPage() {
  const { navigate } = useRouter();
  const { user } = useAuth();
  const [demoCatalog, setDemoCatalog] = useState({ sets: [], folders: [], loading: true, error: "" });

  useEffect(() => {
    let alive = true;
    fetchPublicCourseCatalog().then((catalog) => {
      if (!alive) return;
      setDemoCatalog({
        sets: Array.isArray(catalog.sets) ? catalog.sets.filter((set) => isPublicDemoSet(set, catalog.folders)) : [],
        folders: catalog.folders || [],
        loading: false,
        error: catalog.error || ""
      });
    });
    return () => { alive = false; };
  }, []);

  const visibleDemoSets = demoCatalog.sets.length > 0 ? demoCatalog.sets : DEMO_SETS;
  const firstDemoPath = visibleDemoSets[0]?.demo
    ? `/quiz/${visibleDemoSets[0].id}`
    : `/quiz/${visibleDemoSets[0]?.id || "demo-s1"}?demo=1`;

  return (
    <div className="min-h-screen bg-[#F6F8FB]">
      <Navbar />
      <section className="border-b bg-white" style={{borderColor:"#E8EEF5"}}>
        <div className="max-w-6xl mx-auto px-4 py-12 md:py-16 grid gap-10 lg:grid-cols-[1fr_0.85fr] lg:items-center">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border bg-orange-50 px-3 py-1.5 text-xs font-black uppercase tracking-wider text-orange-700" style={{borderColor:"#FED7AA"}}>
              Free practice preview
            </div>
            <h1 className="mt-5 text-4xl md:text-5xl font-headline font-black leading-tight" style={{color:"var(--navy)"}}>
              Try Dronna with a real mock-test flow first.
            </h1>
            <p className="mt-5 max-w-2xl text-lg font-semibold leading-relaxed" style={{color:"#526173"}}>
              Take a short practice test with timer, negative marking, answer review, and explanations. Create an account later when you want saved progress and full course access.
            </p>
            <div className="mt-7 flex flex-col sm:flex-row gap-3">
              <button className="btn-primary justify-center py-3" onClick={() => navigate(firstDemoPath)}>
                Start Demo Test
              </button>
              <button className="btn-outline justify-center py-3" onClick={() => navigate(user ? "/dashboard" : "/signup")}>
                {user ? "Open Dashboard" : "Create Account"}
              </button>
            </div>
          </div>

          <div className="rounded-lg border bg-white p-5 shadow-sm" style={{borderColor:"#E8EEF5"}}>
            <div className="flex items-center justify-between border-b pb-4" style={{borderColor:"#EEF2F7"}}>
              <div>
                <h2 className="text-xl font-black" style={{color:"var(--navy)"}}>Demo includes</h2>
                <p className="mt-1 text-sm font-bold" style={{color:"#64748B"}}>A quick look at the actual test experience.</p>
              </div>
              <span className="material-symbols-outlined text-orange-600" style={{ fontVariationSettings: "'FILL' 1" }}>verified</span>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-3 text-center">
              {[
                ["Timer", "Exam-like"],
                ["0.25", "Negative"],
                ["Review", "Answer key"],
                ["Local", "Score saved"],
              ].map(([value, label]) => (
                <div key={label} className="rounded-lg bg-slate-50 p-4">
                  <div className="text-2xl font-black" style={{color:"var(--saffron-dark)"}}>{value}</div>
                  <div className="mt-1 text-xs font-black uppercase tracking-wider" style={{color:"#64748B"}}>{label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-4 py-10 md:py-12">
        <div className="mb-6 flex flex-col md:flex-row md:items-end md:justify-between gap-3">
          <div>
            <p className="text-sm font-black uppercase" style={{color:"var(--saffron-dark)"}}>Free Demo Tests</p>
            <h2 className="mt-2 text-3xl font-black" style={{color:"var(--navy)"}}>Start with a free practice test</h2>
          </div>
          <p className="max-w-md text-sm font-semibold leading-relaxed" style={{color:"#64748B"}}>
            Choose a test and experience Dronna before creating an account.
          </p>
        </div>

        <div className="grid gap-5 md:grid-cols-2">
          {demoCatalog.loading && [1,2].map((item) => (
            <div key={item} className="rounded-lg border bg-white p-5 shadow-sm animate-pulse" style={{borderColor:"#E8EEF5"}}>
              <div className="h-5 w-28 rounded bg-slate-100"></div>
              <div className="mt-5 h-6 w-3/4 rounded bg-slate-100"></div>
              <div className="mt-4 h-4 w-1/2 rounded bg-slate-100"></div>
              <div className="mt-6 h-11 rounded bg-slate-100"></div>
            </div>
          ))}

          {!demoCatalog.loading && demoCatalog.error && (
            <div className="md:col-span-2 rounded-lg border bg-amber-50 p-4 text-sm font-bold text-amber-700" style={{borderColor:"#FDE68A"}}>
              Some demo tests are taking longer to load, so sample practice tests are shown for now.
            </div>
          )}

          {!demoCatalog.loading && visibleDemoSets.map((set) => {
            const demoPath = set.demo ? `/quiz/${set.id}` : `/quiz/${set.id}?demo=1`;
            return (
            <div key={set.id} className="rounded-lg border bg-white p-5 shadow-sm" style={{borderColor:"#E8EEF5"}}>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <span className="rounded-full bg-green-50 px-3 py-1 text-xs font-black uppercase tracking-wide text-green-700">Free Demo</span>
                  <h3 className="mt-4 text-xl font-black leading-7" style={{color:"var(--navy)"}}>{set.set_name}</h3>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold" style={{color:"#64748B"}}>
                    <span>{set.question_count} questions</span>
                    <span>{set.time_limit_minutes} mins</span>
                    <span>{set.exam_type}</span>
                    <span>{set.subject}</span>
                  </div>
                </div>
                <span className="material-symbols-outlined text-slate-300">quiz</span>
              </div>
              <button className="btn-navy mt-6 w-full justify-center py-3" onClick={() => navigate(demoPath)}>
                Start Without Login
              </button>
            </div>
          );
          })}
        </div>

        <div className="mt-8 rounded-lg border bg-white p-5 text-center" style={{borderColor:"#E8EEF5"}}>
          <h3 className="text-lg font-black" style={{color:"var(--navy)"}}>Want saved progress across devices?</h3>
          <p className="mt-2 text-sm font-semibold" style={{color:"#64748B"}}>Create an account after trying the demo to keep course access, full practice history, and dashboard analytics.</p>
          <button className="btn-primary mt-5 justify-center" onClick={() => navigate("/signup")}>Sign Up After Demo</button>
        </div>
      </section>
    </div>
  );
}
