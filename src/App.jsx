import { useEffect } from 'react';
import { BrandMark } from './components/BrandLockup.jsx';
import { useAuth } from './context/AuthContext.jsx';
import { getRoutePath, getRouteSearchParams, useRouter } from './context/RouterContext.jsx';
import { trackVisit } from './services/visitorStats.js';
import { isDemoSetId } from './utils/demoData.js';
import {
  AdminPanel,
  DailyChallenge,
  Dashboard,
  DemoPage,
  EbookStorePage,
  LeaderboardPage,
  LoginPage,
  PracticePage,
  ProfilePage,
  QuizPage,
  SignupPage,
  SimpleLandingPage,
  SyllabusPage,
} from './pages/index.js';

function App() {
  const { page } = useRouter();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (loading) return;
    trackVisit(page, user);
  }, [page, user?.isAdmin, loading]);

  if (loading) return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-8" style={{background:"var(--navy)"}}>
      <div style={{animation:"mountainRise 0.6s ease forwards", opacity:0, animationDelay:"0.1s"}}>
        <BrandMark size={72} className="shadow-2xl" />
      </div>

      <div className="flex items-end gap-1" style={{letterSpacing:"0.08em"}}>
        {["D","R","O","N","N","A"].map((ch, i) => (
          <span
            key={i}
            className="dronna-letter font-headline font-black"
            style={{
              fontSize: "clamp(32px, 8vw, 52px)",
              color: i === 0 || i === 5 ? "#F97316" : "white",
              animationDelay: `${0.15 + i * 0.1}s`
            }}
          >
            {ch}
          </span>
        ))}
      </div>

      <div style={{width:"160px", background:"rgba(255,255,255,0.1)", borderRadius:"999px", overflow:"hidden", animationDelay:"0.9s", opacity:0, animation:"mountainRise 0.4s ease 0.9s forwards"}}>
        <div className="loader-bar" style={{animationDuration:"1.6s"}}></div>
      </div>

      <p className="font-hindi text-sm font-medium" style={{color:"rgba(255,255,255,0.35)", animation:"mountainRise 0.4s ease 1.1s forwards", opacity:0}}>
        UKPSC & UKSSSC Exam Preparation
      </p>
    </div>
  );

  const routePath = getRoutePath(page);
  const routeParams = getRouteSearchParams(page);
  const quizMatch = routePath.match(/^\/quiz\/(.+)$/);
  if (quizMatch) return (user || isDemoSetId(quizMatch[1]) || routeParams.get("demo") === "1") ? <QuizPage setId={quizMatch[1]} /> : <LoginPage />;

  switch (routePath) {
    case "/": return routeParams.has("course") || routeParams.has("folder") ? <SimpleLandingPage /> : user ? <Dashboard /> : <SimpleLandingPage />;
    case "/choose-course":
    case "/free-practice":
      return user ? <Dashboard /> : <SimpleLandingPage />;
    case "/demo": return <DemoPage />;
    case "/login": return user ? <Dashboard /> : <LoginPage />;
    case "/signup": return user ? <Dashboard /> : <SignupPage />;
    case "/dashboard": return user ? <Dashboard /> : <LoginPage />;
    case "/practice": return user ? <PracticePage /> : <LoginPage />;
    case "/profile": return user ? <ProfilePage /> : <LoginPage />;
    case "/daily": return <DailyChallenge />;
    case "/leaderboard": return <LeaderboardPage />;
    case "/syllabus": return <SyllabusPage />;
    case "/ebooks": return <EbookStorePage />;
    case "/admin": return <AdminPanel />;
    default: return (
      <div className="min-h-screen flex items-center justify-center" style={{background:"var(--cream)"}}>
        <div className="text-center">
          <div className="text-6xl mb-4"></div>
          <h2 className="text-2xl font-black mb-2" style={{color:"var(--navy)"}}>Page not found</h2>
          <button className="btn-primary mt-4" onClick={() => window.location.hash = "/"}>Go Home</button>
        </div>
      </div>
    );
  }
}

export default App;
