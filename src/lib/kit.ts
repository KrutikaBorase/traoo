import type {
  Flashcard,
  InterviewKit,
  InterviewQuestion,
  Requirement,
  StudyDay,
} from "./types";

const validKinds = new Set(["technical", "behavioural", "domain"]);
const validCategories = new Set([
  "technical",
  "behavioural",
  "system-design",
  "company-fit",
]);

export function uncoveredRequirements(
  requirements: Requirement[],
  questions: InterviewQuestion[],
): string[] {
  const covered = new Set(questions.flatMap((question) => question.requirement_ids));
  return requirements
    .filter((requirement) => requirement.priority === "must" && !covered.has(requirement.id))
    .map((requirement) => requirement.id);
}

export function allocateSchedule(
  questions: InterviewQuestion[],
  requirements: Requirement[],
  daysAvailable: number,
): StudyDay[] {
  if (!Number.isInteger(daysAvailable) || daysAvailable < 1 || daysAvailable > 60) {
    throw new Error("days must be an integer between 1 and 60");
  }

  const priority = new Map(requirements.map((item) => [item.id, item.priority]));
  const ordered = [...questions].sort((a, b) => {
    const mustA = a.requirement_ids.some((id) => priority.get(id) === "must");
    const mustB = b.requirement_ids.some((id) => priority.get(id) === "must");
    return Number(mustB) - Number(mustA) || b.difficulty - a.difficulty;
  });
  const groups: InterviewQuestion[][] = Array.from({ length: daysAvailable }, () => []);

  ordered.forEach((question, index) => {
    const dayIndex = Math.min(
      daysAvailable - 1,
      Math.floor((index * daysAvailable) / Math.max(ordered.length, 1)),
    );
    groups[dayIndex].push(question);
  });

  return groups.map((group, index) => {
    const topics = [...new Set(group.flatMap((question) => question.requirement_ids))]
      .map((id) => requirements.find((requirement) => requirement.id === id)?.text)
      .filter((text): text is string => Boolean(text));
    const minutes = group.length ? group.length * 15 + Math.max(0, 30 - group.length * 15) : 0;
    return {
      day: index + 1,
      focus: topics.length
        ? topics.slice(0, 2).join(" · ")
        : "Review notes and revisit your least-confident flashcards",
      question_ids: group.map((question) => question.id),
      minutes,
    };
  });
}

