import { useState } from 'react';
import { BrandMark } from '../components/BrandLockup.jsx';
import { Navbar } from '../components/Navbar.jsx';
import { CONFIG } from '../config/appConfig.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useRouter } from '../context/RouterContext.jsx';
import { normalizeEmail } from '../utils/authStorage.js';

export function LoginPage() {
  const { navigate } = useRouter();
  const { login } = useAuth();
  const [form, setForm] = useState({ email:"", password:"" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleLogin = async () => {
    if (!form.email || !form.password) { setError("Please fill in all fields"); return; }
    setLoading(true); setError("");
    const normalizedEmail = normalizeEmail(form.email);

    // DEFAULT  login band hai jab tak Supabase confirm na kare
    let loginAllowed = false;
    let userData = null;

    try {
      const r = await fetch(`${CONFIG.SUPABASE_URL}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: { "apikey": CONFIG.SUPABASE_ANON_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ email: normalizedEmail, password: form.password })
      });

      const res = await r.json();

      // Sirf tab allow karo jab HTTP 200 aaye AND access_token mile
      if (r.status === 200 && res.access_token && !res.error) {
        // Profile fetch karo
        try {
          const profRes = await fetch(
            `${CONFIG.SUPABASE_URL}/rest/v1/students?email=eq.${encodeURIComponent(normalizedEmail)}&select=*&apikey=${CONFIG.SUPABASE_ANON_KEY}`,
            { headers: { "apikey": CONFIG.SUPABASE_ANON_KEY, "Authorization": `Bearer ${res.access_token}` } }
          );
          const students = await profRes.json();
          const profile = Array.isArray(students) && students[0] ? students[0] : null;
          userData = {
            email: normalizedEmail,
            name: profile?.full_name || normalizedEmail.split("@")[0],
            exam_target: profile?.exam_target || "UKPSC",
            ai_coach_language: profile?.ai_coach_language || "hindi",
            subscription_plan: profile?.subscription_plan || "free",
            auth_id: res.user?.id,
            access_token: res.access_token,
            refresh_token: res.refresh_token
          };
        } catch {
          userData = {
            email: normalizedEmail,
            name: normalizedEmail.split("@")[0],
            exam_target:"UKPSC",
            ai_coach_language:"hindi",
            subscription_plan:"free",
            auth_id: res.user?.id,
            access_token: res.access_token,
            refresh_token: res.refresh_token
          };
        }
        loginAllowed = true;
      } else {
        // Wrong password ya email
        setError("Incorrect email or password");
      }
    } catch(e) {
      setError("Network error. Please check your internet connection.");
    }

    // STRICT  sirf tabhi login karo jab explicitly allowed ho
    if (loginAllowed && userData) {
      try {
        await login(userData);
        navigate("/dashboard");
      } catch {
        setError("We could not finish setting up your session. Please try again.");
      }
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
              <h1 className="text-2xl font-black" style={{color:"var(--navy)"}}>Log in to Dronna</h1>
              <p className="text-gray-400 text-sm mt-1">Continue your preparation</p>
            </div>
            {error && <div className="bg-red-50 border border-red-200 text-red-600 rounded-lg p-3 mb-4 text-sm">{error}</div>}
            <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); handleLogin(); }}>
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
                <label>Password</label>
                <input
                  type="password"
                  name="password"
                  autoComplete="current-password"
                  placeholder="........"
                  value={form.password}
                  onChange={e=>setForm({...form,password:e.target.value})}
                />
              </div>
              <button type="submit" className="btn-primary w-full justify-center py-3" disabled={loading}>
                {loading ? "Logging in..." : "Log In"}
              </button>
            </form>
            <p className="text-center text-sm text-gray-500 mt-4">
              Don't have an account? <span className="text-orange-500 font-bold cursor-pointer" onClick={()=>navigate("/signup")}>Sign Up</span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
