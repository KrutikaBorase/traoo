"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { allocateSchedule, uncoveredRequirements } from "@/lib/kit";
import type {
  InterviewKit,
  InterviewQuestion,
  Requirement,
  RequirementKind,
  RequirementPriority,
  StoredKit,
} from "@/lib/types";

type Tab = "builder" | "practice" | "schedule";

const categories: InterviewQuestion["category"][] = ["technical", "behavioural", "system-design", "company-fit"];

async function readError(response: Response): Promise<string> {
  try {
    const result = await response.json();
    return result.error?.message ?? "The request could not be completed.";
  } catch {
    return "The request could not be completed.";
  }
}

export function KitWorkspace({ kitId }: { kitId: string }) {
  const [stored, setStored] = useState<StoredKit | null>(null);
  const [tab, setTab] = useState<Tab>("builder");
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("Loading your kit…");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [activeCardId, setActiveCardId] = useState("");
  const [showAnswer, setShowAnswer] = useState(false);

  useEffect(() => {
    fetch(`/api/kits/${kitId}`).then(async (response) => {
      if (!response.ok) throw new Error(await readError(response));
      const result = await response.json();
      setStored(result.kit as StoredKit);
      setStatus("Saved");
    }).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Could not load your kit."))
      .finally(() => setLoading(false));
  }, [kitId]);

  useEffect(() => {
    if (loading || !stored) return;
    const timer = window.setTimeout(async () => {
      setStatus("Saving…");
      try {
        const response = await fetch(`/api/kits/${kitId}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            kit: stored.kit,
            questionState: stored.questionState,
            flashcardState: stored.flashcardState,
          }),
        });
        if (!response.ok) throw new Error(await readError(response));
        setStatus("All changes saved");
        setError("");
      } catch (cause) {
        setStatus("Not saved");
        setError(cause instanceof Error ? cause.message : "Could not save changes.");
      }
    }, 650);
    return () => window.clearTimeout(timer);
  }, [kitId, loading, stored]);

  const updateKit = useCallback((update: (kit: InterviewKit) => void) => {
    setStored((previous) => {
      if (!previous) return previous;
      const next = structuredClone(previous);
      update(next.kit);
      next.kit.coverage.uncovered_requirement_ids = uncoveredRequirements(next.kit.role.requirements, next.kit.questions);
      next.kit.schedule.days = allocateSchedule(next.kit.questions, next.kit.role.requirements, next.kit.schedule.days_available);
      next.updatedAt = new Date().toISOString();
      return next;
    });
  }, []);

  const updateStored = useCallback((update: (next: StoredKit) => void) => {
    setStored((previous) => {
      if (!previous) return previous;
      const next = structuredClone(previous);
      update(next);
      next.updatedAt = new Date().toISOString();
      return next;
    });
  }, []);

  async function regenerate(section: string, category?: InterviewQuestion["category"]) {
    setBusy(category ?? section);
    setError("");
    try {
      const response = await fetch(`/api/kits/${kitId}/regenerate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ section, category }),
      });
      if (!response.ok) throw new Error(await readError(response));
      const result = await response.json();
      setStored(result.kit as StoredKit);
      setStatus("All changes saved");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not regenerate this section.");
    } finally {
      setBusy("");
    }
  }

  async function rateCard(cardId: string, confidence: number) {
    try {
      const response = await fetch(`/api/kits/${kitId}/practice`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ flashcardId: cardId, confidence }),
      });
      if (!response.ok) throw new Error(await readError(response));
      const result = await response.json() as { practice: StoredKit["practice"] };
      updateStored((next) => { next.practice = result.practice; });
      const current = orderedCards.findIndex((card) => card.id === cardId);
      const nextCard = orderedCards[(current + 1) % orderedCards.length];
      setActiveCardId(nextCard?.id ?? "");
      setShowAnswer(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not record practice.");
    }
  }

  async function deleteThisKit() {
    if (!window.confirm("Delete this kit? This cannot be undone.")) return;
    const response = await fetch(`/api/kits/${kitId}`, { method: "DELETE" });
    if (!response.ok) {
      setError(await readError(response));
      return;
    }
    window.location.assign("/dashboard");
  }

  const orderedCards = useMemo(() => {
    if (!stored) return [];
    return [...stored.kit.flashcards].sort(
      (a, b) => (stored.practice[a.id]?.confidence ?? 0) - (stored.practice[b.id]?.confidence ?? 0),
    );
  }, [stored]);
  const activeCard = orderedCards.find((card) => card.id === activeCardId) ?? orderedCards[0];

  if (loading) return <main className="mx-auto max-w-6xl px-5 py-16"><p role="status">{status}</p></main>;
  if (!stored) return <main className="mx-auto max-w-3xl px-5 py-16"><div role="alert" className="card p-8"><h1 className="section-title">Couldn’t open this kit</h1><p className="mt-3 text-sm text-red-700">{error || "It may have been deleted or may not belong to your account."}</p><a className="button-primary mt-5 inline-flex" href="/dashboard">Back to your workspace</a></div></main>;
  const kit = stored.kit;
  const coveredCards = kit.flashcards.filter((card) => Boolean(stored.practice[card.id])).length;
  const categoriesInKit = categories.filter((category) => kit.questions.some((question) => question.category === category));

  const markQuestion = (id: string, value: "generated" | "edited" | "pinned") => {
    updateStored((next) => { next.questionState[id] = value; });
  };

  const changeRequirement = (id: string, update: (item: Requirement) => void) => {
    updateKit((draft) => {
      const item = draft.role.requirements.find((requirement) => requirement.id === id);
      if (item) update(item);
    });
  };

  function addRequirement() {
    const id = `r${kit.role.requirements.length + 1}-manual`;
    updateKit((draft) => draft.role.requirements.push({ id, text: "Add a role requirement", kind: "technical", priority: "must" }));
  }

  function addQuestion() {
    const id = `q${Math.max(0, ...kit.questions.map((item) => Number(item.id.slice(1)) || 0)) + 1}`;
    const requirement = kit.role.requirements[0];
    const question: InterviewQuestion = {
      id,
      requirement_ids: requirement ? [requirement.id] : [],
      category: "technical",
      prompt: "Write your practice question",
      answer_outline: "Add the key points you want to cover in your answer.",
      difficulty: 2,
    };
    updateKit((draft) => draft.questions.push(question));
    updateStored((next) => { next.questionState[id] = "pinned"; });
  }

  function addFlashcard() {
    const id = `f${Math.max(0, ...kit.flashcards.map((item) => Number(item.id.slice(1)) || 0)) + 1}`;
    const requirement = kit.role.requirements[0];
    updateKit((draft) => draft.flashcards.push({
      id,
      front: "Add a flashcard prompt",
      back: "Add the answer you want to remember.",
      requirement_ids: requirement ? [requirement.id] : [],
    }));
    updateStored((next) => { next.flashcardState[id] = "pinned"; });
  }

  function moveQuestion(index: number, delta: number) {
    updateKit((draft) => {
      const target = index + delta;
      if (target < 0 || target >= draft.questions.length) return;
      [draft.questions[index], draft.questions[target]] = [draft.questions[target], draft.questions[index]];
    });
  }

  function removeRequirement(id: string) {
    updateKit((draft) => {
      draft.role.requirements = draft.role.requirements.filter((item) => item.id !== id);
      draft.questions = draft.questions.map((question) => ({
        ...question,
        requirement_ids: question.requirement_ids.filter((requirementId) => requirementId !== id),
      }));
      draft.flashcards = draft.flashcards.map((card) => ({
        ...card,
        requirement_ids: card.requirement_ids.filter((requirementId) => requirementId !== id),
      }));
    });
  }

  return (
    <main className="min-h-screen">
      <header className="border-b border-[#dfe5df] bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 md:px-8">
          <a href="/dashboard" className="text-sm font-bold tracking-[.2em] text-[#1e5f4a]">TRAO <span className="font-normal text-[#8a9892]">/ PREP KIT</span></a>
          <div className="flex items-center gap-3"><span className="hidden text-xs text-[#687773] sm:block">{status}</span><a className="button-quiet" href="/dashboard">All kits</a><button className="button-quiet text-red-700" onClick={deleteThisKit}>Delete</button></div>
        </div>
      </header>
      <div className="mx-auto max-w-7xl px-5 py-8 md:px-8 md:py-12">
        <a href="/dashboard" className="text-sm text-[#687773] hover:text-[#1e5f4a]">← Workspace</a>
        <div className="mb-8 mt-5 flex flex-wrap items-end justify-between gap-5">
          <div>
            <div className="mb-3 flex flex-wrap items-center gap-2"><span className="pill">{kit.source.company}</span>{kit.role.seniority && <span className="text-xs text-[#687773]">{kit.role.seniority}</span>}</div>
            <h1 className="font-serif text-4xl tracking-tight md:text-5xl">{kit.role.title || `${kit.source.company} interview`}</h1>
            <p className="mt-3 text-sm text-[#687773]">{kit.role.requirements.length} requirements · {kit.questions.length} questions · {kit.schedule.days_available}-day plan</p>
          </div>
          <div className="rounded-xl border border-[#dfe5df] bg-white px-4 py-3 text-sm">
            <span className="text-[#687773]">Coverage</span><span className="ml-3 font-bold text-[#1e5f4a]">{kit.role.requirements.filter((item) => item.priority === "must").length - kit.coverage.uncovered_requirement_ids.length}/{kit.role.requirements.filter((item) => item.priority === "must").length} must-haves</span>
          </div>
        </div>
        <nav aria-label="Kit sections" className="mb-6 flex gap-2 border-b border-[#dfe5df]">
          {(["builder", "practice", "schedule"] as const).map((item) => <button key={item} className={`border-b-2 px-4 py-3 text-sm font-semibold capitalize ${tab === item ? "border-[#1e5f4a] text-[#1e5f4a]" : "border-transparent text-[#687773]"}`} aria-current={tab === item ? "page" : undefined} onClick={() => setTab(item)}>{item === "builder" ? "Kit builder" : item === "practice" ? "Practice" : "Study plan"}</button>)}
        </nav>
        {error && <p role="alert" className="mb-5 rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}

        {tab === "builder" && <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="space-y-6">
            <section className="card p-5 md:p-7">
              <div className="mb-5 flex flex-wrap items-start justify-between gap-3"><div><p className="label">Company research</p><h2 className="section-title">The company, in brief</h2></div><button className="button-secondary" disabled={busy === "company_brief"} onClick={() => regenerate("company_brief")}>{busy === "company_brief" ? "Researching…" : "↻ Regenerate brief"}</button></div>
              <label className="label" htmlFor="brief-summary">Summary</label><textarea id="brief-summary" className="field mb-4 min-h-20" value={kit.company_brief.summary} onChange={(event) => updateKit((draft) => { draft.company_brief.summary = event.target.value; })} />
              <label className="label" htmlFor="brief-work">What they do</label><textarea id="brief-work" className="field min-h-24" value={kit.company_brief.what_they_do} onChange={(event) => updateKit((draft) => { draft.company_brief.what_they_do = event.target.value; })} />
              <div className="mt-4 flex flex-wrap gap-2">{kit.company_brief.sources.map((source) => <a key={source} href={source} target="_blank" rel="noreferrer" className="max-w-full truncate rounded-full bg-[#f1f5f1] px-3 py-1.5 text-xs text-[#315c49] underline decoration-dotted">{new URL(source).hostname}{new URL(source).pathname}</a>)}</div>
              {!kit.company_brief.sources.length && <p className="mt-3 text-xs text-[#687773]">No company pages were retrieved. The brief does not invent company details.</p>}
            </section>

            <section className="card p-5 md:p-7">
              <div className="mb-5"><p className="label">Role breakdown</p><h2 className="section-title">What this role asks for</h2></div>
              <label className="label" htmlFor="role-title">Role title</label><input id="role-title" className="field mb-4" value={kit.role.title} onChange={(event) => updateKit((draft) => { draft.role.title = event.target.value; draft.source.role = event.target.value; })} />
              <label className="label" htmlFor="responsibilities">Responsibilities <span className="font-normal normal-case tracking-normal">(one per line)</span></label><textarea id="responsibilities" className="field mb-5 min-h-24" value={kit.role.responsibilities.join("\n")} onChange={(event) => updateKit((draft) => { draft.role.responsibilities = event.target.value.split("\n"); })} />
              <div className="mb-3 flex items-center justify-between"><h3 className="font-serif text-xl">Requirements <span className="text-sm text-[#87928c]">({kit.role.requirements.length})</span></h3><button className="button-secondary text-sm" onClick={addRequirement}>+ Add requirement</button></div>
              <div className="space-y-3">
                {kit.role.requirements.map((requirement) => <div key={requirement.id} className="rounded-xl border border-[#e6ebe6] bg-[#fbfcfa] p-3">
                  <div className="mb-3 flex items-center justify-between"><span className="text-xs font-bold text-[#87928c]">{requirement.id}</span><button className="button-quiet text-xs text-red-700" onClick={() => removeRequirement(requirement.id)}>Remove</button></div>
                  <textarea aria-label={`Requirement ${requirement.id}`} className="field mb-3 min-h-16" value={requirement.text} onChange={(event) => changeRequirement(requirement.id, (item) => { item.text = event.target.value; })} />
                  <div className="flex flex-wrap gap-2">
                    <select aria-label="Requirement kind" className="field max-w-[180px] py-2 text-sm" value={requirement.kind} onChange={(event) => changeRequirement(requirement.id, (item) => { item.kind = event.target.value as RequirementKind; })}><option value="technical">Technical</option><option value="behavioural">Behavioural</option><option value="domain">Domain</option></select>
                    <select aria-label="Requirement priority" className="field max-w-[150px] py-2 text-sm" value={requirement.priority} onChange={(event) => changeRequirement(requirement.id, (item) => { item.priority = event.target.value as RequirementPriority; })}><option value="must">Must-have</option><option value="nice">Nice-to-have</option></select>
                  </div>
                </div>)}
                {!kit.role.requirements.length && <p className="rounded-lg bg-[#f7f8f5] p-4 text-sm text-[#687773]">The posting did not contain clear requirements. Add only qualifications you can support from the description.</p>}
              </div>
            </section>

            <section className="card p-5 md:p-7">
              <div className="mb-5 flex flex-wrap items-end justify-between gap-3"><div><p className="label">Interview practice</p><h2 className="section-title">Question bank</h2></div><button className="button-secondary" onClick={addQuestion}>+ Write a question</button></div>
              {categoriesInKit.length > 0 && <div className="mb-5 flex flex-wrap gap-2">{categoriesInKit.map((category) => <button key={category} className="button-secondary text-xs capitalize" disabled={Boolean(busy)} onClick={() => regenerate("questions", category)}>{busy === category ? "Regenerating…" : `↻ ${category}`}</button>)}</div>}
              <div className="space-y-4">
                {kit.questions.map((question, index) => <article key={question.id} className="rounded-xl border border-[#e6ebe6] p-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2"><span className="text-xs font-bold text-[#87928c]">{question.id}</span><span className="pill capitalize">{question.category}</span><span className="text-xs text-[#687773]">Difficulty {question.difficulty}</span><span className="text-xs text-[#687773]">{stored.questionState[question.id] ?? "generated"}</span></div>
                    <div className="flex items-center"><button aria-label="Move question up" className="button-quiet" disabled={index === 0} onClick={() => moveQuestion(index, -1)}>↑</button><button aria-label="Move question down" className="button-quiet" disabled={index === kit.questions.length - 1} onClick={() => moveQuestion(index, 1)}>↓</button><button className="button-quiet" onClick={() => markQuestion(question.id, stored.questionState[question.id] === "pinned" ? "edited" : "pinned")}>{stored.questionState[question.id] === "pinned" ? "Unpin" : "Pin"}</button><button className="button-quiet text-red-700" onClick={() => { updateKit((draft) => { draft.questions = draft.questions.filter((item) => item.id !== question.id); }); updateStored((next) => { delete next.questionState[question.id]; }); }}>Delete</button></div>
                  </div>
                  <label className="label" htmlFor={`prompt-${question.id}`}>Question</label><textarea id={`prompt-${question.id}`} className="field mb-3 min-h-16" value={question.prompt} onChange={(event) => { updateKit((draft) => { const item = draft.questions.find((candidate) => candidate.id === question.id); if (item) item.prompt = event.target.value; }); markQuestion(question.id, "edited"); }} />
                  <label className="label" htmlFor={`answer-${question.id}`}>Answer outline</label><textarea id={`answer-${question.id}`} className="field min-h-20" value={question.answer_outline} onChange={(event) => { updateKit((draft) => { const item = draft.questions.find((candidate) => candidate.id === question.id); if (item) item.answer_outline = event.target.value; }); markQuestion(question.id, "edited"); }} />
                  <div className="mt-3 flex flex-wrap gap-2">
                    <select aria-label="Question category" className="field max-w-[190px] py-2 text-sm" value={question.category} onChange={(event) => { updateKit((draft) => { const item = draft.questions.find((candidate) => candidate.id === question.id); if (item) item.category = event.target.value as InterviewQuestion["category"]; }); markQuestion(question.id, "edited"); }}>{categories.map((item) => <option key={item} value={item}>{item}</option>)}</select>
                    <select aria-label="Question difficulty" className="field max-w-[160px] py-2 text-sm" value={question.difficulty} onChange={(event) => { updateKit((draft) => { const item = draft.questions.find((candidate) => candidate.id === question.id); if (item) item.difficulty = Number(event.target.value) as 1 | 2 | 3; }); markQuestion(question.id, "edited"); }}><option value={1}>Difficulty 1</option><option value={2}>Difficulty 2</option><option value={3}>Difficulty 3</option></select>
                  </div>
                </article>)}
                {!kit.questions.length && <p className="rounded-lg bg-[#f7f8f5] p-4 text-sm text-[#687773]">No questions yet. Add one yourself, or add requirements to the role first.</p>}
              </div>
            </section>

            <section className="card p-5 md:p-7">
              <div className="mb-5 flex items-end justify-between gap-3"><div><p className="label">Quick recall</p><h2 className="section-title">Flashcards <span className="text-lg text-[#87928c]">({kit.flashcards.length})</span></h2></div><button className="button-secondary" onClick={addFlashcard}>+ Add a card</button></div>
              <div className="space-y-3">
                {kit.flashcards.map((card) => <div key={card.id} className="rounded-xl border border-[#e6ebe6] p-3">
                  <div className="mb-3 flex justify-between"><span className="text-xs font-bold text-[#87928c]">{card.id} · {stored.flashcardState[card.id] ?? "generated"}</span><button className="button-quiet text-xs text-red-700" onClick={() => { updateKit((draft) => { draft.flashcards = draft.flashcards.filter((item) => item.id !== card.id); }); updateStored((next) => { delete next.flashcardState[card.id]; }); }}>Remove</button></div>
                  <input className="field mb-2" aria-label="Flashcard front" value={card.front} onChange={(event) => { updateKit((draft) => { const item = draft.flashcards.find((candidate) => candidate.id === card.id); if (item) item.front = event.target.value; }); updateStored((next) => { next.flashcardState[card.id] = "edited"; }); }} />
                  <textarea className="field min-h-16" aria-label="Flashcard back" value={card.back} onChange={(event) => { updateKit((draft) => { const item = draft.flashcards.find((candidate) => candidate.id === card.id); if (item) item.back = event.target.value; }); updateStored((next) => { next.flashcardState[card.id] = "edited"; }); }} />
                </div>)}
                {!kit.flashcards.length && <p className="text-sm text-[#687773]">Add a flashcard to begin a practice session.</p>}
              </div>
            </section>
          </div>
          <aside className="space-y-4 lg:sticky lg:top-6">
            <section className="card p-5"><p className="label">Research trail</p><h2 className="mb-3 font-serif text-xl">What we could verify</h2><p className="text-sm leading-6 text-[#687773]">{kit.source.pages_used.length} source(s) retrieved or searched. Missing sources are skipped; unsupported details aren’t filled in.</p><div className="mt-4 space-y-2">{kit.source.pages_used.map((source) => <a key={source} href={source} target="_blank" rel="noreferrer" className="block truncate text-xs text-[#1e5f4a] underline decoration-dotted">{source}</a>)}</div></section>
            <section className="card bg-[#eef5f0] p-5"><p className="label">Second-pass check</p><h2 className="mb-2 font-serif text-xl">{kit.coverage.uncovered_requirement_ids.length ? "A few gaps remain" : "Must-haves covered"}</h2><p className="text-sm leading-6 text-[#50605b]">{kit.coverage.uncovered_requirement_ids.length ? `Still uncovered: ${kit.coverage.uncovered_requirement_ids.join(", ")}` : `All ${kit.role.requirements.filter((item) => item.priority === "must").length} must-have requirements have at least one linked question.`} Coverage checked in ${kit.coverage.passes} passes.</p></section>
            <section className="card p-5"><p className="label">Practice progress</p><div className="mb-2 flex justify-between text-sm"><span>Cards covered</span><strong>{coveredCards}/{kit.flashcards.length}</strong></div><div className="h-2 overflow-hidden rounded-full bg-[#edf0eb]"><div className="h-full rounded-full bg-[#1e5f4a] transition-all" style={{ width: `${kit.flashcards.length ? coveredCards / kit.flashcards.length * 100 : 0}%` }} /></div><button className="button-primary mt-4 w-full" onClick={() => setTab("practice")}>Start a practice session</button></section>
            <p className="px-2 text-xs leading-5 text-[#87928c]">Edits are saved automatically. Generated items you pin or edit stay put when you regenerate their category.</p>
          </aside>
        </div>}

        {tab === "practice" && <section className="mx-auto max-w-3xl">
          <div className="mb-6 flex flex-wrap items-end justify-between gap-4"><div><p className="label">Active recall</p><h2 className="section-title">Practice what matters</h2><p className="mt-2 text-sm text-[#687773]">Least-confident and new cards come first. Rate your confidence after revealing the answer.</p></div><span className="pill">{coveredCards} / {kit.flashcards.length} covered</span></div>
          {activeCard ? <article className="card p-6 md:p-10">
            <div className="mb-8 flex justify-between"><span className="pill">Card {orderedCards.findIndex((card) => card.id === activeCard.id) + 1} of {orderedCards.length}</span><span className="text-xs text-[#687773]">{activeCard.requirement_ids.map((id) => kit.role.requirements.find((item) => item.id === id)?.text).filter(Boolean).join(" · ")}</span></div>
            <p className="label">Prompt</p><h3 className="font-serif text-2xl leading-relaxed md:text-3xl">{activeCard.front}</h3>
            {showAnswer ? <div className="mt-8 rounded-xl bg-[#eff6f1] p-5"><p className="label">Your answer outline</p><p className="leading-7 text-[#315c49]">{activeCard.back}</p></div> : <button className="button-primary mt-8" onClick={() => setShowAnswer(true)}>Reveal answer</button>}
            {showAnswer && <div className="mt-8"><p className="label">How confident were you?</p><div className="grid grid-cols-5 gap-2">{[1, 2, 3, 4, 5].map((score) => <button key={score} className="button-secondary py-3" onClick={() => rateCard(activeCard.id, score)}><strong>{score}</strong><span className="hidden sm:inline"> · {["Not yet", "Shaky", "Getting there", "Confident", "Solid"][score - 1]}</span></button>)}</div><p className="mt-3 text-xs text-[#687773]">Your next round will put lower-confidence cards first.</p></div>}
          </article> : <div className="card p-8 text-center"><h3 className="font-serif text-2xl">No flashcards yet</h3><p className="mt-2 text-sm text-[#687773]">Add cards in the kit builder to start practising.</p><button className="button-secondary mt-4" onClick={() => setTab("builder")}>Open builder</button></div>}
          <button className="button-quiet mt-4" onClick={() => setTab("builder")}>← Back to kit</button>
        </section>}

        {tab === "schedule" && <section className="mx-auto max-w-4xl">
          <div className="mb-6 flex flex-wrap items-end justify-between gap-4"><div><p className="label">Your plan</p><h2 className="section-title">{kit.schedule.days_available} days to feel ready</h2><p className="mt-2 text-sm text-[#687773]">Must-have topics and harder questions are scheduled earlier.</p></div><button className="button-secondary" disabled={busy === "schedule"} onClick={() => regenerate("schedule")}>{busy === "schedule" ? "Allocating…" : "↻ Rebuild schedule"}</button></div>
          <div className="space-y-3">{kit.schedule.days.map((day) => <article key={day.day} className="card grid gap-4 p-5 sm:grid-cols-[86px_1fr_auto] sm:items-center">
            <div><span className="label">Day</span><span className="font-serif text-3xl">{String(day.day).padStart(2, "0")}</span></div>
            <div><h3 className="font-semibold">{day.focus}</h3><div className="mt-2 flex flex-wrap gap-2">{day.question_ids.length ? day.question_ids.map((id) => <button key={id} className="rounded-full bg-[#f0f4ef] px-2.5 py-1 text-xs text-[#315c49]" onClick={() => { setTab("builder"); document.getElementById(`prompt-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }); }}>{id}: {kit.questions.find((question) => question.id === id)?.prompt.slice(0, 70)}{(kit.questions.find((question) => question.id === id)?.prompt.length ?? 0) > 70 ? "…" : ""}</button>) : <span className="text-xs text-[#87928c]">Review notes and revisit low-confidence cards</span>}</div></div>
            <div className="text-sm text-[#687773]">{day.minutes} min</div>
          </article>)}</div>
        </section>}
      </div>
    </main>
  );
}
