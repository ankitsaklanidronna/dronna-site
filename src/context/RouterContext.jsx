import { createContext, useContext, useEffect, useState } from 'react';

export const RouterContext = createContext(null);

export function Router({ children }) {
  const [page, setPage] = useState(window.location.hash.replace("#","") || "/");
  useEffect(() => {
    const onHash = () => setPage(window.location.hash.replace("#","") || "/");
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const navigate = (p) => { window.location.hash = p; };
  return <RouterContext.Provider value={{ page, navigate }}>{children}</RouterContext.Provider>;
}

export const useRouter = () => useContext(RouterContext);

export function getRoutePath(page) {
  let path = (page || "/").split("?")[0] || "/";
  if (path !== "/" && !path.startsWith("/")) {
    path = "/" + path;
  }
  return path;
}

export function getRouteSearchParams(page) {
  const [, query = ""] = (page || "").split("?");
  return new URLSearchParams(query);
}
