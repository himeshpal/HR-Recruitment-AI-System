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
