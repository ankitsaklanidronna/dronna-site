import { useEffect, useState } from 'react';
import { BrandLockup } from '../components/BrandLockup.jsx';
import { CourseFeatureList, buildCourseFeatureRows, getCourseCardTheme } from '../components/CourseFeatureList.jsx';
import { ShareBtn } from '../components/ShareBtn.jsx';
import { getRouteSearchParams, useRouter } from '../context/RouterContext.jsx';
import { getPublicLandingStats, supabase } from '../services/supabaseClient.js';
import { openLegalPage } from '../utils/navigation.js';
import { getCoursePriceLabel, getCoursePricing } from '../utils/pricing.js';
import { APP_SHARE_TITLE, buildCourseShareText, getCoursePublicShareUrl, getCourseShareName } from '../utils/share.js';

const FEATURED_EBOOK_ID = "9efb8672-fad8-4bc1-8191-93c1c202d34c";
const FEATURED_EBOOK_FALLBACK = {
  id: FEATURED_EBOOK_ID,
  title: "उत्तराखंड: एक राजनीतिक अध्ययन",
  subtitle: "उत्तराखंड के प्राचीन, मध्यकालीन और आधुनिक इतिहास का समग्र अध्ययन",
  cover_url: "https://rzacvumxsergagbqnwsz.supabase.co/storage/v1/object/public/cover/coverhistory.png",
  price_inr: 249,
  mrp_inr: 399
};

