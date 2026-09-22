// What the Live Agent Graph knows about each agent. The graph itself is data, so it is easy to read and to test.

export type AgentEvent =
  | { seq: number; type: "start"; call_id: string; agent: string; model: string; at: string }
  | {
      seq: number;
      type: "finish";
      call_id: string;
      agent: string;
      model: string;
      at: string;
      tokens: number;
      latency_ms: number;
      cached: boolean;
      preview: string | null;
    }
  | { seq: number; type: "error"; call_id: string | null; agent: string; model: string; at: string; message: string };

export type NodeKind = "llm" | "code";

export type GraphNode = {
  id: string;
  label: string;
  stage: string;
  kind: NodeKind;
  x: number;
  y: number;
  help: string;
};

/** Left to right: the order work flows through the system. `code` nodes run without any AI. */
export const GRAPH_NODES: GraphNode[] = [
  { id: "jd_generator", label: "JD Generator", stage: "Job", kind: "llm", x: 0, y: 40, help: "Writes the job description, streaming as it goes." },
  { id: "jd_requirements", label: "Requirements Extractor", stage: "Job", kind: "llm", x: 0, y: 140, help: "Pulls the must-have and nice-to-have skills out of the job description." },
  { id: "resume_parser", label: "Resume Parser", stage: "Intake", kind: "llm", x: 190, y: 250, help: "Turns a resume into a structured profile." },
  { id: "bias_shield", label: "Bias Shield", stage: "Intake", kind: "code", x: 190, y: 350, help: "Hides names, gender clues, schools and photos before any AI scores a resume. Plain code, no AI." },
  { id: "matcher", label: "Matcher", stage: "Screening", kind: "llm", x: 380, y: 195, help: "Scores a resume against the job and quotes the evidence. Code computes the final score." },
  { id: "panel_tech_lead", label: "Tech Lead", stage: "Panel", kind: "llm", x: 570, y: 0, help: "First panelist: judges technical depth." },
  { id: "panel_hr_manager", label: "HR Manager", stage: "Panel", kind: "llm", x: 570, y: 95, help: "Second panelist: judges communication and culture fit." },
  { id: "panel_hiring_manager", label: "Hiring Manager", stage: "Panel", kind: "llm", x: 570, y: 190, help: "Third panelist: judges business fit and risk." },
  { id: "panel_moderator", label: "Moderator", stage: "Panel", kind: "llm", x: 760, y: 95, help: "Explains where the panel agrees and differs. It does not decide." },
  { id: "verdict_rules", label: "Verdict rules", stage: "Panel", kind: "code", x: 760, y: 215, help: "Fixed rules in code turn the panel's scores into hire, maybe or no hire." },
  { id: "interview_questions", label: "Interview Planner", stage: "Interview", kind: "llm", x: 950, y: 0, help: "Writes five questions tailored to the job and the candidate's gaps." },
  { id: "interview_evaluate", label: "Answer Evaluator", stage: "Interview", kind: "llm", x: 950, y: 95, help: "Scores each answer. Code decides whether to ask a follow-up." },
  { id: "interview_scorecard", label: "Scorecard Writer", stage: "Interview", kind: "llm", x: 950, y: 190, help: "Writes the summary. Every number in the scorecard is computed in code." },
  { id: "outreach", label: "Outreach", stage: "Outreach", kind: "llm", x: 1140, y: 60, help: "Drafts invitation, rejection and offer emails. It never sees the candidate's name." },
  { id: "skill_coach", label: "Skill-Gap Coach", stage: "Outreach", kind: "llm", x: 1140, y: 180, help: "Writes a learning roadmap for the skills a candidate did not show." },
  { id: "qa_bot", label: "Q&A Bot", stage: "Assistants", kind: "llm", x: 380, y: 400, help: "Answers candidate questions only from the job description and company info." },
  { id: "ask_hr", label: "Ask-HR", stage: "Assistants", kind: "llm", x: 570, y: 400, help: "Turns a plain-English question into a safe, read-only search." },
];

/** [from, to]. A third value "down" joins two nodes in the same column with a straight line instead of a loop. */
export const GRAPH_EDGES: [string, string, "down"?][] = [
  ["jd_generator", "jd_requirements", "down"],
  ["jd_requirements", "matcher"],
  ["resume_parser", "bias_shield", "down"],
  ["bias_shield", "matcher"],
  ["matcher", "panel_tech_lead"],
  ["matcher", "panel_hr_manager"],
  ["matcher", "panel_hiring_manager"],
  ["panel_tech_lead", "panel_moderator"],
  ["panel_hr_manager", "panel_moderator"],
  ["panel_hiring_manager", "panel_moderator"],
  ["panel_moderator", "verdict_rules", "down"],
  ["verdict_rules", "interview_questions"],
  ["interview_questions", "interview_evaluate", "down"],
  ["interview_evaluate", "interview_scorecard", "down"],
  ["verdict_rules", "outreach"],
  ["matcher", "skill_coach"],
  ["jd_requirements", "qa_bot"],
  ["resume_parser", "ask_hr"],
];

const NODE_IDS = new Set(GRAPH_NODES.map((n) => n.id));

/** Which node an agent name belongs to (the three outreach kinds share one node; the demo helper shares the evaluator's). */
export function nodeFor(agent: string): string | null {
  if (agent.startsWith("outreach_")) return "outreach";
  if (agent === "interview_simulate") return "interview_evaluate";
  return NODE_IDS.has(agent) ? agent : null;
}

const LABELS: Record<string, string> = Object.fromEntries(GRAPH_NODES.map((n) => [n.id, n.label]));

export function agentLabel(agent: string): string {
  if (agent === "interview_simulate") return "Demo Helper";
  const node = nodeFor(agent);
  return node ? LABELS[node] : agent.replaceAll("_", " ");
}

export type RunRow = {
  id: number;
  agent: string;
  model: string;
  tokens: number;
  latency_ms: number;
  cached: boolean;
  created_at: string;
  preview: string | null;
};

export type AgentStat = { agent: string; calls: number; cached: number; tokens: number; avg_latency_ms: number };
export type AgentStats = { calls: number; cached: number; tokens: number; agents: AgentStat[] };

export type FunnelStep = { key: string; label: string; count: number; help: string };
export type DashboardData = { jobs: number; candidates: number; rejected: number; funnel: FunnelStep[] };

export type EvalCheck = { name: string; passed: boolean; detail: string };
export type EvalPhase = { key: string; title: string; ran_at: string; passed: number; total: number; checks: EvalCheck[] };
export type Evaluation = { phases: EvalPhase[]; passed: number; total: number };
