import { createId, nowIso } from "../utils.js";

const defaultProfiles = [
  { name: "Carrie Feng", role: "PM / Analyst", team: "Investment Team", capacityHint: 7, skills: ["PM", "analysis", "client deliverables"] },
  { name: "Joy Zheng", role: "Portfolio Strategist", team: "Investment Team", capacityHint: 6, skills: ["portfolio strategy", "review"] },
  { name: "Helen Luo", role: "Research Analyst", team: "Investment Team", capacityHint: 5, skills: ["research", "documentation"] },
  { name: "Jane Bai", role: "Quant Researcher", team: "Investment Team", capacityHint: 5, skills: ["quant", "optimization"] },
  { name: "Robert Michaud", role: "Research Lead", team: "Investment Team", capacityHint: 4, skills: ["review", "asset allocation"] }
];

const defaultProjects = [
  {
    name: "Mark Proposal",
    summary: "Proposal refinement and portfolio comparison work for the Mark client.",
    status: "active",
    phase: "review"
  },
  {
    name: "Tax Monitoring Demo",
    summary: "Simple monitoring and management dashboard concept for tax transition progress.",
    status: "active",
    phase: "execution"
  },
  {
    name: "Household Optimization Demo",
    summary: "Household optimization workflow and supporting analysis.",
    status: "active",
    phase: "execution"
  },
  {
    name: "Core With Alts Sweep",
    summary: "Income and alts preference sweep analysis for internal strategy review.",
    status: "active",
    phase: "analysis"
  }
];

export function ensureBootstrapData(db) {
  const profileCount = db.prepare("SELECT COUNT(*) AS count FROM person_profiles").get().count;
  const projectCount = db.prepare("SELECT COUNT(*) AS count FROM projects").get().count;
  const now = nowIso();

  if (profileCount === 0) {
    const insertProfile = db.prepare(`
      INSERT INTO person_profiles (
        id, name, role, team, skills_json, capacity_hint, created_at, updated_at
      ) VALUES (
        @id, @name, @role, @team, @skills_json, @capacity_hint, @created_at, @updated_at
      )
    `);

    for (const profile of defaultProfiles) {
      insertProfile.run({
        id: createId("person"),
        name: profile.name,
        role: profile.role,
        team: profile.team,
        skills_json: JSON.stringify(profile.skills),
        capacity_hint: profile.capacityHint,
        created_at: now,
        updated_at: now
      });
    }
  }

  if (projectCount === 0) {
    const pm = db.prepare("SELECT id FROM person_profiles WHERE name = ?").get("Carrie Feng");
    const insertProject = db.prepare(`
      INSERT INTO projects (
        id, name, summary, status, phase, pm_owner_id, created_at, updated_at
      ) VALUES (
        @id, @name, @summary, @status, @phase, @pm_owner_id, @created_at, @updated_at
      )
    `);

    for (const project of defaultProjects) {
      insertProject.run({
        id: createId("project"),
        name: project.name,
        summary: project.summary,
        status: project.status,
        phase: project.phase,
        pm_owner_id: pm?.id ?? null,
        created_at: now,
        updated_at: now
      });
    }
  }
}
