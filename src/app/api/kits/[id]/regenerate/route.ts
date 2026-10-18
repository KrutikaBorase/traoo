import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { generateQuestionsForRequirements, categoryFor, summarizeCompany } from "@/lib/generation";
import { allocateSchedule, refreshGeneratedFlashcards, uncoveredRequirements, validateKit } from "@/lib/kit";
import { crawlCompanySite } from "@/lib/research";
import { findKit, saveKit } from "@/lib/store";
import type { InterviewKit, InterviewQuestion } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

type Context = { params: Promise<{ id: string }> };
type Category = InterviewQuestion["category"];

export async function POST(request: Request, context: Context) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "Please sign in." } }, { status: 401 });
  const { id } = await context.params;
  const stored = await findKit(user.id, id);
  if (!stored) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Kit not found." } }, { status: 404 });
  try {
    const body = await request.json() as { section?: string; category?: Category };
    const kit: InterviewKit = structuredClone(stored.kit);
    const previousQuestions = structuredClone(kit.questions);
    if (body.section === "company_brief") {
      const research = await crawlCompanySite(kit.source.company_url);
      const brief = await summarizeCompany(kit.source.company, research.pages);
      kit.company_brief = {
        ...brief,
        sources: research.pages.map((page) => page.url),
      };
      kit.source.skipped_sources = research.skipped;
    } else if (body.section === "questions") {
      if (!["technical", "behavioural", "system-design", "company-fit"].includes(body.category ?? "")) {
        throw new Error("Choose a valid question category.");
      }
      const category = body.category!;
      const requirements = kit.role.requirements.filter((requirement) => categoryFor(requirement) === category);
      const preserved = kit.questions.filter((question) =>
        question.category !== category ||
        stored.questionState[question.id] === "edited" ||
        stored.questionState[question.id] === "pinned",
      );
      const preservedIds = new Set(preserved.flatMap((question) => question.requirement_ids));
      const toGenerate = requirements.filter((requirement) => !preservedIds.has(requirement.id));
      const generated = await generateQuestionsForRequirements(
        toGenerate,
        category,
        kit.company_brief.summary,
        kit.company_brief.sources.join(", "),
        kit.questions.length,
      );
      const nextId = Math.max(0, ...kit.questions.map((question) => Number(question.id.slice(1)) || 0)) + 1;
      generated.forEach((question, index) => { question.id = `q${nextId + index}`; });
      kit.questions = [...preserved, ...generated];
      stored.questionState = Object.fromEntries(kit.questions.map((question) => [
        question.id,
        preserved.some((item) => item.id === question.id) ? stored.questionState[question.id] : "generated",
      ]));
      const refreshed = refreshGeneratedFlashcards(
        kit.questions,
        previousQuestions,
        kit.flashcards,
        stored.questionState,
        stored.flashcardState,
        category,
      );
      kit.flashcards = refreshed.flashcards;
      stored.flashcardState = refreshed.flashcardState;
      kit.coverage.uncovered_requirement_ids = uncoveredRequirements(kit.role.requirements, kit.questions);
      kit.schedule.days = allocateSchedule(kit.questions, kit.role.requirements, kit.schedule.days_available);
    } else if (body.section === "schedule") {
      kit.schedule.days = allocateSchedule(kit.questions, kit.role.requirements, kit.schedule.days_available);
    } else {
      throw new Error("Section must be company_brief, questions, or schedule.");
    }
    kit.coverage.uncovered_requirement_ids = uncoveredRequirements(kit.role.requirements, kit.questions);
    validateKit(kit);
    stored.kit = kit;
    stored.updatedAt = new Date().toISOString();
    await saveKit(stored);
    return NextResponse.json({ kit: stored });
  } catch (error) {
    return NextResponse.json({
      error: { code: "REGENERATION_FAILED", message: error instanceof Error ? error.message : "Could not regenerate this section." },
    }, { status: 400 });
  }
}
