"use client";

import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import type { StoredKit } from "@/lib/types";

type StreamEvent = {
  type: string;
  step?: string;
  kit?: StoredKit;
  stored?: StoredKit;
  caseId?: string;
  error?: { message?: string };
};

async function readStream(response: Response, onEvent: (event: StreamEvent) => void) {
  if (!response.ok) {
    const result = await response.json();
    throw new Error(result.error?.message ?? "Request failed.");
  }
  if (!response.body) throw new Error("The server did not return a progress stream.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) if (line.trim()) onEvent(JSON.parse(line) as StreamEvent);
    if (done) break;
  }
  if (buffer.trim()) onEvent(JSON.parse(buffer) as StreamEvent);
}

export function Dashboard({ email }: { email: string }) {
  const [kits, setKits] = useState<StoredKit[]>([]);
  const [jd, setJd] = useState("");
  const [companyUrl, setCompanyUrl] = useState("");
  const [days, setDays] = useState(5);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [batchFile, setBatchFile] = useState<File | null>(null);

  useEffect(() => {
    fetch("/api/kits").then(async (response) => {
      if (!response.ok) throw new Error("Could not load your kits.");
      const result = await response.json();
      setKits(result.kits);
    }).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Could not load your kits."));
  }, []);

  async function signOut() {
    await fetch("/api/auth", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "logout" }) });
    window.location.assign("/login");
  }

  async function createKit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setProgress("Preparing your kit…");
    try {
      await readStream(await fetch("/api/kits/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jd, company_url: companyUrl, days }),
      }), (item) => {
        if (item.type === "progress" && item.step) setProgress(item.step);
        if (item.type === "complete" && item.kit) {
          setKits((previous) => [item.kit!, ...previous]);
          window.location.assign(`/kits/${item.kit.id}`);
        }
        if (item.type === "error") setError(item.error?.message ?? "Kit generation failed.");
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Kit generation failed.");
    } finally {
      setBusy(false);
      setProgress("");
    }
  }

  async function handleBatch(event: FormEvent) {
    event.preventDefault();
    if (!batchFile) return;
    setBusy(true);
    setError("");
    setProgress("Reading your batch file…");
    try {
      const cases = JSON.parse(await batchFile.text()) as unknown;
      await readStream(await fetch("/api/kits/batch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(cases),
      }), (item) => {
        if (item.type === "progress" && item.step) setProgress(item.step);
        if (item.type === "case_complete" && item.stored) setKits((previous) => [item.stored!, ...previous]);
        if (item.type === "case_error") setError(`${item.caseId ?? "A case"}: ${item.error?.message ?? "generation failed"}`);
        if (item.type === "error") setError(item.error?.message ?? "Batch generation failed.");
      });
      setBatchFile(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not process the batch file.");
    } finally {
      setBusy(false);
      setProgress("");
    }
  }

  function selectBatchFile(event: ChangeEvent<HTMLInputElement>) {
    setBatchFile(event.target.files?.[0] ?? null);
    setError("");
  }

  return (
    <main className="min-h-screen">
      <header className="border-b border-[#dfe5df] bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 md:px-8">
          <a href="/dashboard" className="text-sm font-bold tracking-[.2em] text-[#1e5f4a]">TRAO <span className="font-normal text-[#8a9892]">/ PREP KIT</span></a>
          <div className="flex items-center gap-4 text-sm"><span className="hidden text-[#687773] sm:block">{email}</span><button className="button-quiet" onClick={signOut}>Sign out</button></div>
        </div>
      </header>
      <div className="paper-grid min-h-[calc(100vh-65px)]">
        <div className="mx-auto max-w-7xl px-5 py-10 md:px-8 md:py-14">
          <div className="mb-9 max-w-2xl">
            <p className="label">Your preparation desk</p>
            <h1 className="font-serif text-4xl tracking-tight md:text-5xl">Make the next interview <em className="text-[#1e5f4a]">yours.</em></h1>
            <p className="mt-4 max-w-xl leading-7 text-[#687773]">Start with the role. We’ll research the company, find the gaps worth preparing for, and make you a plan.</p>
          </div>
          <div className="grid items-start gap-7 lg:grid-cols-[minmax(0,1.25fr)_minmax(280px,.75fr)]">
            <form className="card p-5 md:p-7" onSubmit={createKit}>
              <div className="mb-6 flex items-start justify-between">
                <div><p className="label">New preparation kit</p><h2 className="section-title">Tell us about the role</h2></div>
                <span aria-hidden="true" className="hidden rounded-full bg-[#f2f5f0] px-3 py-2 text-xs text-[#62746b] sm:inline-flex">01 / START HERE</span>
              </div>
              <label className="label" htmlFor="job-description">Job description</label>
              <textarea id="job-description" className="field min-h-[180px] resize-y" placeholder={"Paste the job description here…\n\nWe only extract requirements actually stated in the posting."} value={jd} required maxLength={30000} onChange={(event) => setJd(event.target.value)} />
              <div className="mt-5 grid gap-5 sm:grid-cols-[1fr_150px]">
                <div><label className="label" htmlFor="company-url">Company website</label><input id="company-url" className="field" type="url" placeholder="https://company.com" value={companyUrl} required onChange={(event) => setCompanyUrl(event.target.value)} /></div>
                <div><label className="label" htmlFor="days">Days to prepare</label><input id="days" className="field" type="number" min={1} max={60} value={days} required onChange={(event) => setDays(Number(event.target.value))} /></div>
              </div>
              {progress && <p role="status" className="mt-5 rounded-lg bg-[#eff6f1] px-4 py-3 text-sm text-[#315c49]"><span className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-[#1e5f4a]" />{progress}</p>}
              {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
              <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
                <p className="max-w-sm text-xs leading-5 text-[#687773]">Research is respectful of robots.txt. Inference keys are optional; without one, the rule-based pipeline remains usable.</p>
                <button className="button-primary" type="submit" disabled={busy || !jd.trim() || !companyUrl}>{busy ? "Building…" : "Build my kit"} <span aria-hidden="true">↗</span></button>
              </div>
            </form>
            <section className="card p-5 md:p-6">
              <p className="label">Preparing for more than one role?</p>
              <h2 className="mb-2 font-serif text-2xl">Batch your cases</h2>
              <p className="mb-5 text-sm leading-6 text-[#687773]">Upload a JSON file containing an array of <code className="rounded bg-[#f2f5f0] px-1">id</code>, <code className="rounded bg-[#f2f5f0] px-1">jd</code>, <code className="rounded bg-[#f2f5f0] px-1">company_url</code>, and <code className="rounded bg-[#f2f5f0] px-1">days</code> objects.</p>
              <form onSubmit={handleBatch}>
                <label htmlFor="batch-file" className="mb-3 flex min-h-28 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-[#b9c9be] bg-[#f8faf7] p-4 text-center">
                  <span className="mb-2 text-xl" aria-hidden="true">↑</span><span className="text-sm font-semibold">{batchFile?.name ?? "Choose a .json file"}</span><span className="mt-1 text-xs text-[#687773]">Max 20 roles per batch</span>
                </label>
                <input id="batch-file" className="sr-only" type="file" accept=".json,application/json" onChange={selectBatchFile} />
                <button className="button-secondary w-full" type="submit" disabled={busy || !batchFile}>{busy ? "Processing batch…" : "Prepare batch"}</button>
              </form>
            </section>
          </div>
          <section className="mt-12">
            <div className="mb-4 flex items-end justify-between"><div><p className="label">Your workspace</p><h2 className="section-title">Saved kits <span className="text-lg text-[#87928c]">({kits.length})</span></h2></div></div>
            {kits.length ? <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {kits.map((item) => <a key={item.id} className="card block p-5 transition hover:-translate-y-0.5 hover:shadow-sm" href={`/kits/${item.id}`}>
                <div className="mb-4 flex items-center justify-between"><span className="pill">{item.kit.source.company}</span><span className="text-xs text-[#87928c]">{item.kit.schedule.days_available} days</span></div>
                <h3 className="font-serif text-xl">{item.title}</h3>
                <p className="mt-2 line-clamp-2 text-sm text-[#687773]">{item.kit.company_brief.summary}</p>
                <p className="mt-5 text-xs text-[#87928c]">{item.kit.role.requirements.length} requirements · {item.kit.questions.length} questions · {new Date(item.updatedAt).toLocaleDateString()}</p>
              </a>)}
            </div> : <div className="card border-dashed p-8 text-center"><p className="font-serif text-xl">Your first kit starts with a role.</p><p className="mt-2 text-sm text-[#687773]">Paste a job description above and we’ll take it from there.</p></div>}
          </section>
        </div>
      </div>
    </main>
  );
}
