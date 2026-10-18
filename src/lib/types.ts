export type RequirementKind = "technical" | "behavioural" | "domain";
export type RequirementPriority = "must" | "nice";
export type QuestionCategory =
  | "technical"
  | "behavioural"
  | "system-design"
  | "company-fit";

export interface Requirement {
  id: string;
  text: string;
  kind: RequirementKind;
  priority: RequirementPriority;
}

export interface InterviewQuestion {
  id: string;
  requirement_ids: string[];
  category: QuestionCategory;
  prompt: string;
  answer_outline: string;
  difficulty: 1 | 2 | 3;
}

export interface Flashcard {
  id: string;
  front: string;
  back: string;
  requirement_ids: string[];
}

export interface StudyDay {
  day: number;
  focus: string;
  question_ids: string[];
  minutes: number;
}

export interface InterviewKit {
  source: {
    company: string;
    company_url: string;
    role: string;
    location: string;
    jd_chars: number;
    researched_at: string;
    pages_used: string[];
  };
  company_brief: {
    summary: string;
    what_they_do: string;
    sources: string[];
  };
  role: {
    title: string;
    seniority: string;
    responsibilities: string[];
    requirements: Requirement[];
  };
  questions: InterviewQuestion[];
  flashcards: Flashcard[];
  schedule: {
    days_available: number;
    days: StudyDay[];
  };
  coverage: {
    uncovered_requirement_ids: string[];
    passes: number;
  };
}

export interface CaseInput {
  id: string;
  jd: string;
  company_url: string;
  days: number;
}

export interface ResearchPage {
  url: string;
  title: string;
  text: string;
  kind: "home" | "about" | "hiring" | "discussion";
  links?: Array<{ url: string; label: string }>;
}

export interface StoredKit {
  id: string;
  ownerId: string;
  title: string;
  kit: InterviewKit;
  questionState: Record<string, "generated" | "edited" | "pinned">;
  flashcardState: Record<string, "generated" | "edited" | "pinned">;
  practice: Record<string, { confidence: number; coveredAt: string }>;
  createdAt: string;
  updatedAt: string;
}
