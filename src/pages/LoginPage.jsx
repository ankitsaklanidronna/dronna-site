import { useEffect, useState } from 'react';
import { BrandMark } from '../components/BrandLockup.jsx';
import { Navbar } from '../components/Navbar.jsx';
import { CONFIG } from '../config/appConfig.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useRouter } from '../context/RouterContext.jsx';
import { supabase } from '../services/supabaseClient.js';
import { normalizeEmail } from '../utils/authStorage.js';

const RECOVERY_STEPS = {
  LOGIN: "login",
  EMAIL: "email",
  CODE: "code",
  PASSWORD: "password"
};

export function LoginPage() {
  const { navigate } = useRouter();
  const { login } = useAuth();
  const [form, setForm] = useState({ email:"", password:"" });
  const [recovery, setRecovery] = useState({ email: "", code: "", password: "", confirmPassword: "" });
  const [recoveryStep, setRecoveryStep] = useState(RECOVERY_STEPS.LOGIN);
  const [recoveryAccessToken, setRecoveryAccessToken] = useState("");
  const [resendSeconds, setResendSeconds] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    if (resendSeconds <= 0) return undefined;
    const timer = window.setInterval(() => {
      setResendSeconds((seconds) => Math.max(0, seconds - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [resendSeconds]);

  const handleLogin = async () => {
    if (!form.email || !form.password) { setError("Please fill in all fields"); return; }
    setLoading(true); setError(""); setSuccess("");
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

  const openPasswordRecovery = () => {
    setRecovery((current) => ({
      ...current,
      email: normalizeEmail(form.email || current.email),
      code: "",
      password: "",
      confirmPassword: ""
    }));
    setRecoveryAccessToken("");
    setRecoveryStep(RECOVERY_STEPS.EMAIL);
    setError("");
    setSuccess("");
  };

  const returnToLogin = ({ keepSuccess = false } = {}) => {
    if (recovery.email) {
      setForm((current) => ({ ...current, email: recovery.email, password: "" }));
    }
    setRecovery((current) => ({ ...current, code: "", password: "", confirmPassword: "" }));
    setRecoveryAccessToken("");
    setRecoveryStep(RECOVERY_STEPS.LOGIN);
    setError("");
    if (!keepSuccess) setSuccess("");
  };

  const handleSendResetCode = async () => {
    const email = normalizeEmail(recovery.email);
    if (!email) {
      setError("Please enter your registered email address.");
      return;
    }

    setLoading(true);
    setError("");
    setSuccess("");
    const result = await supabase.auth.requestPasswordResetCode({ email });

    if (result.error) {
      setError(
        result.status === 429
          ? "Too many requests. Please wait a minute before requesting another code."
          : "We could not send the code right now. Please check your connection and try again."
      );
      setLoading(false);
      return;
    }

    setRecovery((current) => ({ ...current, email, code: "" }));
    setRecoveryStep(RECOVERY_STEPS.CODE);
    setResendSeconds(60);
    setSuccess("If this email is registered, a password reset code has been sent. Please also check Spam.");
    setLoading(false);
  };

  const handleVerifyResetCode = async () => {
    const code = recovery.code.replace(/\D/g, "");
    if (code.length < 6 || code.length > 8) {
      setError("Please enter the complete verification code from your email.");
      return;
    }

    setLoading(true);
    setError("");
    setSuccess("");
    const result = await supabase.auth.verifyPasswordResetCode({
      email: normalizeEmail(recovery.email),
      token: code
    });

    if (result.error || !result.data?.access_token) {
      setError("This code is incorrect or has expired. Please request a new code and try again.");
      setLoading(false);
      return;
    }

    setRecovery((current) => ({ ...current, code: "" }));
    setRecoveryAccessToken(result.data.access_token);
    setRecoveryStep(RECOVERY_STEPS.PASSWORD);
    setSuccess("Email verified. You can now create a new password.");
    setLoading(false);
  };

  const handleUpdatePassword = async () => {
    if (recovery.password.length < 8) {
      setError("Your new password must be at least 8 characters long.");
      return;
    }
    if (recovery.password !== recovery.confirmPassword) {
      setError("The passwords do not match.");
      return;
    }
    if (!recoveryAccessToken) {
      setError("Your verification session has expired. Please request a new code.");
      setRecoveryStep(RECOVERY_STEPS.EMAIL);
      return;
    }

    setLoading(true);
    setError("");
    setSuccess("");
    const result = await supabase.auth.updatePassword({
      accessToken: recoveryAccessToken,
      password: recovery.password
    });

    if (result.error) {
      setError(
        result.status === 401
          ? "Your verification session has expired. Please request a new code."
          : result.error
      );
      if (result.status === 401) {
        setRecoveryAccessToken("");
        setRecoveryStep(RECOVERY_STEPS.EMAIL);
      }
      setLoading(false);
      return;
    }

    await supabase.auth.signOut(recoveryAccessToken);
    setForm({ email: recovery.email, password: "" });
    setRecovery({ email: recovery.email, code: "", password: "", confirmPassword: "" });
    setRecoveryAccessToken("");
    setRecoveryStep(RECOVERY_STEPS.LOGIN);
    setSuccess("Password changed successfully. Log in with your new password.");
    setLoading(false);
  };

  const recoveryTitle = {
    [RECOVERY_STEPS.EMAIL]: "Forgot your password?",
    [RECOVERY_STEPS.CODE]: "Verify your email",
    [RECOVERY_STEPS.PASSWORD]: "Create a new password"
  }[recoveryStep];

  const recoverySubtitle = {
    [RECOVERY_STEPS.EMAIL]: "Enter your registered email to receive a reset code",
    [RECOVERY_STEPS.CODE]: `Enter the code sent to ${recovery.email}`,
    [RECOVERY_STEPS.PASSWORD]: "Choose a strong password for your Dronna account"
  }[recoveryStep];

  return (
    <div className="min-h-screen flex flex-col" style={{background:"var(--cream)"}}>
      <Navbar />
      <div className="flex-1 flex items-center justify-center p-4">
        <div className="w-full max-w-md fade-in">
          <div className="card">
            <div className="text-center mb-8">
              <BrandMark size={56} className="mx-auto mb-4" />
              <h1 className="text-2xl font-black" style={{color:"var(--navy)"}}>
                {recoveryStep === RECOVERY_STEPS.LOGIN ? "Log in to Dronna" : recoveryTitle}
              </h1>
              <p className="text-gray-400 text-sm mt-1">
                {recoveryStep === RECOVERY_STEPS.LOGIN ? "Continue your preparation" : recoverySubtitle}
              </p>
            </div>
            {error && <div role="alert" className="bg-red-50 border border-red-200 text-red-600 rounded-lg p-3 mb-4 text-sm">{error}</div>}
            {success && <div role="status" className="bg-green-50 border border-green-200 text-green-700 rounded-lg p-3 mb-4 text-sm">{success}</div>}

            {recoveryStep === RECOVERY_STEPS.LOGIN && (
              <>
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
                    <div className="flex items-center justify-between gap-3">
                      <label htmlFor="login-password">Password</label>
                      <button
                        type="button"
                        className="text-sm font-bold text-orange-500 hover:text-orange-600"
                        onClick={openPasswordRecovery}
                      >
                        Forgot Password?
                      </button>
                    </div>
                    <input
                      id="login-password"
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
              </>
            )}

            {recoveryStep === RECOVERY_STEPS.EMAIL && (
              <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); handleSendResetCode(); }}>
                <div>
                  <label htmlFor="recovery-email">Registered email</label>
                  <input
                    id="recovery-email"
                    type="email"
                    name="recovery-email"
                    autoComplete="email"
                    inputMode="email"
                    autoFocus
                    placeholder="your@email.com"
                    value={recovery.email}
                    onChange={(event) => setRecovery({ ...recovery, email: event.target.value })}
                  />
                </div>
                <button type="submit" className="btn-primary w-full justify-center py-3" disabled={loading}>
                  {loading ? "Sending code..." : "Send Reset Code"}
                </button>
                <button type="button" className="btn-outline w-full justify-center py-3" onClick={() => returnToLogin()} disabled={loading}>
                  Back to Login
                </button>
              </form>
            )}

            {recoveryStep === RECOVERY_STEPS.CODE && (
              <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); handleVerifyResetCode(); }}>
                <div>
                  <label htmlFor="recovery-code">Verification code</label>
                  <input
                    id="recovery-code"
                    type="text"
                    name="one-time-code"
                    autoComplete="one-time-code"
                    inputMode="numeric"
                    autoFocus
                    placeholder="Enter email code"
                    maxLength={8}
                    value={recovery.code}
                    onChange={(event) => setRecovery({ ...recovery, code: event.target.value.replace(/\D/g, "").slice(0, 8) })}
                    className="text-center text-xl font-bold tracking-widest"
                  />
                  <p className="text-xs text-gray-400 mt-2">The code is single-use and expires automatically.</p>
                </div>
                <button type="submit" className="btn-primary w-full justify-center py-3" disabled={loading}>
                  {loading ? "Verifying..." : "Verify Code"}
                </button>
                <div className="flex items-center justify-between gap-3 text-sm">
                  <button
                    type="button"
                    className="font-bold text-orange-500 disabled:text-gray-300"
                    disabled={loading || resendSeconds > 0}
                    onClick={handleSendResetCode}
                  >
                    {resendSeconds > 0 ? `Resend in ${resendSeconds}s` : "Resend code"}
                  </button>
                  <button type="button" className="font-bold text-gray-500" onClick={() => setRecoveryStep(RECOVERY_STEPS.EMAIL)} disabled={loading}>
                    Change email
                  </button>
                </div>
                <button type="button" className="btn-outline w-full justify-center py-3" onClick={() => returnToLogin()} disabled={loading}>
                  Back to Login
                </button>
              </form>
            )}

            {recoveryStep === RECOVERY_STEPS.PASSWORD && (
              <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); handleUpdatePassword(); }}>
                <div>
                  <label htmlFor="new-password">New password</label>
                  <input
                    id="new-password"
                    type="password"
                    name="new-password"
                    autoComplete="new-password"
                    autoFocus
                    placeholder="At least 8 characters"
                    minLength={8}
                    value={recovery.password}
                    onChange={(event) => setRecovery({ ...recovery, password: event.target.value })}
                  />
                </div>
                <div>
                  <label htmlFor="confirm-password">Confirm new password</label>
                  <input
                    id="confirm-password"
                    type="password"
                    name="confirm-password"
                    autoComplete="new-password"
                    placeholder="Enter the new password again"
                    minLength={8}
                    value={recovery.confirmPassword}
                    onChange={(event) => setRecovery({ ...recovery, confirmPassword: event.target.value })}
                  />
                </div>
                <button type="submit" className="btn-primary w-full justify-center py-3" disabled={loading}>
                  {loading ? "Updating password..." : "Change Password"}
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
