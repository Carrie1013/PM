async function fetchJson(url, options) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json();
}

const state = {
  people: [],
  projects: []
};

async function loadBootstrap() {
  const data = await fetchJson("/api/bootstrap");
  state.people = data.people;
  state.projects = data.projects;

  const logAuthor = document.querySelector("#logAuthor");
  logAuthor.innerHTML = state.people
    .map((person) => `<option value="${person.id}">${person.name}</option>`)
    .join("");
}

function renderSummary(summary, generatedFor) {
  document.querySelector("#summaryDate").textContent = `Generated for ${generatedFor}`;
  const cards = [
    { label: "Tracked tasks", value: summary.taskCount },
    { label: "Unassigned", value: summary.unassignedCount },
    { label: "Overdue", value: summary.overdueCount },
    { label: "Blockers", value: summary.blockerCount }
  ];
  document.querySelector("#summaryCards").innerHTML = cards
    .map((card) => `
      <div class="summary-card">
        <span>${card.label}</span>
        <strong>${card.value}</strong>
      </div>
    `)
    .join("");
}

function renderReviewInbox(items) {
  const container = document.querySelector("#reviewInbox");
  const template = document.querySelector("#reviewItemTemplate");

  if (items.length === 0) {
    container.innerHTML = `<p class="empty-state">No pending review items.</p>`;
    return;
  }

  container.innerHTML = "";

  items.forEach((item) => {
    const node = template.content.cloneNode(true);
    const owner = state.people.find((person) => person.id === item.payload.suggestedOwnerId);
    node.querySelector(".confidence").textContent = `${Math.round(item.confidence * 100)}% confidence`;
    node.querySelector(".title").textContent = item.payload.title;
    node.querySelector(".description").textContent = item.payload.description;
    node.querySelector(".owner").textContent = owner?.name ?? "Unassigned";
    node.querySelector(".priority").textContent = item.payload.priority ?? "medium";
    node.querySelector(".due").textContent = item.payload.dueDate ?? "No due date";
    node.querySelector(".source").textContent = item.sourceOrigin;
    node.querySelector(".confirm").addEventListener("click", async () => {
      await fetchJson(`/api/review/inbox/${item.id}/confirm`, {
        method: "POST",
        body: JSON.stringify({
          reviewerName: "PM",
          ownerId: item.payload.suggestedOwnerId ?? item.payload.ownerId ?? null
        })
      });
      await refreshDashboard();
    });
    node.querySelector(".reject").addEventListener("click", async () => {
      await fetchJson(`/api/review/inbox/${item.id}/reject`, {
        method: "POST",
        body: JSON.stringify({ reviewerName: "PM" })
      });
      await refreshDashboard();
    });
    container.appendChild(node);
  });
}

function renderCapacity(items) {
  const container = document.querySelector("#capacityBoard");
  container.innerHTML = items
    .map((item) => `
      <article class="card">
        <div class="card-top">
          <strong>${item.personName}</strong>
          <span class="chip ${chipClass(item.balanceState)}">${item.balanceState}</span>
        </div>
        <p class="muted">${item.role}</p>
        <dl class="meta-grid">
          <div><dt>Tasks</dt><dd>${item.taskCount}</dd></div>
          <div><dt>Overdue</dt><dd>${item.overdueCount}</dd></div>
          <div><dt>Blockers</dt><dd>${item.blockerCount}</dd></div>
          <div><dt>Utilization</dt><dd>${item.utilization}</dd></div>
        </dl>
      </article>
    `)
    .join("");
}

function renderTodoBoard(tasksByOwner, unassigned) {
  const board = document.querySelector("#todoBoard");
  const columns = tasksByOwner.map((owner) => {
    const tasks = owner.tasks.length
      ? owner.tasks.map(renderTaskCard).join("")
      : `<p class="empty-state">No confirmed tasks.</p>`;
    return `
      <section class="todo-column">
        <div class="todo-column-header">
          <h3>${owner.personName}</h3>
          <span>${owner.taskCount} tasks</span>
        </div>
        ${tasks}
      </section>
    `;
  });

  if (unassigned.length) {
    columns.unshift(`
      <section class="todo-column">
        <div class="todo-column-header">
          <h3>Unassigned</h3>
          <span>${unassigned.length} tasks</span>
        </div>
        ${unassigned.map(renderTaskCard).join("")}
      </section>
    `);
  }

  board.innerHTML = columns.join("");
}