export function SimpleLandingPage() {
  const { navigate, page } = useRouter();
  const [featuredEbook, setFeaturedEbook] = useState(FEATURED_EBOOK_FALLBACK);
  const [publicStats, setPublicStats] = useState({
    questions: null,
    practiceSets: null,
    leaderboardEntries: null,
    courseFolders: [],
    courseSets: [],
    courseCatalogError: "",
    countError: "",
    statsError: "",
    questionCountError: "",
    loaded: false
  });
  const [selectedCourseFolderId, setSelectedCourseFolderId] = useState("");

  useEffect(() => {
    let alive = true;
    getPublicLandingStats().then((stats) => {
      if (!alive) return;
      setPublicStats({ ...stats, loaded: true });
    });
    supabase.getPublicEbooks().then((result) => {
      if (!alive) return;
      const ebook = (result.data || []).find((item) => item.id === FEATURED_EBOOK_ID);
      if (ebook) setFeaturedEbook({ ...FEATURED_EBOOK_FALLBACK, ...ebook });
    });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const sectionIds = ["choose-course", "free-practice"];
    if (!sectionIds.includes(page)) return;
    window.requestAnimationFrame(() => {
      document.getElementById(page)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [page]);

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

  const freePracticeOptions = [
    { title: "Daily Challenge", detail: "Build consistency with a short daily question set.", path: "/daily", tone: "var(--saffron-dark)" },
    { title: "Free Practice Sets", detail: "Try demo sets before choosing a course.", path: "/demo", tone: "#2563EB" },
    { title: "Syllabus", detail: "Review UKPSC and UKSSSC syllabus resources in one place.", path: "/syllabus", tone: "#0F766E" },
    { title: "Ebook Store", detail: "Buy protected study ebooks with account-based access.", path: "/ebooks", tone: "#B45309" },
    { title: "Leaderboard", detail: "Compare scores and track competitive progress.", path: "/leaderboard", tone: "#7C3AED" },
  ];

  const courseFolders = publicStats.courseFolders || [];
  const courseSets = publicStats.courseSets || [];
  const rootCourseFolders = courseFolders.filter((folder) => !folder.parent_id);
  const childFoldersOf = (folderId) => courseFolders.filter((folder) => folder.parent_id === folderId);
  const setsInFolder = (folderId) => courseSets.filter((set) => set.folder_id === folderId);
  const folderById = new Map(courseFolders.map((folder) => [folder.id, folder]));
  const getPaidFolderForSet = (set) => {
    let current = set?.folder_id ? folderById.get(set.folder_id) : null;
    const seen = new Set();
    while (current && !seen.has(current.id)) {
      if (current.parent_id && current.is_paid) return current;
      seen.add(current.id);
      current = current.parent_id ? folderById.get(current.parent_id) : null;
    }
    return null;
  };
  const selectedCourseFolder =
    rootCourseFolders.find((folder) => folder.id === selectedCourseFolderId) ||
    rootCourseFolders[0] ||
    null;
  const selectedCourseFolderChildren = selectedCourseFolder ? childFoldersOf(selectedCourseFolder.id) : [];
  const orphanCourseSets = courseSets.filter((set) => !set.folder_id || !courseFolders.find((folder) => folder.id === set.folder_id));
  const selectedCourseFolderSets = selectedCourseFolder ? setsInFolder(selectedCourseFolder.id) : [];
  const selectedCourseFolderVisibleItems = selectedCourseFolderChildren.length || selectedCourseFolderSets.length;
  const sharedCourseFolderId = getRouteSearchParams(page).get("course") || getRouteSearchParams(page).get("folder");
  const countSetsInCourseFolder = (folderId) => {
    const direct = setsInFolder(folderId).length;
    return direct + childFoldersOf(folderId).reduce((sum, folder) => sum + countSetsInCourseFolder(folder.id), 0);
  };
  const countPaidSetsInCourseFolder = (folderId) => {
    const direct = setsInFolder(folderId).filter((set) => set.is_paid).length;
    return direct + childFoldersOf(folderId).reduce((sum, folder) => sum + countPaidSetsInCourseFolder(folder.id), 0);
  };
  const countQuestionsInCourseFolder = (folderId) => {
    let total = 0;
    let hasUnknown = false;

    setsInFolder(folderId).forEach((set) => {
      const count = getSetQuestionCount(set);
      if (count === null) {
        hasUnknown = true;
        return;
      }
      total += count;
    });

    childFoldersOf(folderId).forEach((folder) => {
      const childCount = countQuestionsInCourseFolder(folder.id);
      if (childCount === null) {
        hasUnknown = true;
        return;
      }
      total += childCount;
    });

    return hasUnknown ? null : total;
  };
  const selectedCourseShareText = selectedCourseFolder ? buildCourseShareText(selectedCourseFolder, {
    setCount: countSetsInCourseFolder(selectedCourseFolder.id),
    questionCount: countQuestionsInCourseFolder(selectedCourseFolder.id),
    hasPaidContent: countPaidSetsInCourseFolder(selectedCourseFolder.id) > 0
  }) : "";
  const openLandingSet = (set) => {
    navigate(set.is_paid || getPaidFolderForSet(set) ? "/practice" : "/demo");
  };
  const openCourseFolderForSale = () => {
    navigate("/practice");
  };
  const scrollToLandingSection = (sectionId) => {
    document.getElementById(sectionId)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const openFeaturedEbook = () => {
    navigate(`/ebooks?ebook=${encodeURIComponent(featuredEbook.id)}`);
  };
  const featuredPrice = Number(featuredEbook.price_inr) || FEATURED_EBOOK_FALLBACK.price_inr;
  const featuredMrp = Number(featuredEbook.mrp_inr) || featuredPrice;
  const featuredDiscount = featuredMrp > featuredPrice
    ? Math.round(((featuredMrp - featuredPrice) / featuredMrp) * 100)
    : 0;

  useEffect(() => {
    if (!publicStats.loaded) return;
    if (sharedCourseFolderId) {
      const sharedFolder = folderById.get(sharedCourseFolderId);
      if (sharedFolder) {
        const visibleFolderId = sharedFolder.parent_id || sharedFolder.id;
        if (selectedCourseFolderId !== visibleFolderId) {
          setSelectedCourseFolderId(visibleFolderId);
        }
        window.requestAnimationFrame(() => {
          document.getElementById("choose-course")?.scrollIntoView({ behavior: "smooth", block: "start" });
        });
      }
      return;
    }
    if (selectedCourseFolderId) return;
    if (rootCourseFolders[0]?.id) {
      setSelectedCourseFolderId(rootCourseFolders[0].id);
    }
  }, [publicStats.loaded, sharedCourseFolderId, courseFolders, rootCourseFolders, selectedCourseFolderId]);

  const renderLandingSet = (set) => (
    <div key={set.id} className="rounded-lg border border-line bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="font-black leading-6 text-navy">{set.set_name}</h4>
          <div className="mt-2 flex flex-wrap gap-2 text-xs font-bold text-muted">
            <span>{formatCount(getSetQuestionCount(set))} questions</span>
            <span>{set.time_limit_minutes || 0} mins</span>
            {set.exam_type && <span>{set.exam_type}</span>}
          </div>
        </div>
        <span className="rounded-full px-3 py-1 text-xs font-black" style={{
          background: set.is_paid || getPaidFolderForSet(set) ? "#FEF3C7" : "#DCFCE7",
          color: set.is_paid || getPaidFolderForSet(set) ? "#B45309" : "#15803D"
        }}>
          {set.is_paid || getPaidFolderForSet(set) ? "Paid" : "Free"}
        </span>
      </div>
      {(set.is_paid || getPaidFolderForSet(set)) && (
        <div className="mt-4 rounded-lg border px-3 py-2 text-xs font-black uppercase tracking-wide" style={{borderColor:"#DDD6FE", background:"#F5F3FF", color:"#6D28D9"}}>
          AI Performance Analyzer included with course access
        </div>
      )}
      <button
        className={`${set.is_paid || getPaidFolderForSet(set) ? "btn-primary" : "btn-outline"} mt-4 w-full justify-center py-2 text-sm`}
        onClick={() => openLandingSet(set)}
      >
        {set.is_paid || getPaidFolderForSet(set) ? `Buy Course ${getCoursePriceLabel(getPaidFolderForSet(set) || {})}` : "Try Demo First"}
      </button>
    </div>
  );

  const renderCourseProductCard = (folder) => {
    const children = childFoldersOf(folder.id);
    const nestedSetCount = countSetsInCourseFolder(folder.id);
    const questionCount = countQuestionsInCourseFolder(folder.id);
    const paidCount = countPaidSetsInCourseFolder(folder.id);
    const hasPaidContent = Boolean(folder.parent_id && folder.is_paid) || paidCount > 0;
    const pricing = getCoursePricing(folder);
    const theme = getCourseCardTheme(folder.name);
    const features = buildCourseFeatureRows({
      setCount: nestedSetCount,
      questionCount,
      hasPaidContent
    });
    const courseShareUrl = getCoursePublicShareUrl(folder);
    const courseShareText = buildCourseShareText(folder, {
      setCount: nestedSetCount,
      questionCount,
      hasPaidContent,
      price: hasPaidContent ? pricing.salePrice : undefined
    });

    return (
      <article
        key={folder.id}
        className="group flex min-h-[420px] flex-col overflow-hidden rounded-lg border bg-white shadow-sm transition duration-300 hover:shadow-xl sm:min-h-[470px] sm:hover:-translate-y-1"
        style={{borderColor:theme.line}}
      >
        <div className="relative min-h-[128px] p-4 text-white sm:min-h-[150px] sm:p-5" style={{background:theme.cover}}>
          <div className="flex items-start justify-between gap-3">
            <span className="rounded-full bg-white/16 px-3 py-1 text-[11px] font-black uppercase tracking-[0.18em] ring-1 ring-white/25">
              {hasPaidContent ? "Premium Course" : "Free Course"}
            </span>
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white/15 ring-1 ring-white/25">
              <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>school</span>
            </span>
          </div>
          <div className="mt-6 sm:mt-8">
            <p className="text-xs font-black uppercase tracking-[0.22em] text-white/75">Dronna Course</p>
            <h3 className="mt-2 text-xl sm:text-2xl font-black leading-tight text-white">{folder.name}</h3>
          </div>
        </div>

        <div className="flex flex-1 flex-col p-3.5 sm:p-4">
          <div className="grid grid-cols-2 gap-2 text-center">
            <div className="rounded-lg px-2 py-3" style={{background:theme.soft}}>
              <div className="text-xl font-black" style={{color:theme.ink}}>{formatCount(nestedSetCount)}</div>
              <div className="text-[10px] font-black uppercase tracking-wide" style={{color:theme.accentDark}}>Sets</div>
            </div>
            <div className="rounded-lg bg-slate-50 px-2 py-3">
              <div className="text-xl font-black" style={{color:theme.ink}}>{formatCount(questionCount)}</div>
              <div className="text-[10px] font-black uppercase tracking-wide text-slate-500">Questions</div>
            </div>
          </div>

          <div className="mt-4 rounded-lg px-3 py-2 text-xs font-black uppercase tracking-wide" style={{background:hasPaidContent ? "#FEF3C7" : "#DCFCE7", color:hasPaidContent ? "#92400E" : "#166534"}}>
            {hasPaidContent ? "Full course bundle included" : "Open practice access"}
          </div>

          <CourseFeatureList features={features} className="mt-4" />

          <div className="mt-auto pt-4">
            {hasPaidContent && (
              <div className="mb-3 rounded-lg border px-3 py-3" style={{borderColor:"#FED7AA", background:"#FFF7ED"}}>
                <div className="flex flex-wrap items-end gap-2">
                  {pricing.hasDiscount && <span className="text-xs font-bold text-gray-400 line-through">Rs {pricing.mrp}</span>}
                  <span className="text-2xl font-black text-saffron-dark">Rs {pricing.salePrice}</span>
                  {pricing.hasDiscount && (
                    <span className="mb-1 rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-black text-green-700">
                      {pricing.discountPercent}% OFF
                    </span>
                  )}
                </div>
              </div>
            )}

            <button
              type="button"
              className={`${hasPaidContent ? "btn-primary" : "btn-outline"} w-full justify-center py-3 text-sm`}
              onClick={openCourseFolderForSale}
            >
              {hasPaidContent ? `Buy Course Rs ${pricing.salePrice}` : "Open Free Course"}
              <span className="material-symbols-outlined text-lg">arrow_forward</span>
            </button>
            <ShareBtn
              title={`${getCourseShareName(folder)} | ${APP_SHARE_TITLE}`}
              text={courseShareText}
              url={courseShareUrl}
              label="Share Course"
              className="mt-2 w-full justify-center rounded-lg border px-4 py-3 text-sm text-slate-600 hover:border-orange-300 hover:bg-orange-50 hover:text-orange-600"
            />
          </div>
        </div>
      </article>
    );
  };

  return (
    <div className="font-body bg-white text-ink-deep">
      <nav className="sticky top-0 z-50 border-b border-b-line bg-white/95 backdrop-blur shadow-sm">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
          <BrandLockup logoSize={36} textClassName="text-2xl" onClick={() => navigate("/")} />
          <div className="hidden md:flex items-center gap-7 text-sm font-extrabold text-steel">
            <button type="button" className="hover:text-orange-600" onClick={() => scrollToLandingSection("choose-course")}>Choose Course</button>
            <button type="button" className="hover:text-orange-600" onClick={() => scrollToLandingSection("free-practice")}>Free Practice</button>
            <button className="hover:text-orange-600" onClick={() => navigate("/syllabus")}>Syllabus</button>
            <button className="hover:text-orange-600" onClick={() => navigate("/ebooks")}>Ebooks</button>
            <button className="hover:text-orange-600" onClick={() => navigate("/demo")}>Demo</button>
            <button className="hover:text-orange-600" onClick={() => openLegalPage("/contact.html")}>Contact</button>
          </div>
          <div className="flex items-center gap-2">
            <button className="hidden sm:inline-flex px-4 py-2 rounded-lg font-bold text-navy hover:bg-slate-100" onClick={() => navigate("/login")}>Login</button>
            <button className="px-4 py-2 rounded-lg bg-saffron-dark font-black text-white" onClick={() => navigate("/demo")}>Try Demo</button>
          </div>
        </div>
      </nav>
      <section className="relative overflow-hidden border-b-[6px] border-[#F59E0B] bg-[#103C36] text-white">
        <img
          src={featuredEbook.cover_url}
          alt=""
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 h-full w-2/3 object-cover object-center opacity-[0.08]"
        />
        <div className="absolute inset-y-0 left-0 w-2 bg-[#EF6C35]"></div>

        <div className="relative mx-auto grid max-w-6xl grid-cols-[minmax(0,1fr)_96px] items-center gap-x-4 gap-y-6 px-5 py-9 min-[360px]:grid-cols-[minmax(0,1fr)_124px] sm:grid-cols-[minmax(0,1fr)_150px] sm:px-6 sm:py-11 md:grid-cols-[1.08fr_0.72fr] md:gap-10 md:px-8 md:py-12 lg:min-h-[560px] lg:gap-16 lg:py-14">
          <div className="min-w-0">
            <div className="mb-4 inline-flex items-center gap-2 rounded-md border border-[#F9C74F]/50 bg-[#173F48] px-3 py-1.5 text-[10px] font-black uppercase text-[#FFD166] sm:text-xs">
              <span className="material-symbols-outlined text-base">campaign</span>
              नई ईबुक रिलीज
            </div>

            <p className="mb-2 text-xs font-black uppercase text-[#F7C95C] sm:text-sm">Dronna Exclusive</p>
            <h1 className="font-hindi text-[2rem] font-black leading-[1.22] text-white sm:text-4xl md:text-5xl lg:text-6xl">
              {featuredEbook.title}
            </h1>
            <p className="mt-3 hidden max-w-2xl font-hindi text-sm font-bold leading-6 text-[#D7ECE7] min-[360px]:block sm:mt-4 sm:text-base md:text-lg md:leading-8">
              {featuredEbook.subtitle}
            </p>

            <div className="mt-5 flex flex-wrap gap-2 text-[10px] font-black uppercase text-white sm:mt-6 sm:text-xs">
              <span className="rounded-md border border-white/20 bg-white/10 px-2.5 py-2">PDF Ebook</span>
              <span className="rounded-md border border-white/20 bg-white/10 px-2.5 py-2">Email Protected</span>
              <span className="hidden rounded-md border border-white/20 bg-white/10 px-2.5 py-2 sm:inline-flex">Instant Access</span>
            </div>

            <div className="mt-6 flex flex-wrap items-end gap-x-3 gap-y-1 sm:mt-7">
              <span className="text-3xl font-black text-[#FFD166] sm:text-4xl">₹{featuredPrice}</span>
              {featuredMrp > featuredPrice && (
                <span className="pb-1 text-sm font-bold text-white/55 line-through sm:text-base">₹{featuredMrp}</span>
              )}
              {featuredDiscount > 0 && (
                <span className="mb-1 rounded-md bg-[#E9F7EF] px-2 py-1 text-[10px] font-black text-[#147A4A] sm:text-xs">
                  {featuredDiscount}% OFF
                </span>
              )}
            </div>

            <div className="mt-5 flex flex-col gap-3 sm:mt-6 sm:flex-row">
              <button
                type="button"
                onClick={openFeaturedEbook}
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-[#EF6C35] px-5 py-3 text-sm font-black text-white shadow-[0_12px_28px_rgba(0,0,0,0.22)] transition hover:-translate-y-0.5 hover:bg-[#D95824] sm:text-base"
              >
                <span className="material-symbols-outlined text-xl">shopping_bag</span>
                अभी खरीदें - ₹{featuredPrice}
              </button>
              <button
                type="button"
                onClick={() => navigate("/ebooks")}
                className="hidden min-h-12 items-center justify-center gap-2 rounded-lg border border-white/30 px-5 py-3 text-sm font-black text-white transition hover:bg-white/10 min-[360px]:inline-flex sm:text-base"
              >
                सभी ईबुक देखें
                <span className="material-symbols-outlined text-xl">arrow_forward</span>
              </button>
            </div>
            <p className="mt-3 hidden text-xs font-bold text-[#BFD9D3] sm:block">
              सुरक्षित भुगतान | खरीद के बाद तुरंत एक्सेस | PDF पासवर्ड आपका लॉगिन ईमेल
            </p>
          </div>

          <div className="relative mx-auto w-full max-w-[290px] self-center md:max-w-[330px]">
            <div className="absolute -bottom-3 left-3 right-0 top-4 rounded-md bg-[#071F24] sm:-bottom-4 sm:left-5"></div>
            <img
              src={featuredEbook.cover_url}
              alt={`${featuredEbook.title} ebook cover`}
              className="relative aspect-[3/4] w-full rounded-md object-cover shadow-[0_24px_50px_rgba(0,0,0,0.38)] ring-1 ring-white/25"
            />
            <div className="absolute -bottom-4 -left-3 hidden rounded-md border-2 border-[#103C36] bg-[#FFD166] px-3 py-2 text-center text-[#17313A] shadow-lg sm:block md:-left-8 md:px-4">
              <div className="text-[10px] font-black uppercase">Launch Price</div>
              <div className="text-xl font-black">₹{featuredPrice}</div>
            </div>
          </div>
        </div>
      </section>

      <div className="border-b border-b-line bg-white">
        <div className="max-w-6xl mx-auto px-4 py-7">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-5 text-center md:divide-x md:divide-line-soft">
            {[
              [statValue(publicStats.questions), "Questions"],
              [statValue(publicStats.practiceSets), "Mock Tests"],
              [statValue(publicStats.leaderboardEntries), "Daily Attempts"],
              ["Course-wise", "AI Analyzer"],
            ].map(([num, label]) => (
              <div key={label} className="px-2">
                <div className={`text-3xl font-black ${label === "AI Analyzer" ? "text-saffron-dark" : "text-navy"}`}>{num}</div>
                <div className="text-xs font-bold uppercase tracking-widest mt-1 text-muted">{label}</div>
              </div>
            ))}
          </div>
          {publicStats.loaded && publicStats.countError && (
            <div className="mt-5 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-center text-sm font-bold text-amber-800">
              Live counts are temporarily unavailable. Course details may show -- until the connection recovers.
            </div>
          )}
        </div>
      </div>

      <section id="choose-course" className="max-w-6xl mx-auto px-4 py-14 md:py-16">
        <div className="mb-7 flex flex-col md:flex-row md:items-end md:justify-between gap-3">
          <div>
            <p className="text-sm font-black uppercase text-saffron-dark">Choose Course</p>
            <h2 className="mt-2 text-3xl md:text-4xl font-black text-navy">Choose your preparation course</h2>
          </div>
          <p className="max-w-md text-sm font-semibold leading-relaxed text-muted">
            Browse available practice courses, free tests, and premium mock-test plans.
          </p>
        </div>
        <div className="space-y-5">
          {!publicStats.loaded && [1,2,3].map((item) => (
            <div key={item} className="rounded-lg border border-line bg-white p-5 animate-pulse">
              <div className="h-5 w-1/3 rounded bg-slate-100"></div>
              <div className="mt-4 h-4 w-2/3 rounded bg-slate-100"></div>
            </div>
          ))}

          {publicStats.loaded && publicStats.courseCatalogError && (
            <div className="rounded-lg border bg-red-50 p-5 text-sm font-bold text-red-600" style={{borderColor:"#FECACA"}}>
              Courses could not be loaded right now. Please refresh once.
            </div>
          )}

          {publicStats.loaded && !publicStats.courseCatalogError && rootCourseFolders.length === 0 && orphanCourseSets.length === 0 && (
            <div className="rounded-lg border border-line bg-white p-6 text-center">
              <h3 className="text-xl font-black text-navy">Courses are being updated</h3>
              <p className="mt-2 text-sm font-bold text-muted">New practice courses will appear here soon. You can still try the free demo test.</p>
            </div>
          )}

          {publicStats.loaded && !publicStats.courseCatalogError && rootCourseFolders.length > 0 && (
            <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
              <div className="rounded-lg border border-line bg-white p-3 shadow-sm">
                <div className="mb-3 px-2 text-xs font-black uppercase tracking-wider text-muted">Course Categories</div>
                <div className="space-y-2">
                  {rootCourseFolders.map((folder) => {
                    const isActive = selectedCourseFolder?.id === folder.id;
                    const theme = getCourseCardTheme(folder.name);
                    const setCount = countSetsInCourseFolder(folder.id);
                    return (
                      <button
                        key={folder.id}
                        type="button"
                        className="flex w-full items-center justify-between gap-3 rounded-lg border px-4 py-3 text-left transition hover:-translate-y-0.5"
                        style={{
                          borderColor: isActive ? theme.line : "var(--line)",
                          background: isActive ? theme.soft : "#FFFFFF",
                          color: isActive ? theme.accentDark : "var(--navy)"
                        }}
                        onClick={() => setSelectedCourseFolderId(folder.id)}
                      >
                        <span className="flex min-w-0 items-center gap-3">
                          <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white ${isActive ? "" : "bg-navy"}`} style={isActive ? {background: theme.cover} : undefined}>
                            <span className="material-symbols-outlined text-xl" style={{ fontVariationSettings: "'FILL' 1" }}>school</span>
                          </span>
                          <span className="min-w-0">
                    <span className="block truncate font-black">{folder.name}</span>
                            <span className="mt-0.5 block text-[10px] font-black uppercase tracking-wide" style={{color:isActive ? theme.accentDark : "#94A3B8"}}>
                              {setCount} sets
                            </span>
                          </span>
                        </span>
                        <span className="material-symbols-outlined text-lg" style={{color:isActive ? theme.accentDark : "#94A3B8"}}>
                          chevron_right
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-lg border border-line bg-slate-50 p-3.5 sm:p-4 md:p-5">
                <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <p className="text-xs font-black uppercase tracking-wider text-saffron-dark">Available Courses</p>
                    <h3 className="mt-1 text-2xl font-black text-navy">{selectedCourseFolder?.name || "Courses"}</h3>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-bold text-muted">
                      {selectedCourseFolderVisibleItems} courses available
                    </p>
                    {selectedCourseFolder && (
                      <ShareBtn
                        title={`${getCourseShareName(selectedCourseFolder)} | ${APP_SHARE_TITLE}`}
                        text={selectedCourseShareText}
                        url={getCoursePublicShareUrl(selectedCourseFolder)}
                        label="Share Course"
                        className="rounded-lg border bg-white px-3 py-2 text-xs text-slate-600 hover:border-orange-300 hover:bg-orange-50 hover:text-orange-600"
                      />
                    )}
                  </div>
                </div>

                {selectedCourseFolderChildren.length > 0 && (
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {selectedCourseFolderChildren.map(renderCourseProductCard)}
                  </div>
                )}

                {selectedCourseFolderChildren.length === 0 && selectedCourseFolderSets.length > 0 && (
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {selectedCourseFolderSets.map(renderLandingSet)}
                  </div>
                )}

                {selectedCourseFolderChildren.length === 0 && selectedCourseFolderSets.length === 0 && (
                  <div className="rounded-lg border border-line bg-white p-6 text-center">
                    <h3 className="text-lg font-black text-navy">More tests are coming soon</h3>
                    <p className="mt-2 text-sm font-bold text-muted">This course section is being prepared. Please check the demo or other available courses.</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {publicStats.loaded && !publicStats.courseCatalogError && orphanCourseSets.length > 0 && (
            <div className="rounded-lg border border-line bg-white p-5">
              <div className="mb-4">
                <h3 className="text-xl font-black text-navy">Free Practice Tests</h3>
                <p className="mt-1 text-sm font-bold text-muted">Start with these free tests before choosing a full course.</p>
              </div>
              <div className="grid md:grid-cols-2 gap-4">
                {orphanCourseSets.map(renderLandingSet)}
              </div>
            </div>
          )}
        </div>
      </section>

      <section id="free-practice" className="bg-app-muted py-14 md:py-16">
        <div className="max-w-6xl mx-auto px-4">
          <div className="mb-7 flex flex-col md:flex-row md:items-end md:justify-between gap-3">
            <div>
              <p className="text-sm font-black uppercase text-saffron-dark">Free Practice</p>
              <h2 className="mt-2 text-3xl md:text-4xl font-black text-navy">Free practice resources in one place</h2>
            </div>
            <button className="btn-outline w-fit" onClick={() => navigate("/demo")}>Try Demo Without Login</button>
          </div>
          <div className="grid md:grid-cols-5 gap-4">
            {freePracticeOptions.map((item) => (
              <button key={item.title} className="rounded-lg border border-line bg-white p-5 text-left transition hover:-translate-y-1 hover:shadow-lg" onClick={() => navigate(item.path)}>
                <span className="rounded-lg px-3 py-2 text-xs font-black text-white" style={{background:item.tone}}>{item.title.slice(0, 2).toUpperCase()}</span>
                <h3 className="mt-4 text-lg font-black text-navy">{item.title}</h3>
                <p className="mt-2 text-sm font-bold leading-relaxed text-muted">{item.detail}</p>
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-4 py-10">
        <div className="mt-6 text-center text-sm font-medium leading-7 text-steel">
          Paid features are governed by our{" "}
          <button type="button" className="font-bold text-saffron-dark hover:underline bg-transparent border-0 p-0 align-baseline" onClick={() => openLegalPage("/terms.html")}>Terms</button>,
          {" "}
          <button type="button" className="font-bold text-saffron-dark hover:underline bg-transparent border-0 p-0 align-baseline" onClick={() => openLegalPage("/privacy-policy.html")}>Privacy Policy</button>
          {", and "}
          <button type="button" className="font-bold text-saffron-dark hover:underline bg-transparent border-0 p-0 align-baseline" onClick={() => openLegalPage("/refund-policy.html")}>Refund Policy</button>
          {", "}
          <button type="button" className="font-bold text-saffron-dark hover:underline bg-transparent border-0 p-0 align-baseline" onClick={() => openLegalPage("/shipping-policy.html")}>Delivery Policy</button>
          {", and "}
          <button type="button" className="font-bold text-saffron-dark hover:underline bg-transparent border-0 p-0 align-baseline" onClick={() => openLegalPage("/contact.html")}>Contact Support</button>
          .
        </div>
      </section>

      <footer className="border-t border-t-line bg-white">
        <div className="max-w-6xl mx-auto px-4 py-8 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <BrandLockup logoSize={34} textClassName="text-xl font-black" />
          <div className="flex flex-wrap gap-4 text-sm font-bold text-muted">
            <button onClick={() => navigate("/login")}>Login</button>
            <button onClick={() => navigate("/syllabus")}>Syllabus</button>
            <button onClick={() => navigate("/ebooks")}>Ebooks</button>
            <button onClick={() => openLegalPage("/terms.html")}>Terms</button>
            <button onClick={() => openLegalPage("/privacy-policy.html")}>Privacy</button>
            <button onClick={() => openLegalPage("/refund-policy.html")}>Refunds</button>
            <button onClick={() => openLegalPage("/shipping-policy.html")}>Delivery</button>
            <button onClick={() => openLegalPage("/contact.html")}>Contact</button>
          </div>
        </div>
      </footer>
    </div>
  );
}
