import assert from "node:assert/strict";
import test from "node:test";
import { allocateSchedule, uncoveredRequirements, validateKit } from "./kit";
import type { InterviewKit, InterviewQuestion, Requirement } from "./types";

const requirements: Requirement[] = [
  { id: "r1", text: "Build secure APIs", kind: "technical", priority: "must" },
  { id: "r2", text: "Mentor engineers", kind: "behavioural", priority: "must" },
  { id: "r3", text: "Experience with healthcare", kind: "domain", priority: "nice" },
];

const questions: InterviewQuestion[] = [
  { id: "q1", requirement_ids: ["r1"], category: "technical", prompt: "API question?", answer_outline: "Discuss design.", difficulty: 3 },
  { id: "q2", requirement_ids: ["r2"], category: "behavioural", prompt: "Mentoring question?", answer_outline: "Use STAR.", difficulty: 2 },
  { id: "q3", requirement_ids: ["r3"], category: "company-fit", prompt: "Domain question?", answer_outline: "Give context.", difficulty: 1 },
];

function sampleKit(): InterviewKit {
  return {
    source: { company: "Acme", company_url: "https://acme.test/", role: "Engineer", location: "", jd_chars: 20, researched_at: new Date().toISOString(), pages_used: [] },
    company_brief: { summary: "Unknown.", what_they_do: "Unknown.", sources: [] },
    role: { title: "Engineer", seniority: "Senior", responsibilities: [], requirements },
    questions,
    flashcards: [{ id: "f1", front: "API?", back: "Explain the design.", requirement_ids: ["r1"] }],
    schedule: { days_available: 3, days: allocateSchedule(questions, requirements, 3) },
    coverage: { uncovered_requirement_ids: [], passes: 2 },
  };
}

test("coverage only reports uncovered must-have requirements", () => {
  assert.deepEqual(uncoveredRequirements(requirements, [questions[0]]), ["r2"]);
  assert.deepEqual(uncoveredRequirements(requirements, questions), []);
});

test("schedule spans exactly the requested number of days and covers every question once", () => {
  for (const days of [1, 3, 60]) {
    const schedule = allocateSchedule(questions, requirements, days);
    assert.equal(schedule.length, days);
    assert.deepEqual(schedule.map((day) => day.day), Array.from({ length: days }, (_, i) => i + 1));
    assert.ok(schedule.every((day) => Number.isInteger(day.minutes) && day.minutes >= 0));
    assert.deepEqual(schedule.flatMap((day) => day.question_ids).sort(), questions.map((question) => question.id).sort());
  }
  assert.throws(() => allocateSchedule(questions, requirements, 0), /between 1 and 60/);
});

test("schedule prioritizes must-have and harder questions earlier", () => {
  const schedule = allocateSchedule(questions, requirements, 3);
  assert.deepEqual(schedule[0].question_ids, ["q1"]);
  assert.deepEqual(schedule[1].question_ids, ["q2"]);
  assert.deepEqual(schedule[2].question_ids, ["q3"]);
});

test("structure validator accepts the exact kit shape and rejects broken question references", () => {
  const kit = sampleKit();
  assert.doesNotThrow(() => validateKit(kit));
  const invalid = structuredClone(kit);
  invalid.schedule.days[0].question_ids = ["does-not-exist"];
  assert.throws(() => validateKit(invalid), /unknown question/);
});

test("structure validator requires exactly the number of requested schedule days", () => {
  const invalid = sampleKit();
  invalid.schedule.days.pop();
  assert.throws(() => validateKit(invalid), /exactly days_available/);
});

test("structure validator rejects uncovered must-have requirements", () => {
  const invalid = sampleKit();
  invalid.questions = [questions[0]];
  invalid.schedule.days = allocateSchedule(invalid.questions, requirements, 3);
  assert.throws(() => validateKit(invalid), /Coverage must report/);
});
