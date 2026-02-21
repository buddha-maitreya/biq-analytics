import React, { useState, useCallback } from "react";
import type { AppConfig, AuthUser } from "../types";

interface LoginPageProps {
  config: AppConfig;
  onLogin: (user: AuthUser) => void;
}

export default function LoginPage({ config, onLogin }: LoginPageProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError("");
      setLoading(true);

      try {
        const res = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: email.trim(), password }),
        });

        const data = await res.json();

        if (!res.ok) {
          setError(data.error || "Login failed");
          return;
        }

        // Cookie is set by the server (HttpOnly) — no localStorage needed
        onLogin(data.user);
      } catch {
        setError("Network error. Please try again.");
      } finally {
        setLoading(false);
      }
    },
    [email, password, onLogin]
  );

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-header">
          {config.companyLogoUrl && (
            <img
              src={config.companyLogoUrl}
              alt=""
              className="login-logo"
            />
          )}
          <h1 className="login-title">
            {config.companyName || "Business IQ"}
          </h1>
          {config.companyTagline && (
            <p className="login-tagline">{config.companyTagline}</p>
          )}
        </div>

        <form className="login-form" onSubmit={handleSubmit}>
          {error && <div className="login-error">{error}</div>}

          <div className="login-field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              required
              autoComplete="email"
              autoFocus
              disabled={loading}
            />
          </div>

          <div className="login-field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              required
              autoComplete="current-password"
              disabled={loading}
            />
          </div>

          <button
            type="submit"
            className="login-submit"
            disabled={loading || !email || !password}
          >
            {loading ? "Signing in…" : "Sign In"}
          </button>
        </form>

        <div className="login-footer">
          <span>Powered by Business IQ Enterprise</span>
        </div>
      </div>
    </div>
  );
}
