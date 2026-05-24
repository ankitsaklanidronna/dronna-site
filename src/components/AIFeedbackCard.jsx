import { useEffect, useRef, useState } from 'react';
import { getGroq } from '../services/aiFeedback.js';
import { getLastItem } from '../utils/attempts.js';

export function AIFeedbackCard({ attempts, name, examTarget, avgScore, bestScore, totalAttempts, compact = false, latestAttemptContext = null, isPro = false, accessToken = null, onUpgrade = null, autoLoad = false, coachLanguage = "hindi" }) {
  const [feedback, setFeedback] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const requestInFlightRef = useRef(false);
  const autoLoadedSignatureRef = useRef("");
  const getPct = (attempt) => Math.round((attempt.score / (attempt.total_questions || attempt.total || 1)) * 100);
  const attemptSignature = `${totalAttempts}-${getLastItem(attempts)?.completed_at || getLastItem(attempts)?.date || ""}-${getLastItem(attempts)?.score || ""}`;
  const feedbackSignature = `${attemptSignature}-${coachLanguage || "hindi"}`;

  const loadFeedback = async () => {
    if (!isPro || totalAttempts === 0 || loading || requestInFlightRef.current) return;
    requestInFlightRef.current = true;
    setLoading(true);

    try {
      // Trend calculate karo
      let trend = "stable";
      if (attempts.length >= 3) {
        const last3 = attempts.slice(-3).map(getPct);
        if (last3[2] > last3[0]) trend = "improving";
        else if (last3[2] < last3[0]) trend = "declining";
      }

      const worstScore = attempts.length > 0 ? Math.min(...attempts.map(getPct)) : 0;

      const result = await getGroq({
        name,
        examTarget,
        totalAttempts,
        avgScore,
        bestScore,
        worstScore,
        trend,
        recentAttempts: attempts,
        latestAttemptContext,
        aiCoachLanguage: coachLanguage
      }, accessToken);

      setFeedback(result);
      setLoaded(true);
    } finally {
      requestInFlightRef.current = false;
      setLoading(false);
    }
  };

  useEffect(() => {
    setFeedback(null);
    setLoaded(false);
  }, [feedbackSignature]);

  useEffect(() => {
    if (!autoLoad || !isPro || totalAttempts === 0 || loaded || loading) return;
    if (autoLoadedSignatureRef.current === feedbackSignature) return;
    autoLoadedSignatureRef.current = feedbackSignature;
    loadFeedback();
  }, [autoLoad, isPro, totalAttempts, feedbackSignature, loaded, loading]);

  // Parse feedback into sections
  const parseFeedback = (text) => {
    if (!text) return null;
    const lines = text.split("\n").filter(l => l.trim());
    const summary = lines[0] || "";
    const points = lines.filter(l => { const t=l.trim(); return t.length>1 && t[0]>="1" && t[0]<="4" && (t[1]==="." || t[1]===")"); });
    const rest = lines.filter(l => { const t=l.trim(); const ip=t.length>1&&t[0]>="1"&&t[0]<="4"&&(t[1]==="."||t[1]===")"); return !ip && l !== lines[0]; });
    return { summary, points, rest };
  };

  const parsed = parseFeedback(feedback);

  const trendColor = () => {
    if (attempts.length < 3) return "text-gray-400";
    const last3 = attempts.slice(-3).map(getPct);
    if (last3[2] > last3[0]) return "text-green-600";
    if (last3[2] < last3[0]) return "text-red-500";
    return "text-gray-500";
  };

  return (
    <div className="bg-white rounded-3xl shadow-sm overflow-hidden" style={{border:"2px solid var(--cream-dark)"}}>
      {/* Header */}
      <div className="p-4 flex items-center justify-between" style={{background:"linear-gradient(135deg, var(--navy), #1a3a6e)"}}>
        <div className="flex items-center gap-2">
          <span className="text-xl"></span>
          <div>
            <div className="font-black text-white text-sm">AI Coach Feedback</div>
            <div className="text-white/50 text-xs">{compact ? "Latest test insight" : "A precise summary of your recent tests"}</div>
          </div>
        </div>
        {totalAttempts > 0 && (!autoLoad || loaded) && (
          <button
            onClick={loadFeedback}
            disabled={loading}
            className="text-xs font-bold px-3 py-1 rounded-lg transition-all"
            style={{background: loaded ? "rgba(255,255,255,0.1)" : "var(--saffron)", color:"white"}}
          >
            {loading ? "" : loaded ? " Refresh" : "Ask AI Coach"}
          </button>
        )}
      </div>

      <div className="p-4">
        {totalAttempts === 0 ? (
          <div className="text-center py-4">
            <div className="text-3xl mb-2"></div>
            <p className="text-xs text-gray-500 devanagari">Complete your first test</p>
            <p className="text-xs text-gray-400 devanagari">Then the coach will highlight your weak areas</p>
          </div>
        ) : !loaded && !loading ? (
          <div className="text-center py-3">
            <div className="grid grid-cols-3 gap-2 mb-3 text-center">
              <div className="bg-orange-50 rounded-xl p-2">
                <div className="font-black text-orange-600">{avgScore}%</div>
                <div className="text-xs text-gray-400">Average</div>
              </div>
              <div className="bg-green-50 rounded-xl p-2">
                <div className="font-black text-green-600">{bestScore}%</div>
                <div className="text-xs text-gray-400">Best</div>
              </div>
              <div className={`rounded-xl p-2 ${trendColor().includes("green") ? "bg-green-50" : trendColor().includes("red") ? "bg-red-50" : "bg-gray-50"}`}>
                <div className={"font-black " + trendColor()}>
                  {attempts.length >= 3 ? (trendColor().includes("green") ? "" : trendColor().includes("red") ? "" : "") : ""}
                </div>
                <div className="text-xs text-gray-400">Trend</div>
              </div>
            </div>
            {autoLoad && isPro ? (
              <p className="text-xs font-bold text-gray-500">AI analysis will appear automatically.</p>
            ) : (
              <button onClick={loadFeedback} className="btn-primary w-full justify-center text-sm py-2">
                 Ask AI Coach
              </button>
            )}
          </div>
        ) : loading ? (
          <div className="py-4 space-y-2">
            <div className="flex items-center gap-2 text-xs text-gray-400 mb-3">
              <div className="w-4 h-4 border-2 border-orange-200 border-t-orange-500 rounded-full animate-spin"></div>
              <span className="devanagari">The coach is analyzing your results...</span>
            </div>
            {[90, 70, 85, 60].map((w,i) => (
              <div key={i} className="h-2 bg-gray-100 rounded animate-pulse" style={{width: w + "%"}}></div>
            ))}
          </div>
        ) : parsed ? (
          <div className="space-y-3">
            {/* Summary line */}
            {parsed.summary && (
              <p className="text-xs font-semibold text-gray-700 devanagari leading-relaxed bg-orange-50 p-2 rounded-lg border-l-4 border-orange-400">
                {parsed.summary}
              </p>
            )}
            {/* Numbered points */}
            {parsed.points.map((point, i) => {
              const colors = [
                {bg:"bg-blue-50", border:"border-blue-400", num:"bg-blue-500"},
                {bg:"bg-red-50", border:"border-red-400", num:"bg-red-500"},
                {bg:"bg-yellow-50", border:"border-yellow-400", num:"bg-yellow-500"},
                {bg:"bg-green-50", border:"border-green-400", num:"bg-green-500"},
              ];
              const c = colors[i % 4];
              const text = (point.length > 2 && (point[1]==="." || point[1]===")")) ? point.slice(2).trim() : point.trim();
              return (
                <div key={i} className={"flex items-start gap-2 p-2 rounded-xl border-l-4 " + c.bg + " " + c.border}>
                  <span className={"w-5 h-5 rounded-full flex items-center justify-center text-white text-xs font-black flex-shrink-0 mt-0.5 " + c.num}>
                    {i+1}
                  </span>
                  <p className="text-xs text-gray-700 devanagari leading-relaxed">{text}</p>
                </div>
              );
            })}
            {/* Any remaining text */}
            {parsed.rest.map((line, i) => (
              <p key={i} className="text-xs text-gray-500 devanagari leading-relaxed">{line}</p>
            ))}
          </div>
        ) : (
          <p className="text-xs text-gray-400 text-center py-3 devanagari">Analysis is not available right now</p>
        )}
      </div>
    </div>
  );
}