function renderTaskCard(task) {
  return `
    <article class="card task-card">
      <div class="card-top">
        <span class="chip ${chipClass(task.priority)}">${task.priority}</span>
        ${task.blockerFlag ? `<span class="chip chip-danger">blocker</span>` : ""}
      </div>
      <h4>${task.title}</h4>
      <p>${task.projectName ?? "No project linked"}</p>
      <p class="muted">${task.dueDate ?? "No due date"} · ${task.status}</p>
    </article>
  `;
}

function renderProjects(items) {
  document.querySelector("#projectProgress").innerHTML = items
    .map((project) => `
      <article class="card">
        <div class="card-top">
          <strong>${project.name}</strong>
          <span class="chip chip-neutral">${project.phase}</span>
        </div>
        <p>${project.openTasks} open / ${project.totalTasks} total</p>
      </article>
    `)
    .join("");
}

function renderCalendar(entries) {
  document.querySelector("#calendarEntries").innerHTML = entries.length
    ? entries.map((entry) => `
        <article class="card">
          <strong>${entry.ownerName ?? entry.teamScope}</strong>
          <p>${entry.category} · ${entry.projectName ?? "General work"}</p>
          <p class="muted">${entry.startAt} to ${entry.endAt}</p>
        </article>
      `).join("")
    : `<p class="empty-state">No calendar entries yet.</p>`;
}

function renderDigest(digest) {
  const panel = document.querySelector("#digestPanel");
  panel.innerHTML = `
    <article class="card">
      <h3>Top priorities</h3>
      ${renderList(digest.topPriorities.map((item) => `${item.title} (${item.ownerName ?? "unassigned"})`))}
    </article>
    <article class="card">
      <h3>Due soon</h3>
      ${renderList(digest.dueSoon.map((item) => `${item.title} · ${item.dueDate ?? "no due date"}`))}
    </article>
    <article class="card">
      <h3>Workload highlights</h3>
      ${renderList(digest.workloadHighlights)}
    </article>
    <article class="card">
      <h3>Notes</h3>
      ${renderList(digest.notes)}
    </article>
  `;
}

function renderList(items) {
  if (!items.length) {
    return `<p class="empty-state">Nothing to show.</p>`;
  }
  return `<ul>${items.map((item) => `<li>${item}</li>`).join("")}</ul>`;
}

function chipClass(value) {
  if (value === "high" || value === "overloaded") {
    return "chip-danger";
  }
  if (value === "medium" || value === "balanced") {
    return "chip-warning";
  }
  if (value === "low" || value === "underloaded") {
    return "chip-success";
  }
  return "chip-neutral";
}

async function refreshDashboard() {
  const [dashboard, reviewInbox, capacity, digest] = await Promise.all([
    fetchJson("/api/dashboard/daily"),
    fetchJson("/api/review/inbox"),
    fetchJson("/api/dashboard/capacity"),
    fetchJson("/api/digest/daily")
  ]);

  renderSummary(dashboard.summary, dashboard.generatedFor);
  renderReviewInbox(reviewInbox.items);
  renderCapacity(capacity.items);
  renderTodoBoard(dashboard.tasksByOwner, dashboard.unassigned);
  renderProjects(dashboard.projectProgress);
  renderCalendar(dashboard.calendar);
  renderDigest(digest);
}

document.querySelector("#refreshButton").addEventListener("click", refreshDashboard);

document.querySelector("#logForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  await fetchJson("/api/logs/daily", {
    method: "POST",
    body: JSON.stringify({
      authorId: document.querySelector("#logAuthor").value,
      summary: document.querySelector("#logSummary").value
    })
  });
  document.querySelector("#logSummary").value = "";
  await refreshDashboard();
});

document.querySelector("#memoryForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  await fetchJson("/api/memory", {
    method: "POST",
    body: JSON.stringify({
      scopeType: document.querySelector("#memoryScope").value,
      fact: document.querySelector("#memoryFact").value
    })
  });
  document.querySelector("#memoryFact").value = "";
  await refreshDashboard();
});

await loadBootstrap();
await refreshDashboard();
