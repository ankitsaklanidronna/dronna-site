export const COURSE_CARD_THEMES = [
  {
    accent: "var(--saffron-dark)",
    accentDark: "#9A3412",
    ink: "var(--navy)",
    cover: "linear-gradient(135deg, var(--navy) 0%, #1D4E89 48%, var(--saffron-dark) 100%)",
    soft: "#FFF7ED",
    line: "#FDBA74"
  },
  {
    accent: "#0F766E",
    accentDark: "#115E59",
    ink: "#102A43",
    cover: "linear-gradient(135deg, #0F172A 0%, #0F766E 52%, #FBBF24 100%)",
    soft: "#ECFDF5",
    line: "#5EEAD4"
  },
  {
    accent: "#2563EB",
    accentDark: "#1D4ED8",
    ink: "#111827",
    cover: "linear-gradient(135deg, #111827 0%, #2563EB 50%, #22C55E 100%)",
    soft: "#EFF6FF",
    line: "#93C5FD"
  },
  {
    accent: "#BE123C",
    accentDark: "#9F1239",
    ink: "#1F2937",
    cover: "linear-gradient(135deg, #1F2937 0%, #BE123C 48%, #F59E0B 100%)",
    soft: "#FFF1F2",
    line: "#FDA4AF"
  }
];

export function hashTextToIndex(value = "", size = 1) {
  const text = value || "course";
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  return hash % size;
}

export function getCourseCardTheme(name = "") {
  return COURSE_CARD_THEMES[hashTextToIndex(name, COURSE_CARD_THEMES.length)];
}

function formatFeatureCount(value, fallback) {
  if (value === null) return "--";
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function buildCourseFeatureRows({ setCount = 0, questionCount = 0, hasPaidContent = false } = {}) {
  const setLabel = formatFeatureCount(setCount, "Curated");
  const questionLabel = formatFeatureCount(questionCount, "Full");

  return [
    { icon: "quiz", text: `${setLabel} mock test sets` },
    { icon: "help", text: `${questionLabel} practice questions` },
    { icon: "timer", text: "Exam timer and instant result" },
    { icon: "psychology", text: "AI Performance Analyzer" },
    { icon: "insights", text: "Score history and progress tracking" },
    { icon: "fact_check", text: "Answer review after every test" },
    { icon: "leaderboard", text: "Leaderboard and rank comparison" },
    { icon: hasPaidContent ? "workspace_premium" : "lock_open", text: hasPaidContent ? "Premium course access" : "Free demo access" }
  ];
}

export function CourseFeatureList({ features = [], limit = 8, className = "" }) {
  return (
    <div className={`grid gap-2 ${className}`}>
      {features.slice(0, limit).map((feature) => (
        <div key={`${feature.icon}-${feature.text}`} className="flex min-h-[34px] items-center gap-2 rounded-lg bg-white/90 px-2.5 py-2 text-[11px] font-black leading-snug text-slate-700 ring-1 ring-black/5">
          <span className="material-symbols-outlined text-[17px] text-orange-600" style={{ fontVariationSettings: "'FILL' 1" }}>
            {feature.icon}
          </span>
          <span>{feature.text}</span>
        </div>
      ))}
    </div>
  );
}
