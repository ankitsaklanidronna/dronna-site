import { useEffect, useState } from 'react';
import { Navbar } from '../components/Navbar.jsx';
import { CONFIG } from '../config/appConfig.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useRouter } from '../context/RouterContext.jsx';
import { supabase } from '../services/supabaseClient.js';
import { normalizeAttemptRecord, readStoredAttempts } from '../utils/attempts.js';

const COACH_LANGUAGE_OPTIONS = [
  { value: "hindi", label: "Hindi (Devanagari)" },
  { value: "english", label: "English" },
];

export function ProfilePage() {
  const { navigate } = useRouter();
  const { user, login, logout } = useAuth();

  const [tab, setTab] = useState("profile"); // "profile" | "password"
  const [form, setForm] = useState({
    name: user?.name || "",
    exam_target: user?.exam_target || "UKPSC",
    ai_coach_language: user?.ai_coach_language || "hindi",
  });
  const [pwForm, setPwForm] = useState({ current: "", newPw: "", confirm: "" });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState({ type:"", text:"" });
  const [attempts, setAttempts] = useState([]);

  useEffect(() => {
    // Load attempt history for stats
    const local = readStoredAttempts();
    if (!user?.email) {
      setAttempts(local);
      return;
    }
    // Also try DB with the logged-in user's token
    supabase.getStudentAttempts(user.email, user?.access_token, "desc")
      .then(data => {
        const normalized = Array.isArray(data)
          ? data.map((attempt) => normalizeAttemptRecord(attempt)).filter(Boolean)
          : [];
        setAttempts(normalized.length > 0 ? normalized : local);
      })
      .catch(() => setAttempts(local));
  }, [user?.email, user?.access_token]);

  useEffect(() => {
    setForm({
      name: user?.name || "",
      exam_target: user?.exam_target || "UKPSC",
      ai_coach_language: user?.ai_coach_language || "hindi",
    });
  }, [user?.name, user?.exam_target, user?.ai_coach_language]);

  const showMsg = (type, text) => {
    setMsg({ type, text });
    setTimeout(() => setMsg({ type:"", text:"" }), 3500);
  };

  //  Save Profile 
  const saveProfile = async () => {
    if (!form.name.trim()) { showMsg("error", " Name cannot be empty"); return; }
    setSaving(true);
    try {
      const result = await supabase.updateStudentData(user.email, {
        full_name: form.name.trim(),
        exam_target: form.exam_target,
        ai_coach_language: form.ai_coach_language
      }, user?.access_token);
      if (result?.error) {
        throw new Error(result.error);
      }
      // localStorage bhi update karo
      await login({
        ...user,
        name: form.name.trim(),
        exam_target: form.exam_target,
        ai_coach_language: form.ai_coach_language
      });
      showMsg("success", " Profile updated successfully!");
    } catch(e) { showMsg("error", " Could not save  please try again"); }
    setSaving(false);
  };

  //  Change Password 
  const changePassword = async () => {
    if (!pwForm.current || !pwForm.newPw) { showMsg("error", " Please fill all fields"); return; }
    if (pwForm.newPw.length < 6) { showMsg("error", " New password must be at least 6 characters"); return; }
    if (pwForm.newPw !== pwForm.confirm) { showMsg("error", " New password and confirm password do not match"); return; }
    setSaving(true);
    try {
      // Step 1: Verify current password by re-logging in
      const verifyRes = await fetch(`${CONFIG.SUPABASE_URL}/auth/v1/token?grant_type=password`, {
        method:"POST",
        headers: { "apikey": CONFIG.SUPABASE_ANON_KEY, "Content-Type":"application/json" },
        body: JSON.stringify({ email: user.email, password: pwForm.current })
      });
      const verifyData = await verifyRes.json();
      if (!verifyRes.ok || !verifyData.access_token) {
        showMsg("error", " Current password is incorrect"); setSaving(false); return;
      }
      // Step 2: Update password using access token
      const updateRes = await fetch(`${CONFIG.SUPABASE_URL}/auth/v1/user`, {
        method:"PUT",
        headers: { "apikey": CONFIG.SUPABASE_ANON_KEY, "Content-Type":"application/json", "Authorization": `Bearer ${verifyData.access_token}` },
        body: JSON.stringify({ password: pwForm.newPw })
      });
      if (updateRes.ok) {
        setPwForm({ current:"", newPw:"", confirm:"" });
        showMsg("success", " Password updated! Use your new password next time you login");
      } else {
        const err = await updateRes.json();
        showMsg("error", " " + (err.message || "Password could not be updated"));
      }
    } catch(e) { showMsg("error", " Network problem"); }
    setSaving(false);
  };

  // Stats
  const totalTests = attempts.length;
  const avgScore = totalTests > 0
    ? Math.round(attempts.reduce((a,b) => a + ((b.score/(b.total_questions||b.total||1))*100), 0) / totalTests)
    : 0;
  const bestScore = totalTests > 0
    ? Math.max(...attempts.map(a => Math.round((a.score/(a.total_questions||a.total||1))*100)))
    : 0;

  // Avatar color based on name
  const avatarColors = ["var(--saffron-dark)","#1565C0","#2E7D32","#6A1B9A","#00838F"];
  const colorIdx = (user?.name?.charCodeAt(0) || 0) % avatarColors.length;

  return (
    <div className="min-h-screen" style={{background:"#FAFAFA"}}>
      <Navbar />

      <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">

        {/*  Header Card  */}
        <div className="rounded-2xl overflow-hidden shadow-lg">
          {/* Cover */}
          <div className="h-28 relative" style={{background:"linear-gradient(135deg, var(--navy) 0%, #1a3a6e 60%, var(--saffron-dark) 100%)"}}>
            <div className="absolute inset-0 opacity-10" style={{backgroundImage:"radial-gradient(rgba(255,255,255,0.8) 1px, transparent 1px)", backgroundSize:"20px 20px"}}></div>
          </div>
          {/* Avatar + Info */}
          <div className="bg-white px-6 pb-6">
            <div className="flex items-end justify-between -mt-10 mb-4">
              <div className="w-20 h-20 rounded-2xl border-4 border-white shadow-xl flex items-center justify-center text-3xl font-black text-white"
                style={{background: avatarColors[colorIdx]}}>
                {user?.name?.[0]?.toUpperCase() || "?"}
              </div>
              <span className={`px-3 py-1 rounded-full text-xs font-black ${user?.subscription_plan === "pro" ? "bg-yellow-100 text-yellow-700" : "bg-gray-100 text-gray-600"}`}>
                {user?.subscription_plan?.toUpperCase() || "FREE"}
              </span>
            </div>
            <h1 className="text-2xl font-black text-navy">{user?.name}</h1>
            <p className="text-gray-400 text-sm">{user?.email}</p>
            <p className="text-sm mt-1 font-medium" style={{color:"var(--saffron-dark)"}}> Target: {user?.exam_target}</p>
            <p className="text-xs mt-1 font-bold text-gray-400">
              AI Coach: {COACH_LANGUAGE_OPTIONS.find(option => option.value === (user?.ai_coach_language || "hindi"))?.label || "Hindi (Devanagari)"}
            </p>
          </div>
        </div>

        {/*  Stats Row  */}
        <div className="grid grid-cols-3 gap-4">
          {[
            { label:"Tests Taken", value: totalTests, icon:"" },
            { label:"Avg Score", value: totalTests > 0 ? avgScore+"%" : "", icon:"" },
            { label:"Best Score", value: totalTests > 0 ? bestScore+"%" : "", icon:"" },
          ].map(s => (
            <div key={s.label} className="bg-white rounded-2xl p-5 text-center shadow-sm border" style={{borderColor:"#EEEEEE"}}>
              <div className="text-2xl mb-1">{s.icon}</div>
              <div className="text-2xl font-black" style={{color:"var(--navy)"}}>{s.value}</div>
              <div className="text-xs font-bold text-gray-400 mt-1 uppercase tracking-wide">{s.label}</div>
            </div>
          ))}
        </div>

        {/*  Tabs  */}
        <div className="bg-white rounded-2xl shadow-sm border overflow-hidden" style={{borderColor:"#EEEEEE"}}>
          <div className="flex border-b" style={{borderColor:"#EEEEEE"}}>
            {[
              { id:"profile", label:" Profile Edit" },
              { id:"password", label:" Password" },
            ].map(t => (
              <button key={t.id}
                onClick={() => { setTab(t.id); setMsg({type:"",text:""}); }}
                className={`flex-1 py-4 text-sm font-black transition-all ${
                  tab === t.id
                    ? "border-b-2 text-orange-600"
                    : "text-gray-400 hover:text-gray-600"
                }`}
                style={tab === t.id ? {borderColor:"var(--saffron-dark)"} : {}}>
                {t.label}
              </button>
            ))}
          </div>

          <div className="p-6">
            {/* Message */}
            {msg.text && (
              <div className={`mb-4 p-3 rounded-xl text-sm font-medium ${
                msg.type === "success" ? "bg-green-50 text-green-700 border border-green-200" : "bg-red-50 text-red-600 border border-red-200"
              }`}>{msg.text}</div>
            )}

            {/*  Profile Tab  */}
            {tab === "profile" && (
              <div className="space-y-5">
                <div>
                  <label> Full Name</label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={e => setForm({...form, name: e.target.value})}
                    placeholder="Enter your name"
                  />
                </div>
                <div>
                  <label> Email (cannot be changed)</label>
                  <input type="email" value={user?.email} disabled
                    style={{background:"#F5F5F5", color:"#9E9E9E", cursor:"not-allowed"}} />
                  <p className="text-xs text-gray-400 mt-1">Contact the admin if you need to change your email.</p>
                </div>
                <div>
                  <label> Target Exam</label>
                  <select value={form.exam_target} onChange={e => setForm({...form, exam_target: e.target.value})}>
                    <option value="UKPSC">UKPSC (LT Grade / PCS / Lecturer)</option>
                    <option value="UKSSSC">UKSSSC (Group C / VDO / Forest Guard)</option>
                    <option value="Both">Preparing for Both</option>
                  </select>
                </div>
                <div>
                  <label> AI Coach Language</label>
                  <select value={form.ai_coach_language} onChange={e => setForm({...form, ai_coach_language: e.target.value})}>
                    {COACH_LANGUAGE_OPTIONS.map(option => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </div>
                <button
                  onClick={saveProfile}
                  disabled={saving}
                  className="btn-primary w-full justify-center py-3">
                  {saving ? " Saving..." : " Save Profile"}
                </button>

                <div className="pt-4 border-t border-dashed border-gray-100">
                  <button
                    onClick={() => { if(confirm("Are you sure you want to logout?")) { logout(); navigate("/"); } }}
                    className="w-full py-3 rounded-xl font-bold text-red-500 border-2 border-red-100 hover:bg-red-50 transition-all text-sm">
                     Logout
                  </button>
                </div>
              </div>
            )}

            {/*  Password Tab  */}
            {tab === "password" && (
              <div className="space-y-5">
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-3">
                  <p className="text-xs text-blue-700 font-medium"> Your current password will be verified before the new one is set.</p>
                </div>
                <div>
                  <label> Current Password</label>
                  <input
                    type="password"
                    placeholder="Your current password"
                    value={pwForm.current}
                    onChange={e => setPwForm({...pwForm, current: e.target.value})}
                  />
                </div>
                <div>
                  <label> New Password</label>
                  <input
                    type="password"
                    placeholder="New password (at least 6 characters)"
                    value={pwForm.newPw}
                    onChange={e => setPwForm({...pwForm, newPw: e.target.value})}
                  />
                </div>
                <div>
                  <label> Confirm New Password</label>
                  <input
                    type="password"
                    placeholder="Confirm new password"
                    value={pwForm.confirm}
                    onChange={e => setPwForm({...pwForm, confirm: e.target.value})}
                    onKeyDown={e => e.key === "Enter" && changePassword()}
                  />
                  {pwForm.confirm && pwForm.newPw && (
                    <p className={`text-xs mt-1 font-bold ${pwForm.newPw === pwForm.confirm ? "text-green-600" : "text-red-500"}`}>
                      {pwForm.newPw === pwForm.confirm ? " Passwords match" : " Passwords do not match"}
                    </p>
                  )}
                </div>
                <button
                  onClick={changePassword}
                  disabled={saving || pwForm.newPw !== pwForm.confirm || !pwForm.current}
                  className={`w-full py-3 rounded-xl font-bold transition-all ${
                    !saving && pwForm.newPw === pwForm.confirm && pwForm.current
                      ? "btn-navy"
                      : "bg-gray-200 text-gray-400 cursor-not-allowed"
                  }`}>
                  {saving ? " Updating..." : " Change Password"}
                </button>
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
