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
