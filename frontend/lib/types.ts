// Mirrors the FastAPI response models (backend/app/routers and backend/app/agents).

export type Requirements = {
  must_have_skills: string[];
  nice_to_have_skills: string[];
  min_years_experience: number;
  education: string | null;
  responsibilities: string[];
};

export type Job = {
  id: number;
  title: string;
  brief: string;
  status: string;
  markdown: string | null;
  requirements: Requirements | null;
  created_at: string;
};

export type LanguageFlag = {
  phrase: string;
  start: number;
  end: number;
  category: string;
  reason: string;
  suggestion: string;
};

export type Experience = {
  title: string;
  company: string | null;
  start: string | null;
  end: string | null;
  highlights: string[];
};

export type Education = {
  degree: string;
  institution: string | null;
  year: string | null;
};

export type Profile = {
  name: string;
  email: string | null;
  phone: string | null;
  location: string | null;
  headline: string | null;
  skills: string[];
  experience: Experience[];
  education: Education[];
  certifications: string[];
  total_years_experience: number;
};

export type Candidate = {
  id: number;
  name: string;
  email: string;
  stage: string;
  profile: Profile | null;
  created_at: string;
};

export type CandidateDetail = Candidate & { resume_text: string };

// ---- Screening (Phase 2) ----

export const STAGES = ["applied", "screened", "interview", "offer", "rejected"] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_LABELS: Record<Stage, string> = {
  applied: "Applied",
  screened: "Screened",
  interview: "Interview",
  offer: "Offer",
  rejected: "Rejected",
};

export type SkillDetail = {
  skill: string;
  kind: "must" | "nice";
  status: "demonstrated" | "listed" | "missing";
};

export type Evidence = {
  claim: string;
  quote: string;
  in_original?: boolean | null;
};

export type ScoreParts = "skills" | "semantic" | "experience" | "ai_review";

export type CandidateBrief = {
  id: number;
  name: string;
  email: string;
  headline: string | null;
  location: string | null;
  years: number;
  stage: string;
};

export type Match = {
  id: number;
  job_id: number;
  overall_score: number;
  breakdown: Partial<Record<ScoreParts, number | null>>;
  weights: Record<ScoreParts, number>;
  strengths: string[];
  gaps: string[];
  summary: string;
  confidence: number;
  dropped_quotes: number;
  skill_details: SkillDetail[];
  evidence: Evidence[];
  candidate: CandidateBrief;
  panel: PanelSummary | null;
};

export type MatchDetail = Match & { resume_text: string; anonymized_text: string };

export type ScreenEvent =
  | { type: "status"; message: string }
  | { type: "start"; total: number; skipped: number }
  | { type: "match"; match: Match }
  | { type: "progress"; done: number; total: number }
  | { type: "candidate_error"; candidate_id: number; message: string }
  | { type: "error"; message: string }
  | { type: "done"; matched: number; failed: number };

// ---- Panel review (Phase 3) ----

export type Verdict = "hire" | "maybe" | "no_hire";

export type PanelSummary = {
  verdict: Verdict;
  consensus_score: number;
  agreement: "high" | "moderate" | "low";
};

export type PersonaReview = {
  persona: string;
  label: string;
  score: number;
  stance: Verdict;
  reasoning: string;
  strengths: string[];
  concerns: string[];
  evidence: { claim: string; quote: string }[];
  probe_questions: string[];
  dropped_quotes: number;
};

export type Panel = PanelSummary & {
  match_id: number;
  spread: number;
  summary: string;
  disagreements: { topic: string; detail: string }[];
  key_risks: string[];
  next_step: string;
  probe_questions: string[];
  reviews: PersonaReview[];
};

export type PanelEvent =
  | { type: "panel_start"; match_id: number; index: number; total: number }
  | { type: "persona"; match_id: number; review: PersonaReview }
  | { type: "status"; match_id: number; message: string }
  | { type: "panel"; match_id: number; panel: Panel }
  | { type: "panel_error"; match_id: number; message: string }
  | { type: "done"; completed: number; failed: number };

// ---- Interviews (Phase 3) ----

export type InterviewTurn = {
  role: "interviewer" | "candidate";
  kind: "question" | "follow_up" | "answer";
  question_index: number;
  text: string;
  content_score: number | null;
  clarity_score: number | null;
  feedback: string | null;
};

export type Scorecard = {
  overall: number;
  recommendation: "strong" | "mixed" | "weak";
  competencies: Record<string, number>;
  communication: number | null;
  weights: Record<string, number>;
  questions: { index: number; text: string; competency: string; score: number; follow_up_asked: boolean; feedback: string }[];
  summary: string;
  strengths: string[];
  concerns: string[];
  duration_seconds: number | null;
};

export type Interview = {
  id: number;
  job_id: number;
  job_title: string;
  candidate: { id: number; name: string; headline: string | null };
  status: "in_progress" | "completed";
  turns: InterviewTurn[];
  progress: { current_question: number; total_questions: number; finished: boolean };
  scorecard: Scorecard | null;
  created_at: string;
  completed_at: string | null;
};

export type InterviewSummary = { id: number; status: string; created_at: string; overall: number | null };
