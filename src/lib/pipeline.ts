import { categoryFor, extractJobDescription, fallbackQuestion, generateQuestionsForRequirements, summarizeCompany } from "./generation";
import { allocateSchedule, uncoveredRequirements, validateKit } from "./kit";
import { crawlCompanySite, searchInterviewDiscussion } from "./research";
import type { CaseInput, InterviewKit, InterviewQuestion, ResearchPage } from "./types";

function companyName(url: URL): string {
  return url.hostname.replace(/^www\./, "").split(".")[0].replace(/[-_]/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function validateCase(input: CaseInput): void {
  if (!input || typeof input !== "object") throw new Error("Case must be an object.");
  if (typeof input.id !== "string" || !input.id.trim() || input.id.length > 100) throw new Error("Case id must be a non-empty string.");
  if (typeof input.jd !== "string" || input.jd.length > 30_000) throw new Error("jd must be a string no longer than 30,000 characters.");
  if (typeof input.company_url !== "string" || input.company_url.length > 2_000) throw new Error("company_url must be a valid URL string.");
  let companyUrl: URL;
  try {
    companyUrl = new URL(input.company_url);
  } catch {
    throw new Error("company_url must be a valid absolute URL.");
  }
  if (!["http:", "https:"].includes(companyUrl.protocol) || companyUrl.username || companyUrl.password) {
    throw new Error("company_url must use HTTP(S) and cannot contain credentials.");
  }
  if (!Number.isInteger(input.days) || input.days < 1 || input.days > 60) throw new Error("days must be an integer between 1 and 60.");
}

function createFlashcards(questions: InterviewQuestion[]) {
  return questions.map((question, index) => ({
    id: `f${index + 1}`,
    front: question.prompt,
    back: question.answer_outline,
    requirement_ids: question.requirement_ids,
  }));
}

export async function buildKit(
  input: CaseInput,
  onProgress?: (step: string) => void,
): Promise<InterviewKit> {
  validateCase(input);
  const companyUrl = new URL(input.company_url);
  const company = companyName(companyUrl);
  onProgress?.("Reading the job description and crawling the company site");
  const [research, extracted] = await Promise.all([
    crawlCompanySite(input.company_url),
    extractJobDescription(input.jd),
  ]);
  onProgress?.("Searching for public interview-process information");
  const discussions = await searchInterviewDiscussion(company);
  const allResearch: ResearchPage[] = [...research.pages, ...discussions];
  const hiringSignal = [
    ...research.pages.filter((page) => page.kind === "hiring").map((page) => `${page.title}: ${page.text}`),
    ...discussions.map((page) => `${page.title}: ${page.text}`),
  ].join("\n").slice(0, 4_000);
  onProgress?.("Building an evidence-based company brief");
  const brief = await summarizeCompany(company, allResearch);

  const questions: InterviewQuestion[] = [];
  for (const category of ["technical", "behavioural", "system-design", "company-fit"] as const) {
    const requirements = extracted.requirements.filter((item) => categoryFor(item) === category);
    if (!requirements.length) continue;
    onProgress?.(`Generating ${category} questions`);
    const generated = await generateQuestionsForRequirements(
      requirements,
      category,
      brief.summary,
      hiringSignal,
      questions.length,
    );
    questions.push(...generated);
  }

  // One explicit coverage pass adds deterministic questions for anything the first pass missed.
  onProgress?.("Checking requirement coverage and closing any gaps");
  const uncovered = uncoveredRequirements(extracted.requirements, questions);
  for (const id of uncovered) {
    const requirement = extracted.requirements.find((item) => item.id === id);
    if (!requirement) continue;
    questions.push(fallbackQuestion(requirement, categoryFor(requirement), questions.length));
  }
  const finalGaps = uncoveredRequirements(extracted.requirements, questions);
  onProgress?.("Allocating the day-by-day study schedule");
  const schedule = allocateSchedule(questions, extracted.requirements, input.days);
  const kit: InterviewKit = {
    source: {
      company,
      company_url: companyUrl.href,
      role: extracted.title,
      location: extracted.location,
      jd_chars: input.jd.length,
      researched_at: new Date().toISOString(),
      pages_used: allResearch.map((page) => page.url),
      skipped_sources: research.skipped,
      discussion_results: discussions.length,
    },
    company_brief: {
      summary: brief.summary,
      what_they_do: brief.what_they_do,
      sources: research.pages.map((page) => page.url),
    },
    role: {
      title: extracted.title,
      seniority: extracted.seniority,
      responsibilities: extracted.responsibilities,
      requirements: extracted.requirements,
    },
    questions,
    flashcards: createFlashcards(questions),
    schedule: { days_available: input.days, days: schedule },
    coverage: { uncovered_requirement_ids: finalGaps, passes: 2 },
  };
  validateKit(kit);
  return kit;
}

export function validateCaseInput(input: CaseInput): void {
  validateCase(input);
}