export function validateKit(value: unknown): asserts value is InterviewKit {
  if (!value || typeof value !== "object") throw new Error("Kit must be an object");
  const kit = value as Partial<InterviewKit>;
  const requiredObjects = ["source", "company_brief", "role", "schedule", "coverage"];
  for (const key of requiredObjects) {
    if (!kit[key as keyof InterviewKit] || typeof kit[key as keyof InterviewKit] !== "object") {
      throw new Error(`Kit is missing ${key}`);
    }
  }
  if (!Array.isArray(kit.role?.requirements)) throw new Error("Kit role.requirements must be an array");
  if (!Array.isArray(kit.questions)) throw new Error("Kit questions must be an array");
  if (!Array.isArray(kit.flashcards)) throw new Error("Kit flashcards must be an array");
  if (!Array.isArray(kit.schedule?.days)) throw new Error("Kit schedule.days must be an array");
  const source = kit.source;
  if (
    typeof source?.company !== "string" ||
    typeof source.company_url !== "string" ||
    typeof source.role !== "string" ||
    typeof source.location !== "string" ||
    !Number.isInteger(source.jd_chars) ||
    typeof source.researched_at !== "string" ||
    !Array.isArray(source.pages_used) ||
    !source.pages_used.every((url) => typeof url === "string") ||
    (source.skipped_sources !== undefined &&
      (!Array.isArray(source.skipped_sources) ||
        !source.skipped_sources.every((url) => typeof url === "string"))) ||
    (source.discussion_results !== undefined &&
      (!Number.isInteger(source.discussion_results) || source.discussion_results < 0))
  ) throw new Error("Kit source fields do not match the required structure");
  if (
    typeof kit.company_brief?.summary !== "string" ||
    typeof kit.company_brief.what_they_do !== "string" ||
    !Array.isArray(kit.company_brief.sources) ||
    !kit.company_brief.sources.every((url) => typeof url === "string")
  ) throw new Error("Kit company_brief fields do not match the required structure");
  if (
    typeof kit.role?.title !== "string" ||
    typeof kit.role.seniority !== "string" ||
    !Array.isArray(kit.role.responsibilities) ||
    !kit.role.responsibilities.every((item) => typeof item === "string")
  ) throw new Error("Kit role fields do not match the required structure");
  if (!Number.isInteger(kit.schedule?.days_available) || kit.schedule.days_available! < 1) {
    throw new Error("schedule.days_available must be a positive integer");
  }
  if (kit.schedule.days.length !== kit.schedule.days_available) {
    throw new Error("Schedule must contain exactly days_available days");
  }

  const requirementIds = new Set<string>();
  for (const requirement of kit.role.requirements) {
    if (!requirement.id || requirementIds.has(requirement.id)) throw new Error("Requirement ids must be unique");
    requirementIds.add(requirement.id);
    if (!requirement.text || !validKinds.has(requirement.kind)) throw new Error(`Invalid requirement ${requirement.id}`);
    if (requirement.priority !== "must" && requirement.priority !== "nice") {
      throw new Error(`Invalid priority on requirement ${requirement.id}`);
    }
  }

  const questionIds = new Set<string>();
  for (const question of kit.questions) {
    if (!question.id || questionIds.has(question.id)) throw new Error("Question ids must be unique");
    questionIds.add(question.id);
    if (!validCategories.has(question.category)) throw new Error(`Invalid question category on ${question.id}`);
    if (!question.prompt || !question.answer_outline || ![1, 2, 3].includes(question.difficulty)) {
      throw new Error(`Incomplete question ${question.id}`);
    }
    if (!question.requirement_ids.every((id) => requirementIds.has(id))) {
      throw new Error(`Question ${question.id} refers to an unknown requirement`);
    }
  }

  const flashcardIds = new Set<string>();
  for (const flashcard of kit.flashcards) {
    if (!flashcard.id || flashcardIds.has(flashcard.id)) throw new Error("Flashcard ids must be unique");
    flashcardIds.add(flashcard.id);
    if (!flashcard.front || !flashcard.back) throw new Error(`Incomplete flashcard ${flashcard.id}`);
    if (!flashcard.requirement_ids.every((id) => requirementIds.has(id))) {
      throw new Error(`Flashcard ${flashcard.id} refers to an unknown requirement`);
    }
  }

  const dayNumbers = new Set<number>();
  for (const day of kit.schedule.days) {
    if (
      !Number.isInteger(day.day) ||
      day.day < 1 ||
      day.day > kit.schedule.days_available ||
      !Number.isInteger(day.minutes) ||
      day.minutes < 0 ||
      typeof day.focus !== "string" ||
      !Array.isArray(day.question_ids)
    ) {
      throw new Error("Schedule days and durations must be non-negative integers");
    }
    dayNumbers.add(day.day);
    if (!day.question_ids.every((id) => questionIds.has(id))) {
      throw new Error(`Schedule day ${day.day} refers to an unknown question`);
    }
  }
  if (dayNumbers.size !== kit.schedule.days_available) throw new Error("Schedule day numbers must be unique");
  const scheduledQuestionIds = kit.schedule.days.flatMap((day) => day.question_ids);
  if (
    scheduledQuestionIds.length !== questionIds.size ||
    questionIds.size !== new Set(scheduledQuestionIds).size ||
    scheduledQuestionIds.some((id) => !questionIds.has(id))
  ) throw new Error("Every question must appear exactly once in the schedule");

  const expectedUncovered = uncoveredRequirements(kit.role.requirements, kit.questions);
  if (
    !Array.isArray(kit.coverage?.uncovered_requirement_ids) ||
    !Number.isInteger(kit.coverage?.passes) ||
    kit.coverage!.passes < 1 ||
    expectedUncovered.length !== kit.coverage!.uncovered_requirement_ids.length ||
    expectedUncovered.some((id) => !kit.coverage!.uncovered_requirement_ids.includes(id))
  ) {
    throw new Error("Coverage must report every must-have requirement without a question");
  }
}

export function makeSchedule(
  questions: InterviewQuestion[],
  requirements: Requirement[],
  days: number,
): StudyDay[] {
  return allocateSchedule(questions, requirements, days);
}

export function refreshGeneratedFlashcards(
  questions: InterviewQuestion[],
  previousQuestions: InterviewQuestion[],
  previousFlashcards: Flashcard[],
  questionState: Record<string, "generated" | "edited" | "pinned">,
  flashcardState: Record<string, "generated" | "edited" | "pinned">,
  regeneratedCategory: InterviewQuestion["category"],
): {
  flashcards: Flashcard[];
  flashcardState: Record<string, "generated" | "edited" | "pinned">;
} {
  const questionForCard = (card: Flashcard) => previousQuestions.find(
    (question) => question.prompt === card.front && question.answer_outline === card.back,
  );
  const retained = previousFlashcards.filter((card) => {
    if (flashcardState[card.id] !== "generated") return true;
    const previousQuestion = questionForCard(card);
    if (!previousQuestion) return false;
    const currentQuestion = questions.find((question) => question.id === previousQuestion.id);
    return Boolean(
      currentQuestion &&
      (previousQuestion.category !== regeneratedCategory ||
        questionState[previousQuestion.id] === "edited" ||
        questionState[previousQuestion.id] === "pinned"),
    );
  });
  const nextState = Object.fromEntries(
    retained.map((card) => [card.id, flashcardState[card.id] ?? "generated"]),
  ) as Record<string, "generated" | "edited" | "pinned">;
  let nextId = Math.max(0, ...previousFlashcards.map((card) => Number(card.id.slice(1)) || 0)) + 1;

  for (const question of questions) {
    if (question.category !== regeneratedCategory || questionState[question.id] !== "generated") continue;
    const card: Flashcard = {
      id: `f${nextId++}`,
      front: question.prompt,
      back: question.answer_outline,
      requirement_ids: question.requirement_ids,
    };
    retained.push(card);
    nextState[card.id] = "generated";
  }
  return { flashcards: retained, flashcardState: nextState };
}
