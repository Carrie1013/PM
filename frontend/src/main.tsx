import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AlertTriangle,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  CircleDot,
  GripVertical,
  RefreshCw,
  Save,
  UserRound,
  X
} from "lucide-react";
import "./styles.css";

type Person = {
  id: string;
  name: string;
  role: string;
  capacityHint: number;
};

type Project = {
  id: string;
  name: string;
  summary?: string;
  status: string;
  phase: string;
  progressPercent: number;
  importantUpdates?: string;
  totalTasks?: number;
  doneTasks?: number;
  openTasks?: number;
};

type Task = {
  id: string;
  title: string;
  description?: string;
  status: string;
  priority: "high" | "medium" | "low";
  dueDate?: string | null;
  ownerId?: string | null;
  ownerName?: string | null;
  suggestedOwnerName?: string | null;
  projectId?: string | null;
  projectName?: string | null;
  blockerFlag: boolean;
  confidence?: number;
};

type OwnerColumn = {
  personId: string;
  personName: string;
  role: string;
  taskCount: number;
  overdueCount: number;
  blockerCount: number;
  capacityHint: number;
  tasks: Task[];
};

type ReviewItem = {
  id: string;
  confidence: number;
  sourceOrigin: string;
  payload: Partial<Task> & {
    suggestedOwnerId?: string | null;
    ownerId?: string | null;
  };
};

type Dashboard = {
  generatedFor: string;
  summary: {
    taskCount: number;
    unassignedCount: number;
    overdueCount: number;
    blockerCount: number;
  };
  tasksByOwner: OwnerColumn[];
  unassigned: Task[];
  projectProgress: Project[];
  calendar: Array<{
    id: string;
    ownerName?: string;
    teamScope?: string;
    category: string;
    startAt: string;
    endAt: string;
    projectName?: string;
  }>;
  memory: Array<{ id: string; scope_type: string; fact: string }>;
};

type Bootstrap = {
  people: Person[];
  projects: Project[];
};

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json() as Promise<T>;
}

function App() {
  const [people, setPeople] = useState<Person[]>([]);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [reviewItems, setReviewItems] = useState<ReviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setError(null);
    const [bootstrap, daily, review] = await Promise.all([
      fetchJson<Bootstrap>("/api/bootstrap"),
      fetchJson<Dashboard>("/api/dashboard/daily"),
      fetchJson<{ items: ReviewItem[] }>("/api/review/inbox")
    ]);
    setPeople(bootstrap.people);
    setDashboard(daily);
    setReviewItems(review.items);
    setLoading(false);
  }

  useEffect(() => {
    refresh().catch((err: Error) => {
      setError(err.message);
      setLoading(false);
    });
  }, []);

  async function assignTask(taskId: string, ownerId: string | null) {
    await fetchJson(`/api/tasks/${taskId}/assign`, {
      method: "POST",
      body: JSON.stringify({
        finalOwnerId: ownerId,
        reviewerName: "Dashboard",
        reason: "Dragged on dashboard"
      })
    });
    await refresh();
  }

  async function updateTask(taskId: string, payload: Partial<Task>) {
    await fetchJson(`/api/tasks/${taskId}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    });
    await refresh();
  }

  async function updateProject(projectId: string, payload: Partial<Project>) {
    await fetchJson(`/api/projects/${projectId}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    });
    await refresh();
  }

  async function confirmReview(item: ReviewItem) {
    await fetchJson(`/api/review/inbox/${item.id}/confirm`, {
      method: "POST",
      body: JSON.stringify({
        reviewerName: "PM",
        ownerId: item.payload.suggestedOwnerId ?? item.payload.ownerId ?? null
      })
    });
    await refresh();
  }

  async function rejectReview(itemId: string) {
    await fetchJson(`/api/review/inbox/${itemId}/reject`, {
      method: "POST",
      body: JSON.stringify({ reviewerName: "PM" })
    });
    await refresh();
  }

  if (loading) {
    return <div className="screen-message">Loading dashboard...</div>;
  }

  if (!dashboard) {
    return <div className="screen-message error">{error ?? "Dashboard unavailable."}</div>;
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">PM Workspace</p>
          <h1>Team Board</h1>
        </div>
        <button className="icon-button labeled" onClick={() => refresh()}>
          <RefreshCw size={16} />
          Refresh
        </button>
      </header>

      {error ? <div className="banner error">{error}</div> : null}

      <SummaryStrip summary={dashboard.summary} generatedFor={dashboard.generatedFor} />

      <section className="workspace-grid">
        <Panel title="TODO" wide>
          <TodoBoard
            people={people}
            columns={dashboard.tasksByOwner}
            unassigned={dashboard.unassigned}
            onAssign={assignTask}
            onUpdateTask={updateTask}
          />
        </Panel>

        <Panel title="Project Progress">
          <div className="stack">
            {dashboard.projectProgress.map((project) => (
              <ProjectCard key={project.id} project={project} onSave={updateProject} />
            ))}
          </div>
        </Panel>

        <Panel title="Review Inbox">
          <div className="stack">
            {reviewItems.length === 0 ? <Empty label="No pending review." /> : null}
            {reviewItems.map((item) => (
              <ReviewCard
                key={item.id}
                item={item}
                people={people}
                onConfirm={confirmReview}
                onReject={rejectReview}
              />
            ))}
          </div>
        </Panel>

        <Panel title="Shared Calendar">
          <CompactCalendar entries={dashboard.calendar} />
        </Panel>

        <Panel title="Memory">
          <MemoryForm people={people} onSaved={refresh} />
          <div className="memory-list">
            {dashboard.memory.map((entry) => (
              <div className="memory-pill" key={entry.id}>
                <CircleDot size={13} />
                <span>{entry.fact}</span>
              </div>
            ))}
          </div>
        </Panel>
      </section>
    </main>
  );
}

