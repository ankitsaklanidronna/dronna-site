import { useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { getRoutePath, getRouteSearchParams, useRouter } from '../context/RouterContext.jsx';
import { BrandLockup } from './BrandLockup.jsx';

export function Navbar({ transparent = false }) {
  const { page, navigate } = useRouter();
  const { user, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  const bg = transparent ? "bg-transparent" : "bg-white shadow-sm";
  const textCol = transparent ? "text-white" : "text-gray-800";
  const routePath = getRoutePath(page);
  const routeParams = getRouteSearchParams(page);
  const isMyCourseView = routePath === "/practice" && (routeParams.has("folder") || routeParams.has("mine"));
  const authedNavItems = [
    { label: "Course Store", path: "/practice", active: routePath === "/practice" && !isMyCourseView },
    { label: "Dashboard", path: "/dashboard", active: routePath === "/dashboard" || routePath === "/" },
    { label: "My Course", path: "/practice?mine=1", active: isMyCourseView },
    { label: "Daily", path: "/daily", active: routePath === "/daily" },
    { label: "Leaderboard", path: "/leaderboard", active: routePath === "/leaderboard" },
    { label: "Syllabus", path: "/syllabus", active: routePath === "/syllabus" },
    ...(user?.isAdmin ? [{ label: "Admin", path: "/admin", active: routePath === "/admin", admin: true }] : [])
  ];

  return (
    <nav className={`${bg} sticky top-0 z-50 ${!transparent ? "border-b border-gray-100" : ""}`}>
      <div className="max-w-6xl mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-3">
        <BrandLockup
          logoSize={34}
          textClassName="text-xl"
          textColorClassName={transparent ? "text-white" : "text-navy"}
          onClick={() => navigate(user ? "/dashboard" : "/")}
        />

        <div className="hidden md:flex flex-1 min-w-0 items-center justify-end gap-2">
          {!user && <>
            <span className={`nav-link ${textCol}`} onClick={() => navigate("/demo")}>Demo</span>
            <span className={`nav-link ${textCol}`} onClick={() => navigate("/syllabus")}>Syllabus</span>
            <span className={`nav-link ${textCol}`} onClick={() => navigate("/login")}>Login</span>
            <button className="btn-primary" onClick={() => navigate("/signup")}>Start Free</button>
          </>}
          {user && <>
            <div className="flex min-w-0 flex-wrap items-center justify-end gap-x-2 gap-y-1 whitespace-nowrap lg:gap-x-3">
              {authedNavItems.map((item) => (
                <span
                  key={item.label}
                  className={`nav-link border-b-2 pb-1 text-center ${
                    item.active || item.admin ? "border-saffron-dark text-saffron-dark" : "border-transparent text-gray-700"
                  }`}
                  onClick={() => navigate(item.path)}
                >
                  {item.label}
                </span>
              ))}
            </div>
            <div className="flex shrink-0 items-center gap-2 ml-2">
              <div className="w-8 h-8 rounded-full flex items-center justify-center bg-saffron text-white font-bold text-sm cursor-pointer hover:opacity-80 transition-all" onClick={() => navigate("/profile")} title="Profile">{user.name?.[0]?.toUpperCase() || "U"}</div>
              <button className="btn-outline text-sm py-1 px-3" onClick={logout}>Logout</button>
            </div>
          </>}
        </div>

        <button className={`md:hidden text-sm font-bold ${textCol}`} onClick={() => setMenuOpen(!menuOpen)}>
          {menuOpen ? "Close" : "Menu"}
        </button>
      </div>

      {menuOpen && (
        <div className="md:hidden bg-white border-t px-4 pb-4 flex flex-col gap-2">
          {!user && <>
            <span className="nav-link text-gray-700" onClick={() => { navigate("/demo"); setMenuOpen(false); }}>Demo</span>
            <span className="nav-link text-gray-700" onClick={() => { navigate("/syllabus"); setMenuOpen(false); }}>Syllabus</span>
            <span className="nav-link text-gray-700" onClick={() => { navigate("/login"); setMenuOpen(false); }}>Login</span>
            <button className="btn-primary w-full justify-center" onClick={() => { navigate("/signup"); setMenuOpen(false); }}>Start Free</button>
          </>}
          {user && <>
            {authedNavItems.map((item) => (
              <span
                key={item.label}
                className="nav-link text-gray-700"
                onClick={() => { navigate(item.path); setMenuOpen(false); }}
              >
                {item.label}
              </span>
            ))}
            <button className="btn-outline" onClick={() => { logout(); setMenuOpen(false); }}>Logout</button>
          </>}
        </div>
      )}
    </nav>
  );
}
