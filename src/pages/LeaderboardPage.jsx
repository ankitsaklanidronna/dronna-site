import { useEffect, useState } from 'react';
import { Navbar } from '../components/Navbar.jsx';
import { ShareBtn } from '../components/ShareBtn.jsx';
import { useRouter } from '../context/RouterContext.jsx';
import { supabase } from '../services/supabaseClient.js';

export function LeaderboardPage() {
  const { navigate } = useRouter();
  const [todayLb, setTodayLb] = useState([]);
  const [allTimeLb, setAllTimeLb] = useState([]);
  const [loading, setLoading] = useState(true);
  const today = new Date().toISOString().split("T")[0];

  useEffect(() => { loadLeaderboards(); }, []);

  const loadLeaderboards = async () => {
    setLoading(true);
    // Today
    const todayData = await supabase.getLeaderboard(today);
    setTodayLb(todayData.sort((a,b) => b.score - a.score));
    // All time  aggregate by email
    const allData = await supabase.getAllTimeLeaderboard();
    const agg = allData.reduce((acc, e) => {
      const ex = acc.find(x => x.email === e.email);
      if (ex) { ex.total_score += e.score; ex.days++; }
      else acc.push({ name: e.name, email: e.email, total_score: e.score, days: 1 });
      return acc;
    }, []).sort((a,b) => b.total_score - a.total_score);
    setAllTimeLb(agg);
    setLoading(false);
  };

  const medals = ["","",""];

  return (
    <div className="page" style={{background:"var(--cream)"}}>
      <Navbar />
      <div className="max-w-2xl mx-auto px-4 py-8 fade-in">
        <div className="mb-6 text-center">
          <div className="text-5xl mb-2"></div>
          <h1 className="text-2xl font-black" style={{color:"var(--navy)"}}>Daily Challenge Leaderboard</h1>
          <p className="text-gray-500 text-sm mt-1">Participate daily  reach the top!</p>
          <div className="mt-3 flex justify-center">
            <ShareBtn
              title="Dronna Leaderboard"
              text={" Dronna Daily Challenge Leaderboard\nCan you reach the top?\n UKPSC & UKSSSC Free Practice"}
              url={window.location.href.split("#")[0] + "#/leaderboard"}
              label=" Share Leaderboard"
              className="px-5 py-2 rounded-full border-2 text-sm font-bold border-orange-300 text-orange-600 hover:bg-orange-50 transition-all"
            />
          </div>
        </div>

        {loading ? (
          <div className="card text-center py-8">
            <div className="w-10 h-10 rounded-full border-4 border-orange-200 border-t-orange-500 animate-spin mx-auto mb-3"></div>
            <p className="text-gray-400 text-sm">Leaderboard is loading...</p>
          </div>
        ) : (
          <div>
            {/* Today */}
            <div className="card mb-6">
              <h3 className="font-black mb-4" style={{color:"var(--navy)"}}> Today's Results  {new Date().toLocaleDateString("en-IN",{day:"numeric",month:"long"})}</h3>
              {todayLb.length === 0 ? (
                <div className="text-center py-6 text-gray-400">
                  <p className="text-sm">No one has attempted it yet.</p>
                  <button className="btn-primary mt-3 text-sm" onClick={() => navigate("/daily")}>Be the first to try!</button>
                </div>
              ) : (
                <div className="space-y-2">
                  {todayLb.map((e,i) => (
                    <div key={i} className={`flex items-center justify-between p-3 rounded-lg ${i===0?"border-2":"border"}`}
                      style={i===0?{borderColor:"var(--gold)",background:"#fffbeb"}:{background:"var(--cream)"}}>
                      <div className="flex items-center gap-3">
                        <span className="text-xl">{medals[i] || "#" + (i+1)}</span>
                        <div className="font-bold text-sm">{e.name}</div>
                      </div>
                      <div className="text-right">
                        <div className="font-black text-lg" style={{color:"var(--saffron)"}}>{e.score}/{e.total}</div>
                        <div className="text-xs text-gray-400">{Math.round(e.score/e.total*100)}%</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* All time */}
            <div className="card">
              <h3 className="font-black mb-4" style={{color:"var(--navy)"}}> All Time Top Players</h3>
              {allTimeLb.length === 0 ? (
                <p className="text-center text-gray-400 text-sm py-4">No data available yet.</p>
              ) : (
                <div className="space-y-2">
                  {allTimeLb.slice(0,10).map((e,i) => (
                    <div key={i} className="flex items-center justify-between p-3 rounded-lg" style={{background:"var(--cream)"}}>
                      <div className="flex items-center gap-3">
                        <span className="text-xl">{medals[i] || "#" + (i+1)}</span>
                        <div>
                          <div className="font-bold text-sm">{e.name}</div>
                          <div className="text-xs text-gray-400">Participated on {e.days} days</div>
                        </div>
                      </div>
                      <div className="font-black" style={{color:"var(--navy)"}}>{e.total_score} pts</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
