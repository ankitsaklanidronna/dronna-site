import { useEffect, useState } from 'react';
import { BrandLockup } from '../components/BrandLockup.jsx';
import { ShareBtn } from '../components/ShareBtn.jsx';
import { CONFIG } from '../config/appConfig.js';
import { useRouter } from '../context/RouterContext.jsx';
import { getPublicLandingStats } from '../services/supabaseClient.js';
import { openLegalPage } from '../utils/navigation.js';
import { APP_SHARE_TITLE, buildPromoShareText, getShareUrl } from '../utils/share.js';

export function LandingPage() {
  const { navigate } = useRouter();
  const [publicStats, setPublicStats] = useState({
    questions: null,
    practiceSets: null,
    setQuestions: null,
    leaderboardEntries: null,
    practiceSetPreview: [],
    countError: "",
    loaded: false
  });

  useEffect(() => {
    let alive = true;
    getPublicLandingStats().then((stats) => {
      if (!alive) return;
      setPublicStats({ ...stats, loaded: true });
    });
    return () => { alive = false; };
  }, []);

  const statValue = (value) => {
    if (!publicStats.loaded) return "...";
    return Number.isFinite(value) ? value.toLocaleString("en-IN") : "--";
  };
  const formatCount = (value) => Number.isFinite(value) ? value.toLocaleString("en-IN") : "--";
  const getSetQuestionCount = (set) => {
    if (set?.question_count_unavailable) return null;
    const count = Number(set?.question_count);
    return Number.isFinite(count) ? count : null;
  };

  const courseModules = [
    { title: "Foundation Planner", detail: "UKPSC/UKSSSC syllabus mapping, daily study flow, and priority topics.", toneClassName: "bg-blue-600" },
    { title: "Practice Library", detail: "Topic-wise mock sets, timed tests, explanations, and score tracking.", toneClassName: "bg-teal" },
    { title: "Revision Sprint", detail: "Short revision loops for weak areas, daily challenge, and leaderboard.", toneClassName: "bg-saffron-dark" },
    { title: "AI Performance Analyzer", detail: "Available with every course for weakness diagnosis and next steps after attempts.", toneClassName: "bg-purple" },
  ];

  const courseOutcomes = [
    "Clear path for UKPSC and UKSSSC preparation",
    "Practice dashboard with progress and score history",
    "Course access after purchase",
    "AI Performance Analyzer included with every course",
  ];

  const demoLessons = [
    { label: "Demo 01", title: "Uttarakhand GK quick practice", meta: "Free preview" },
    { label: "Demo 02", title: "Timed mock test experience", meta: "Dashboard preview" },
    { label: "Demo 03", title: "Weak area analysis", meta: "Included AI sample" },
  ];

  const pricingPlans = [
    {
      name: "Basic Course",
      price: "Free start",
      caption: "For demo access, daily challenge, and limited practice.",
      features: ["Free account", "Daily challenge", "Syllabus access", "Leaderboard"],
      cta: "Start Free",
      path: "/signup",
      featured: false
    },
    {
      name: "Course Access",
      price: `Rs ${CONFIG.RAZORPAY_PLAN_AMOUNT_INR}`,
      caption: "Full course access with included AI support.",
      features: ["Practice sets", "Student dashboard", "Progress tracking", "AI Performance Analyzer included"],
      cta: "Buy Course",
      path: "/practice",
      featured: true
    }
  ];

  return (
    <div className="font-body bg-white text-ink-deep">
      <nav className="fixed top-0 z-50 w-full border-b border-b-line bg-white/95 backdrop-blur">
        <div className="max-w-7xl mx-auto px-4 lg:px-6 py-3 flex items-center justify-between gap-4">
          <BrandLockup logoSize={36} textClassName="text-2xl" onClick={() => navigate("/")} />
          <div className="hidden lg:flex items-center gap-7 text-sm font-extrabold text-steel">
            <a className="hover:text-orange-600" href="#course-demo">Course Demo</a>
            <a className="hover:text-orange-600" href="#curriculum">Curriculum</a>
            <a className="hover:text-orange-600" href="#pricing">Pricing</a>
            <button className="hover:text-orange-600" onClick={() => navigate("/syllabus")}>Syllabus</button>
            <button className="hover:text-orange-600" onClick={() => openLegalPage("/contact.html")}>Contact</button>
          </div>
          <div className="flex items-center gap-2">
            <button className="hidden sm:inline-flex px-4 py-2 rounded-lg font-bold text-navy hover:bg-slate-100" onClick={() => navigate("/login")}>Login</button>
            <button className="px-4 sm:px-5 py-2 rounded-lg bg-saffron-dark font-black text-white shadow-sm" onClick={() => navigate("/practice")}>Buy Course</button>
          </div>
        </div>
      </nav>

      <section className="relative min-h-[88vh] pt-20 flex items-center overflow-hidden bg-navy-hero">
        <img
          alt="Students preparing for competitive exams"
          className="absolute inset-0 h-full w-full object-cover"
          src="https://images.unsplash.com/photo-1522202176988-66273c2fd55f?auto=format&fit=crop&w=1800&q=80"
        />
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(7,27,47,0.94)_0%,rgba(7,27,47,0.82)_48%,rgba(7,27,47,0.38)_100%)]"></div>

        <div className="relative z-10 max-w-7xl mx-auto px-4 lg:px-6 py-16 grid lg:grid-cols-[1.05fr_0.95fr] gap-10 items-center w-full">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-lg border border-white/25 bg-white/[0.08] px-3 py-2 text-xs font-black uppercase tracking-wide text-white/90">
              <span className="text-saffron">DRONNA</span>
              Paid course for UKPSC & UKSSSC aspirants
            </div>
            <h1 className="font-headline mt-6 text-4xl sm:text-5xl lg:text-6xl font-black leading-tight text-white">
              Dronna UKPSC & UKSSSC Course
            </h1>
            <p className="mt-5 text-lg sm:text-xl leading-relaxed max-w-2xl text-slate-200/90">
              Start with the demo, choose your course, and then access lessons, practice sets, progress, and the included AI Performance Analyzer from your student dashboard.
            </p>
            <div className="mt-8 flex flex-col sm:flex-row gap-3">
              <button className="btn-primary justify-center py-4 text-base font-black" onClick={() => navigate("/signup")}>
                Watch Demo
              </button>
              <button className="justify-center rounded-lg border border-white/30 px-6 py-4 text-base font-black text-white transition hover:bg-white/10 inline-flex items-center gap-2" onClick={() => navigate("/practice")}>
                Buy Course
              </button>
              <ShareBtn
                title={APP_SHARE_TITLE}
                text={buildPromoShareText(["Explore Dronna courses for UKPSC and UKSSSC."])}
                url={getShareUrl("/")}
                label="Share"
                className="justify-center rounded-lg border px-5 py-4 text-white hover:bg-white/10 border-white/25"
              />
            </div>
            <div className="mt-8 grid grid-cols-3 max-w-xl divide-x rounded-lg border border-line bg-white/95 text-center">
              {[
                [statValue(publicStats.questions), "Questions"],
                [statValue(publicStats.practiceSets), "Practice Sets"],
                [statValue(publicStats.leaderboardEntries), "Leaderboard"],
              ].map(([num, label]) => (
                <div key={label} className="p-4">
                <div className="text-2xl font-black text-navy">{num}</div>
                <div className="text-xs font-bold uppercase text-muted">{label}</div>
              </div>
            ))}
            </div>
            {publicStats.loaded && publicStats.countError && (
              <div className="mt-4 max-w-xl rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800">
                Live counts are temporarily unavailable. Some course stats may show -- until the connection recovers.
              </div>
            )}
          </div>

          <div className="bg-white rounded-lg shadow-2xl p-4 lg:p-5">
            <div className="flex items-center justify-between gap-3 border-b border-b-line-soft pb-4">
              <div>
                <div className="text-xs font-black uppercase text-saffron-dark">Course Dashboard</div>
                <h2 className="text-xl font-black mt-1 text-navy">Student learning area</h2>
              </div>
              <span className="rounded-lg bg-purple px-3 py-2 text-sm font-black text-white">PRO</span>
            </div>
            <div className="mt-5 space-y-4">
              {[
                ["Course progress", "Dashboard", "text-teal", "bg-teal"],
                ["Mock performance", "Score history", "text-saffron-dark", "bg-saffron-dark"],
                ["AI analyzer", "Included", "text-purple", "bg-purple"],
              ].map(([label, value, textClassName, bgClassName]) => (
                <div key={label}>
                  <div className="flex justify-between text-sm font-bold mb-2">
                    <span>{label}</span><span className={textClassName}>{value}</span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                    <div className={`h-full w-[62%] rounded-full ${bgClassName}`}></div>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-6 grid grid-cols-2 gap-3">
              {["Course demo", "Course sets", "Profile stats", "AI analyzer"].map((item) => (
                <div key={item} className="rounded-lg border border-line bg-slate-50 p-3 text-sm font-bold">
                  <span className="font-black mr-1 text-saffron-dark">+</span>
                  {item}
                </div>
              ))}
            </div>
            <button className="mt-5 w-full rounded-lg bg-navy py-3 font-black text-white" onClick={() => navigate("/practice")}>Select Course Plan</button>
          </div>
        </div>
      </section>

      <section id="course-demo" className="max-w-7xl mx-auto px-4 lg:px-6 py-14">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-8">
          <div>
            <p className="text-sm font-black uppercase text-saffron-dark">Course Demo</p>
            <h2 className="text-3xl md:text-4xl font-black mt-2 text-navy">Preview the learning experience before buying</h2>
          </div>
          <button className="btn-outline w-fit" onClick={() => navigate("/signup")}>Open Free Demo</button>
        </div>
        <div className="grid lg:grid-cols-[1.15fr_0.85fr] gap-6 items-stretch">
          <div className="relative min-h-[360px] overflow-hidden rounded-lg border border-line bg-navy">
            <img
              alt="Online course demo"
              className="absolute inset-0 h-full w-full object-cover opacity-70"
              src="https://images.unsplash.com/photo-1434030216411-0b793f4b4173?auto=format&fit=crop&w=1600&q=80"
            />
            <div className="absolute inset-0 bg-gradient-to-r from-navy/95 to-navy/40"></div>
            <div className="relative z-10 flex h-full min-h-[360px] flex-col justify-end p-6 md:p-8 text-white">
              <div className="mb-5 inline-flex h-14 w-14 items-center justify-center rounded-lg bg-white text-2xl font-black text-saffron-dark">Play</div>
              <h3 className="text-3xl font-black">Demo course walkthrough</h3>
              <p className="mt-3 max-w-xl text-white/80">A complete student journey from landing page to purchase, then from dashboard to practice and AI analysis.</p>
            </div>
          </div>
          <div className="grid gap-3">
            {demoLessons.map((lesson) => (
              <button key={lesson.label} className="rounded-lg border border-line bg-white p-5 text-left transition hover:-translate-y-1 hover:shadow-lg" onClick={() => navigate("/signup")}>
                <div className="text-xs font-black uppercase text-saffron-dark">{lesson.label}</div>
                <h3 className="mt-2 text-lg font-black text-navy">{lesson.title}</h3>
                <p className="mt-2 text-sm font-bold text-muted">{lesson.meta}</p>
              </button>
            ))}
          </div>
        </div>
      </section>

      <section id="curriculum" className="bg-app-muted py-14">
        <div className="max-w-7xl mx-auto px-4 lg:px-6">
          <div className="mb-8">
            <p className="text-sm font-black uppercase text-saffron-dark">Curriculum</p>
            <h2 className="text-3xl md:text-4xl font-black mt-2 text-navy">Everything students need after purchase</h2>
          </div>
          <div className="grid md:grid-cols-4 gap-4">
            {courseModules.map((module) => (
              <button key={module.title} className="rounded-lg border border-line bg-white p-5 text-left transition hover:shadow-lg" onClick={() => navigate(module.title === "AI Performance Analyzer" ? "/practice" : "/signup")}>
                <span className={`rounded-lg px-3 py-2 text-xs font-black text-white ${module.toneClassName}`}>{module.title.slice(0, 2).toUpperCase()}</span>
                <h3 className="mt-4 text-lg font-black text-navy">{module.title}</h3>
                <p className="mt-2 text-sm font-bold leading-relaxed text-muted">{module.detail}</p>
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-4 lg:px-6 py-14">
        <div className="grid lg:grid-cols-[0.85fr_1.15fr] gap-8 items-center">
          <div>
            <p className="text-sm font-black uppercase text-saffron-dark">Course Outcomes</p>
            <h2 className="text-3xl md:text-4xl font-black mt-2 text-navy">Guest sees demo. Paid student gets dashboard.</h2>
            <p className="mt-4 text-lg leading-relaxed text-steel">This landing page is for course discovery and conversion. The actual learning area lives inside the dashboard after login, where students can access their courses, practice sets, progress, and the included AI Performance Analyzer.</p>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            {courseOutcomes.map((outcome, index) => (
              <div key={outcome} className="rounded-lg border border-line bg-white p-6">
                <div className={`text-3xl font-black ${index === 3 ? "text-purple" : "text-navy"}`}>{String(index + 1).padStart(2, "0")}</div>
                <div className="text-sm font-bold mt-3 text-steel">{outcome}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="pricing" className="bg-app-muted py-14">
        <div className="max-w-7xl mx-auto px-4 lg:px-6">
          <div className="mb-8 text-center">
            <p className="text-sm font-black uppercase text-saffron-dark">Pricing</p>
            <h2 className="text-3xl md:text-4xl font-black mt-2 text-navy">Choose your course access</h2>
          </div>
          <div className="grid md:grid-cols-2 gap-5 max-w-5xl mx-auto">
            {pricingPlans.map((plan) => (
              <div key={plan.name} className={`rounded-lg border bg-white p-6 shadow-sm ${plan.featured ? "border-saffron-dark ring-2 ring-orange-500" : "border-line"}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-2xl font-black text-navy">{plan.name}</h3>
                    <p className="mt-2 text-sm font-bold text-muted">{plan.caption}</p>
                  </div>
                  {plan.featured && <span className="rounded-lg bg-purple px-3 py-2 text-xs font-black text-white">AI included</span>}
                </div>
                <div className={`mt-6 text-4xl font-black ${plan.featured ? "text-saffron-dark" : "text-navy"}`}>{plan.price}</div>
                <div className="mt-6 space-y-3">
                  {plan.features.map((feature) => (
                    <div key={feature} className="text-sm font-bold text-steel">
                      <span className="font-black mr-2 text-teal">+</span>{feature}
                    </div>
                  ))}
                </div>
                <button className={`${plan.featured ? "btn-primary" : "btn-outline"} mt-7 w-full justify-center py-3`} onClick={() => navigate(plan.path)}>
                  {plan.cta}
                </button>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-4 lg:px-6 py-14">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-8">
          <div>
            <p className="text-sm font-black uppercase text-saffron-dark">Practice Sets</p>
            <h2 className="text-3xl md:text-4xl font-black mt-2 text-navy">
              Course practice preview ({statValue(publicStats.practiceSets)})
            </h2>
          </div>
          <button className="btn-primary w-fit" onClick={() => navigate("/practice")}>Buy / Open Course</button>
        </div>
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-5">
          {!publicStats.loaded && [1,2,3,4].map((item) => (
            <div key={item} className="rounded-lg border border-line bg-white p-5 shadow-sm">
              <div className="h-5 w-20 rounded bg-slate-100 animate-pulse"></div>
              <div className="h-6 w-full rounded bg-slate-100 animate-pulse mt-5"></div>
              <div className="h-4 w-2/3 rounded bg-slate-100 animate-pulse mt-4"></div>
              <div className="h-10 w-full rounded bg-slate-100 animate-pulse mt-5"></div>
            </div>
          ))}
          {publicStats.loaded && publicStats.practiceSetPreview.length === 0 && (
            <div className="md:col-span-2 lg:col-span-4 rounded-lg border border-line bg-white p-6 text-center font-bold text-muted">
              Practice sets could not be loaded. Please refresh once.
            </div>
          )}
          {publicStats.practiceSetPreview.map((set) => {
            const meta = set.is_paid ? "Paid" : "Free";
            const details = [
              set.subject || "Mixed",
              set.exam_type || "Practice",
              `${formatCount(getSetQuestionCount(set))} questions`,
              set.time_limit_minutes ? `${set.time_limit_minutes} minute timer` : ""
            ].filter(Boolean);

            return (
              <div key={set.id || set.set_name} className="rounded-lg border border-line bg-white p-5 shadow-sm">
                <div className="flex items-start gap-3">
                  <span className="rounded-lg bg-navy px-3 py-2 text-xs font-black text-white">PS</span>
                  <div>
                    <div className="text-xs font-black uppercase text-muted">{meta}</div>
                    <h3 className="font-black text-lg mt-1 text-navy">{set.set_name || "Practice Set"}</h3>
                  </div>
                </div>
                <div className="mt-4 space-y-2">
                  {details.map((tag) => (
                    <div key={tag} className="text-sm font-bold text-steel">
                      <span className="font-black mr-1 text-teal">+</span>
                      {tag}
                    </div>
                  ))}
                </div>
                <button className="mt-5 w-full rounded-lg border border-navy py-3 font-black text-navy hover:bg-slate-50" onClick={() => navigate("/practice")}>{set.is_paid ? "Buy to Unlock" : "Open Demo"}</button>
              </div>
            );
          })}
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-4 lg:px-6 py-14">
        <div className="rounded-lg bg-navy p-6 md:p-8 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
          <div>
            <p className="font-black uppercase text-sm text-saffron">Ready to learn</p>
            <h2 className="text-3xl font-black text-white mt-2">Purchase the course and continue inside your dashboard</h2>
            <p className="mt-3 text-white/75">Basic users can explore demo areas. Course students get practice sets, dashboard progress, and AI Performance Analyzer access together.</p>
          </div>
          <div className="flex flex-col sm:flex-row gap-3">
            <button className="btn-primary justify-center py-3" onClick={() => navigate("/practice")}>Buy Course</button>
            <button className="rounded-lg bg-white px-5 py-3 font-black text-navy" onClick={() => navigate("/login")}>Login</button>
          </div>
        </div>
        <div className="mt-6 text-center text-sm font-medium leading-7 text-steel">
          Paid features and future Razorpay payments are governed by our{" "}
          <button type="button" className="font-bold text-saffron-dark hover:underline bg-transparent border-0 p-0 align-baseline" onClick={() => openLegalPage("/terms.html")}>Terms & Conditions</button>,
          {" "}
          <button type="button" className="font-bold text-saffron-dark hover:underline bg-transparent border-0 p-0 align-baseline" onClick={() => openLegalPage("/privacy-policy.html")}>Privacy Policy</button>
          {", "}
          <button type="button" className="font-bold text-saffron-dark hover:underline bg-transparent border-0 p-0 align-baseline" onClick={() => openLegalPage("/refund-policy.html")}>Refund Policy</button>
          {", "}
          <button type="button" className="font-bold text-saffron-dark hover:underline bg-transparent border-0 p-0 align-baseline" onClick={() => openLegalPage("/shipping-policy.html")}>Delivery Policy</button>
          {", and "}
          <button type="button" className="font-bold text-saffron-dark hover:underline bg-transparent border-0 p-0 align-baseline" onClick={() => openLegalPage("/contact.html")}>Contact Support</button>
          .
        </div>
      </section>

      <footer className="border-t border-t-line bg-white">
        <div className="max-w-7xl mx-auto px-4 lg:px-6 py-10 grid md:grid-cols-[1.4fr_0.8fr_0.8fr] gap-8">
          <div>
            <BrandLockup logoSize={38} textClassName="text-2xl font-black" />
            <p className="mt-4 max-w-md leading-relaxed text-steel">Dronna is a focused practice platform for UKPSC and UKSSSC aspirants.</p>
          </div>
          <div>
            <h3 className="font-black mb-3 text-navy">App</h3>
            {["Course Demo", "Pricing", "Daily Challenge", "Syllabus"].map((item) => (
              <button key={item} className="block py-1 font-bold text-muted hover:text-orange-600" onClick={() => navigate("/signup")}>{item}</button>
            ))}
          </div>
          <div>
            <h3 className="font-black mb-3 text-navy">Company</h3>
            <button className="block py-1 font-bold text-muted hover:text-orange-600" onClick={() => openLegalPage("/privacy-policy.html")}>Privacy Policy</button>
            <button className="block py-1 font-bold text-muted hover:text-orange-600" onClick={() => openLegalPage("/terms.html")}>Terms & Conditions</button>
            <button className="block py-1 font-bold text-muted hover:text-orange-600" onClick={() => openLegalPage("/refund-policy.html")}>Refund Policy</button>
            <button className="block py-1 font-bold text-muted hover:text-orange-600" onClick={() => openLegalPage("/shipping-policy.html")}>Delivery Policy</button>
            <button className="block py-1 font-bold text-muted hover:text-orange-600" onClick={() => openLegalPage("/contact.html")}>Contact Us</button>
          </div>
        </div>
      </footer>
    </div>
  );
}
