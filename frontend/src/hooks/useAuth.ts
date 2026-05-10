import { useState, useEffect, useCallback, useRef } from "react";
import { auth, setToken, clearToken, setAuthenticated } from "@/api/client";
import { primeBootstrap, resetBootstrap } from "@/api/bootstrap";
import i18n from "@/i18n";
import type { User } from "@/types";

const TOKEN_REFRESH_INTERVAL = 10 * 60 * 1000; // Refresh every 10 minutes

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const refreshTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const startRefreshTimer = useCallback(() => {
    if (refreshTimer.current) clearInterval(refreshTimer.current);
    refreshTimer.current = setInterval(async () => {
      try {
        await auth.refresh();
      } catch {
        // Token refresh failed — session expired
        setAuthenticated(false);
        setUser(null);
      }
    }, TOKEN_REFRESH_INTERVAL);
  }, []);

  const stopRefreshTimer = useCallback(() => {
    if (refreshTimer.current) {
      clearInterval(refreshTimer.current);
      refreshTimer.current = null;
    }
  }, []);

  const loadUser = useCallback(async () => {
    try {
      const u = await auth.me();
      setAuthenticated(true);
      // Kick off bootstrap before the authenticated UI mounts so per-hook
      // singleton caches are primed by the time their components subscribe.
      // Fire-and-forget — hooks have their own fallback fetches.
      primeBootstrap();
      setUser(u as User);
      i18n.changeLanguage(u.locale || "en");
      startRefreshTimer();
    } catch {
      setAuthenticated(false);
    } finally {
      setLoading(false);
    }
  }, [startRefreshTimer]);

  useEffect(() => {
    loadUser();
    return () => stopRefreshTimer();
  }, [loadUser, stopRefreshTimer]);

  const login = async (email: string, password: string) => {
    const { access_token } = await auth.login(email, password);
    setToken(access_token);
    await loadUser();
  };

  const register = async (email: string, displayName: string, password: string) => {
    const { access_token } = await auth.register(email, displayName, password);
    setToken(access_token);
    await loadUser();
  };

  const ssoCallback = async (code: string, redirectUri: string) => {
    const { access_token } = await auth.ssoCallback(code, redirectUri);
    setToken(access_token);
    await loadUser();
  };

  const setPassword = async (token: string, password: string) => {
    const { access_token } = await auth.setPassword(token, password);
    setToken(access_token);
    await loadUser();
  };

  const logout = async () => {
    try {
      await auth.logout();
    } catch {
      // Best-effort — clear local state regardless
    }
    clearToken();
    stopRefreshTimer();
    resetBootstrap();
    setUser(null);
  };

  return {
    user,
    loading,
    login,
    register,
    ssoCallback,
    setPassword,
    logout,
    refreshUser: loadUser,
  };
}
