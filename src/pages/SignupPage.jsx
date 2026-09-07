import { useState } from 'react';
import { BrandMark } from '../components/BrandLockup.jsx';
import { Navbar } from '../components/Navbar.jsx';
import { CONFIG } from '../config/appConfig.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useRouter } from '../context/RouterContext.jsx';
import { SB_HEADERS, supabase } from '../services/supabaseClient.js';
import { normalizeEmail } from '../utils/authStorage.js';

export function SignupPage() {
  const { navigate } = useRouter();
  const { login } = useAuth();
  const [form, setForm] = useState({ name:"", email:"", password:"", exam_target:"UKPSC", ai_coach_language:"hindi" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSignup = async () => {
    if (!form.name || !form.email || !form.password) { setError("Please fill in all fields"); return; }
    if (form.password.length < 6) { setError(" Password must be at least 6 characters long"); return; }
    setLoading(true); setError("");
    const normalizedEmail = normalizeEmail(form.email);
    const runSecureSignup = async () => {
      const r = await fetch(`${CONFIG.SUPABASE_URL}/auth/v1/signup`, {
        method: "POST",
        headers: { "apikey": CONFIG.SUPABASE_ANON_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ email: normalizedEmail, password: form.password })
      });
      const res = await r.json();

      if (!r.ok || res.error || res.error_code) {
        if (res.error?.includes("already") || res.msg?.includes("already")) {
          setError("This email is already registered. Please login.");
        } else {
          setError(res.error_description || res.msg || res.error || "Signup failed");
        }
        setLoading(false);
        return true;
      }

      let authUserId = res.user?.id || res.id || null;
      let sessionAccessToken = res.access_token || res.session?.access_token || null;
      let sessionRefreshToken = res.refresh_token || res.session?.refresh_token || null;

      if (!sessionAccessToken) {
        const sessionRes = await supabase.auth.signIn({ email: normalizedEmail, password: form.password });
        if (sessionRes?.error || !sessionRes?.access_token) {
          setError("Signup completed, but a secure login session could not be created. Please log in and try again.");
          setLoading(false);
          return true;
        }
        sessionAccessToken = sessionRes.access_token;
        sessionRefreshToken = sessionRes.refresh_token || null;
        authUserId = authUserId || sessionRes.user?.id || null;
      }

      const studentInsert = await supabase.insert("students", {
        auth_user_id: authUserId,
        full_name: form.name,
        email: normalizedEmail,
        exam_target: form.exam_target,
        ai_coach_language: form.ai_coach_language,
        subscription_plan: "free"
      }, { accessToken: sessionAccessToken });
      if (studentInsert.error) {
        setError("Signup completed, but the student record could not be saved: " + studentInsert.error);
        setLoading(false);
        return true;
      }

      await supabase.sendWelcomeEmail({
        name: form.name,
        exam_target: form.exam_target
      }, sessionAccessToken);

      await login({
        email: normalizedEmail,
        name: form.name,
        exam_target: form.exam_target,
        ai_coach_language: form.ai_coach_language,
        subscription_plan: "free",
        auth_id: authUserId,
        access_token: sessionAccessToken,
        refresh_token: sessionRefreshToken
      });
      navigate("/dashboard");
      setLoading(false);
      return true;
    };

    try {
      // Step 1: Pehle check karo  kya ye email pehle se registered hai?
      const checkRes = await fetch(
        `${CONFIG.SUPABASE_URL}/rest/v1/students?email=eq.${encodeURIComponent(normalizedEmail)}&select=email&apikey=${CONFIG.SUPABASE_ANON_KEY}`,
        { headers: SB_HEADERS }
      );
      const existing = await checkRes.json();
      if (Array.isArray(existing) && existing.length > 0) {
        setError(" This email is already registered  please Login");
        setLoading(false); return;
      }

      // Step 2: Supabase Auth mein signup karo
      const r = await fetch(`${CONFIG.SUPABASE_URL}/auth/v1/signup`, {
        method: "POST",
        headers: { "apikey": CONFIG.SUPABASE_ANON_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ email: normalizedEmail, password: form.password })
      });
      const res = await r.json();

      // Supabase Auth error check
      if (!r.ok || res.error || res.error_code) {
        if (res.error?.includes("already") || res.msg?.includes("already")) {
          setError(" This email is already registered  please Login");
        } else {
          setError(" " + (res.error_description || res.msg || res.error || "Signup failed"));
        }
        setLoading(false); return;
      }

      let authUserId = res.user?.id || res.id || null;
      let sessionAccessToken = res.access_token || res.session?.access_token || null;
      let sessionRefreshToken = res.refresh_token || res.session?.refresh_token || null;

      if (!sessionAccessToken) {
        const sessionRes = await supabase.auth.signIn({ email: normalizedEmail, password: form.password });
        if (sessionRes?.error || !sessionRes?.access_token) {
          setError(" Signup completed, but a secure login session could not be created. Please log in and try again.");
          setLoading(false); return;
        }
        sessionAccessToken = sessionRes.access_token;
        sessionRefreshToken = sessionRes.refresh_token || null;
        authUserId = authUserId || sessionRes.user?.id || null;
      }

      // Step 3: Students table mein save karo
      const studentInsert = await supabase.insert("students", {
        auth_user_id: authUserId,
        full_name: form.name,
        email: normalizedEmail,
        exam_target: form.exam_target,
        ai_coach_language: form.ai_coach_language,
        subscription_plan: "free"
      }, { accessToken: sessionAccessToken });
      if (studentInsert.error) {
        setError(" Signup completed, but the student record could not be saved: " + studentInsert.error);
        setLoading(false); return;
      }

      await supabase.sendWelcomeEmail({
        name: form.name,
        exam_target: form.exam_target
      }, sessionAccessToken);

      await login({
        email: normalizedEmail,
        name: form.name,
        exam_target: form.exam_target,
        ai_coach_language: form.ai_coach_language,
        subscription_plan: "free",
        auth_id: authUserId,
        access_token: sessionAccessToken,
        refresh_token: sessionRefreshToken
      });
      navigate("/dashboard");

    } catch(e) {
      setError(" Network error  please check your internet connection");
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex flex-col" style={{background:"var(--cream)"}}>
      <Navbar />
      <div className="flex-1 flex items-center justify-center p-4">
        <div className="w-full max-w-md fade-in">
          <div className="card">
            <div className="text-center mb-8">
              <BrandMark size={56} className="mx-auto mb-4" />
              <h1 className="text-2xl font-black" style={{color:"var(--navy)"}}>Create a Free Account</h1>
              <p className="text-gray-400 text-sm mt-1">No credit card required</p>
            </div>
            {error && <div className="bg-red-50 border border-red-200 text-red-600 rounded-lg p-3 mb-4 text-sm">{error}</div>}
            <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); handleSignup(); }}>
              <div>
                <label>Full Name</label>
                <input
                  type="text"
                  name="name"
                  autoComplete="name"
                  placeholder="Your name"
                  value={form.name}
                  onChange={e=>setForm({...form,name:e.target.value})}
                />
              </div>
              <div>
                <label>Email</label>
                <input
                  type="email"
                  name="email"
                  autoComplete="username"
                  inputMode="email"
                  placeholder="your@email.com"
                  value={form.email}
                  onChange={e=>setForm({...form,email:e.target.value})}
                />
              </div>
              <div>
                <label>Create a New Password for Dronna</label>
                <input
                  type="password"
                  name="new-password"
                  autoComplete="new-password"
                  placeholder="Enter a new password (at least 6 characters)"
                  value={form.password}
                  onChange={e=>setForm({...form,password:e.target.value})}
                />
                <p className="text-xs text-gray-400 mt-1"> This is not your email password. Create a separate password for Dronna.</p>
              </div>
              <div>
                <label>Target Exam</label>
                <select name="exam_target" autoComplete="off" value={form.exam_target} onChange={e=>setForm({...form,exam_target:e.target.value})}>
                  <option value="UKPSC">UKPSC (LT Grade / PCS / Lecturer)</option>
                  <option value="UKSSSC">UKSSSC (Group C / VDO / Forest Guard)</option>
                  <option value="Both">Preparing for Both</option>
                </select>
              </div>
              <div>
                <label>AI Coach Language</label>
                <select name="ai_coach_language" autoComplete="off" value={form.ai_coach_language} onChange={e=>setForm({...form,ai_coach_language:e.target.value})}>
                  <option value="hindi">Hindi (Devanagari)</option>
                  <option value="english">English</option>
                </select>
              </div>
              <button type="submit" className="btn-primary w-full justify-center py-3" disabled={loading}>
                {loading ? "Creating account..." : " Create Free Account"}
              </button>
            </form>
            <p className="text-center text-sm text-gray-500 mt-4">
              Already have an account? <span className="text-orange-500 font-bold cursor-pointer" onClick={()=>navigate("/login")}>Log In</span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