function SummaryStrip({ summary, generatedFor }: { summary: Dashboard["summary"]; generatedFor: string }) {
  const items = [
    ["Tasks", summary.taskCount],
    ["Unassigned", summary.unassignedCount],
    ["Overdue", summary.overdueCount],
    ["Blockers", summary.blockerCount]
  ];

  return (
    <section className="summary-strip">
      <span className="date-chip">{generatedFor}</span>
      {items.map(([label, value]) => (
        <div className="metric" key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </section>
  );
}

function Panel({ title, wide = false, children }: { title: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <section className={`panel ${wide ? "panel-wide" : ""}`}>
      <div className="panel-title">
        <h2>{title}</h2>
      </div>
      {children}
    </section>
  );
}

function TodoBoard({
  people,
  columns,
  unassigned,
  onAssign,
  onUpdateTask
}: {
  people: Person[];
  columns: OwnerColumn[];
  unassigned: Task[];
  onAssign: (taskId: string, ownerId: string | null) => Promise<void>;
  onUpdateTask: (taskId: string, payload: Partial<Task>) => Promise<void>;
}) {
  const [dragTaskId, setDragTaskId] = useState<string | null>(null);
  const allColumns = useMemo(
    () => [{ personId: "", personName: "Unassigned", role: "Needs owner", taskCount: unassigned.length, overdueCount: 0, blockerCount: 0, capacityHint: 0, tasks: unassigned }, ...columns],
    [columns, unassigned]
  );

  return (
    <div className="todo-board">
      {allColumns.map((column) => (
        <section
          className="owner-column"
          key={column.personId || "unassigned"}
          onDragOver={(event) => event.preventDefault()}
          onDrop={async () => {
            if (!dragTaskId) return;
            await onAssign(dragTaskId, column.personId || null);
            setDragTaskId(null);
          }}
        >
          <div className="owner-header">
            <div>
              <h3>{column.personName}</h3>
              <span>{column.taskCount} tasks</span>
            </div>
            {column.blockerCount ? <AlertTriangle size={16} className="danger-icon" /> : null}
          </div>
          <div className="stack">
            {column.tasks.length === 0 ? <Empty label="Clear" /> : null}
            {column.tasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                people={people}
                onDragStart={() => setDragTaskId(task.id)}
                onSave={onUpdateTask}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function TaskCard({
  task,
  people,
  onDragStart,
  onSave
}: {
  task: Task;
  people: Person[];
  onDragStart: () => void;
  onSave: (taskId: string, payload: Partial<Task>) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({
    title: task.title,
    description: task.description ?? "",
    status: task.status,
    priority: task.priority,
    dueDate: task.dueDate ?? "",
    ownerId: task.ownerId ?? ""
  });

  useEffect(() => {
    setDraft({
      title: task.title,
      description: task.description ?? "",
      status: task.status,
      priority: task.priority,
      dueDate: task.dueDate ?? "",
      ownerId: task.ownerId ?? ""
    });
  }, [task]);

  return (
    <article className="work-card" draggable onDragStart={onDragStart}>
      <button className="card-main" onClick={() => setOpen((value) => !value)}>
        <GripVertical size={16} className="drag-handle" />
        <div className="card-title-block">
          <strong>{task.title}</strong>
          <span>{task.projectName ?? "No project"} · {task.dueDate ?? "No due date"}</span>
        </div>
        <span className={`chip ${task.priority}`}>{task.priority}</span>
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
      </button>

      {open ? (
        <form
          className="detail-editor"
          onSubmit={async (event) => {
            event.preventDefault();
            await onSave(task.id, {
              ...draft,
              ownerId: draft.ownerId || null,
              dueDate: draft.dueDate || null
            });
          }}
        >
          <label>
            Title
            <input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
          </label>
          <label>
            Description
            <textarea rows={4} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} />
          </label>
          <div className="editor-grid">
            <label>
              Owner
              <select value={draft.ownerId} onChange={(event) => setDraft({ ...draft, ownerId: event.target.value })}>
                <option value="">Unassigned</option>
                {people.map((person) => (
                  <option value={person.id} key={person.id}>{person.name}</option>
                ))}
              </select>
            </label>
            <label>
              Priority
              <select value={draft.priority} onChange={(event) => setDraft({ ...draft, priority: event.target.value as Task["priority"] })}>
                <option value="high">high</option>
                <option value="medium">medium</option>
                <option value="low">low</option>
              </select>
            </label>
            <label>
              Status
              <select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value })}>
                <option value="confirmed">confirmed</option>
                <option value="in_progress">in progress</option>
                <option value="blocked">blocked</option>
                <option value="done">done</option>
              </select>
            </label>
            <label>
              Due
              <input type="date" value={draft.dueDate} onChange={(event) => setDraft({ ...draft, dueDate: event.target.value })} />
            </label>
          </div>
          <button className="icon-button labeled" type="submit">
            <Save size={15} />
            Save
          </button>
        </form>
      ) : null}
    </article>
  );
}

function ProjectCard({ project, onSave }: { project: Project; onSave: (projectId: string, payload: Partial<Project>) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({
    summary: project.summary ?? "",
    phase: project.phase,
    status: project.status,
    progressPercent: project.progressPercent ?? 0,
    importantUpdates: project.importantUpdates ?? ""
  });

  useEffect(() => {
    setDraft({
      summary: project.summary ?? "",
      phase: project.phase,
      status: project.status,
      progressPercent: project.progressPercent ?? 0,
      importantUpdates: project.importantUpdates ?? ""
    });
  }, [project]);

  return (
    <article className="project-card">
      <button className="project-summary" onClick={() => setOpen((value) => !value)}>
        <div>
          <strong>{project.name}</strong>
          <span>{project.phase} · {project.openTasks ?? 0} open</span>
        </div>
        <span className="progress-value">{project.progressPercent ?? 0}%</span>
      </button>
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${project.progressPercent ?? 0}%` }} />
      </div>

      {open ? (
        <form
          className="detail-editor"
          onSubmit={async (event) => {
            event.preventDefault();
            await onSave(project.id, draft);
          }}
        >
          <label>
            Progress
            <input
              type="range"
              min="0"
              max="100"
              value={draft.progressPercent}
              onChange={(event) => setDraft({ ...draft, progressPercent: Number(event.target.value) })}
            />
          </label>
          <label>
            Summary
            <textarea rows={3} value={draft.summary} onChange={(event) => setDraft({ ...draft, summary: event.target.value })} />
          </label>
          <label>
            Important updates
            <textarea rows={4} value={draft.importantUpdates} onChange={(event) => setDraft({ ...draft, importantUpdates: event.target.value })} />
          </label>
          <div className="editor-grid">
            <label>
              Phase
              <input value={draft.phase} onChange={(event) => setDraft({ ...draft, phase: event.target.value })} />
            </label>
            <label>
              Status
              <select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value })}>
                <option value="active">active</option>
                <option value="at_risk">at risk</option>
                <option value="paused">paused</option>
                <option value="done">done</option>
              </select>
            </label>
          </div>
          <button className="icon-button labeled" type="submit">
            <Save size={15} />
            Save
          </button>
        </form>
      ) : null}
    </article>
  );
}

function ReviewCard({
  item,
  people,
  onConfirm,
  onReject
}: {
  item: ReviewItem;
  people: Person[];
  onConfirm: (item: ReviewItem) => Promise<void>;
  onReject: (itemId: string) => Promise<void>;
}) {
  const owner = people.find((person) => person.id === item.payload.suggestedOwnerId);
  return (
    <article className="review-card">
      <div className="review-main">
        <div>
          <strong>{item.payload.title}</strong>
          <span>{owner?.name ?? "Unassigned"} · {Math.round(item.confidence * 100)}%</span>
        </div>
        <div className="row-actions">
          <button className="icon-button success" onClick={() => onConfirm(item)} title="Confirm">
            <Check size={16} />
          </button>
          <button className="icon-button quiet" onClick={() => onReject(item.id)} title="Reject">
            <X size={16} />
          </button>
        </div>
      </div>
    </article>
  );
}

function CompactCalendar({ entries }: { entries: Dashboard["calendar"] }) {
  if (entries.length === 0) {
    return <Empty label="No calendar entries." />;
  }

  return (
    <div className="stack">
      {entries.slice(0, 8).map((entry) => (
        <div className="calendar-row" key={entry.id}>
          <CalendarDays size={16} />
          <div>
            <strong>{entry.ownerName ?? entry.teamScope}</strong>
            <span>{entry.category} · {entry.projectName ?? "General"}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function MemoryForm({ people, onSaved }: { people: Person[]; onSaved: () => Promise<void> }) {
  const [authorId, setAuthorId] = useState(people[0]?.id ?? "");
  const [logSummary, setLogSummary] = useState("");
  const [memoryFact, setMemoryFact] = useState("");

  useEffect(() => {
    if (!authorId && people[0]) {
      setAuthorId(people[0].id);
    }
  }, [authorId, people]);

  return (
    <div className="quick-forms">
      <form
        className="quick-form"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!logSummary.trim()) return;
          await fetchJson("/api/logs/daily", {
            method: "POST",
            body: JSON.stringify({ authorId, summary: logSummary })
          });
          setLogSummary("");
          await onSaved();
        }}
      >
        <select value={authorId} onChange={(event) => setAuthorId(event.target.value)}>
          {people.map((person) => (
            <option value={person.id} key={person.id}>{person.name}</option>
          ))}
        </select>
        <input value={logSummary} onChange={(event) => setLogSummary(event.target.value)} placeholder="Daily log" />
        <button className="icon-button" title="Save daily log"><Save size={15} /></button>
      </form>
      <form
        className="quick-form"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!memoryFact.trim()) return;
          await fetchJson("/api/memory", {
            method: "POST",
            body: JSON.stringify({ scopeType: "team", fact: memoryFact })
          });
          setMemoryFact("");
          await onSaved();
        }}
      >
        <UserRound size={16} />
        <input value={memoryFact} onChange={(event) => setMemoryFact(event.target.value)} placeholder="Team memory" />
        <button className="icon-button" title="Save memory"><Save size={15} /></button>
      </form>
    </div>
  );
}

function Empty({ label }: { label: string }) {
  return <p className="empty">{label}</p>;
}

createRoot(document.getElementById("root")!).render(<App />);
