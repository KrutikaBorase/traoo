"use client";

import { useState, type FormEvent } from "react";

export function AuthForm() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: mode === "login" ? "login" : "register", email, password }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message ?? "Could not sign in.");
      window.location.assign("/dashboard");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="paper-grid flex min-h-screen items-center justify-center px-5 py-12">
      <div className="grid w-full max-w-5xl overflow-hidden rounded-[22px] border border-[#dfe5df] bg-white shadow-sm md:grid-cols-[1.1fr_.9fr]">
        <section className="flex min-h-[520px] flex-col justify-between bg-[#1e5f4a] p-8 text-white md:p-12">
          <a href="/login" className="text-sm font-bold tracking-[.22em]">TRAO <span className="font-normal opacity-70">/ PREP KIT</span></a>
          <div>
            <span className="mb-5 inline-flex rounded-full border border-white/25 px-3 py-1 text-xs">A little less guesswork</span>
            <h1 className="max-w-md font-serif text-4xl leading-tight tracking-tight md:text-5xl">Walk into the interview already knowing what matters.</h1>
            <p className="mt-5 max-w-sm leading-7 text-white/75">Turn the job description into a researched brief, focused practice, and a plan you can actually follow.</p>
          </div>
          <p className="text-xs text-white/60">Your next conversation starts with better preparation.</p>
        </section>
        <section className="flex items-center p-8 md:p-12">
          <form onSubmit={submit} className="w-full">
            <p className="label">Welcome to Trao</p>
            <h2 className="mb-2 font-serif text-3xl">{mode === "login" ? "Sign in" : "Create your account"}</h2>
            <p className="mb-8 text-sm leading-6 text-[#687773]">Your interview kits are private and saved to your account.</p>
            <label className="label" htmlFor="email">Email</label>
            <input id="email" className="field mb-5" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
            <label className="label" htmlFor="password">Password</label>
            <input id="password" className="field" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={10} required value={password} onChange={(event) => setPassword(event.target.value)} />
            {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
            <button className="button-primary mt-6 w-full" type="submit" disabled={busy}>{busy ? "One moment…" : mode === "login" ? "Sign in" : "Create account"}</button>
            <p className="mt-6 text-center text-sm text-[#687773]">
              {mode === "login" ? "New to Trao?" : "Already have an account?"}{" "}
              <button className="font-bold text-[#1e5f4a] underline underline-offset-2" type="button" onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}>
                {mode === "login" ? "Create an account" : "Sign in"}
              </button>
            </p>
          </form>
        </section>
      </div>
    </main>
  );
}
