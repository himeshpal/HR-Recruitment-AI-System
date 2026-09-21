"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { postJson } from "@/lib/api";
import type { Job } from "@/lib/types";

const EXAMPLES = [
  { title: "Backend Engineer", brief: "2+ years of Python and FastAPI, PostgreSQL, Docker. Nice to have: AWS." },
  { title: "Frontend Developer", brief: "React and TypeScript, 3 years. Cares about accessibility and performance." },
  { title: "Data Analyst", brief: "SQL, Excel and a BI tool such as Tableau. Fresher or up to 2 years of experience." },
];
const BRIEF_MAX = 3000;

export function JobForm() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [brief, setBrief] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    try {
      const job = await postJson<Job>("/api/jobs", { title, brief });
      router.push(`/jobs/${job.id}?generate=1`);
    } catch (err) {
      toast.error((err as Error).message);
      setPending(false);
    }
  }

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>Describe the role</CardTitle>
        <CardDescription>
          A title and a few lines are enough. The JD Generator agent writes the full description and you can edit it.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="title">Job title</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Backend Engineer"
              minLength={2}
              maxLength={200}
              required
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="brief">Brief</Label>
              <span className="text-xs text-muted-foreground">
                {brief.length}/{BRIEF_MAX}
              </span>
            </div>
            <Textarea
              id="brief"
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              placeholder="Skills, experience level, anything that matters for this role"
              maxLength={BRIEF_MAX}
              rows={5}
            />
          </div>
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">Or start from an example</p>
            <div className="flex flex-wrap gap-2">
              {EXAMPLES.map((example) => (
                <Button
                  key={example.title}
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setTitle(example.title);
                    setBrief(example.brief);
                  }}
                >
                  {example.title}
                </Button>
              ))}
            </div>
          </div>
          <Button type="submit" disabled={pending || title.trim().length < 2}>
            {pending ? <Loader2 className="animate-spin" /> : <Sparkles />}
            {pending ? "Creating…" : "Generate job description"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
