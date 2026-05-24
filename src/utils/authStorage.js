import { AUTH_STORAGE_KEY } from '../config/appConfig.js';

export function readStoredAuthUser() {
  try {
    const saved = localStorage.getItem(AUTH_STORAGE_KEY);
    return saved ? normalizeAuthUser(JSON.parse(saved)) : null;
  } catch {
    return null;
  }
}

export function writeStoredAuthUser(user) {
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(normalizeAuthUser(user)));
}

export function removeStoredAuthUser() {
  localStorage.removeItem(AUTH_STORAGE_KEY);
}

export function decodeJwtPayload(token) {
  try {
    const [, payload] = token.split(".");
    if (!payload) return null;
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

export function isAccessTokenFresh(token, minValiditySeconds = 60) {
  if (!token) return false;
  const payload = decodeJwtPayload(token);
  if (!payload?.exp) return true;
  return payload.exp * 1000 - Date.now() > minValiditySeconds * 1000;
}

export function normalizeEmail(value = "") {
  return value.toString().trim().toLowerCase();
}

export function normalizeAuthUser(user) {
  if (!user || typeof user !== "object") return user;
  const email = normalizeEmail(user.email);
  return email ? { ...user, email } : user;
}

export function hasAuthSession(user) {
  return Boolean(user?.access_token || user?.refresh_token);
}
