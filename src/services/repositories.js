import { createId, nowIso, safeJsonParse, scoreLoad, TODAY } from "../utils.js";

export function importSourceDocument(db, payload) {
  const now = nowIso();
  const record = {
    id: createId("source"),
    source_type: payload.sourceType,
    origin: payload.origin,
    import_batch: payload.importBatch ?? `manual-${TODAY}`,
    source_timestamp: payload.sourceTimestamp ?? TODAY,
    raw_content: payload.rawContent,
    created_at: now
  };

  db.prepare(`
    INSERT INTO source_documents (
      id, source_type, origin, import_batch, source_timestamp, raw_content, created_at
    ) VALUES (
      @id, @source_type, @origin, @import_batch, @source_timestamp, @raw_content, @created_at
    )
  `).run(record);

  return record;
}

export function listReviewInbox(db) {
  const rows = db.prepare(`
    SELECT r.*, s.origin, s.source_type
    FROM review_queue_items r
    JOIN source_documents s ON s.id = r.source_document_id
    WHERE r.review_state = 'pending'
    ORDER BY r.created_at DESC
  `).all();

  return rows.map((row) => ({
    id: row.id,
    itemType: row.item_type,
    confidence: row.confidence,
    reviewState: row.review_state,
    sourceDocumentId: row.source_document_id,
    sourceOrigin: row.origin,
    sourceType: row.source_type,
    duplicateCandidates: safeJsonParse(row.duplicate_candidates_json, []),
    payload: safeJsonParse(row.extracted_payload_json, {})
  }));
}

export function confirmReviewItem(db, reviewItemId, body) {
  const reviewItem = db.prepare("SELECT * FROM review_queue_items WHERE id = ?").get(reviewItemId);
  if (!reviewItem) {
    return null;
  }

  const now = nowIso();
  const payload = {
    ...safeJsonParse(reviewItem.extracted_payload_json, {}),
    ...body
  };

  const workItemId = createId("work");

  db.prepare(`
    INSERT INTO work_items (
      id, title, description, status, priority, due_date, owner_id, suggested_owner_id,
      project_id, blocker_flag, confidence, source_document_id, source_excerpt,
      last_activity_at, created_at, updated_at
    ) VALUES (
      @id, @title, @description, @status, @priority, @due_date, @owner_id, @suggested_owner_id,
      @project_id, @blocker_flag, @confidence, @source_document_id, @source_excerpt,
      @last_activity_at, @created_at, @updated_at
    )
  `).run({
    id: workItemId,
    title: payload.title,
    description: payload.description,
    status: body.status ?? "confirmed",
    priority: body.priority ?? payload.priority ?? "medium",
    due_date: body.dueDate ?? payload.dueDate ?? null,
    owner_id: body.ownerId ?? payload.ownerId ?? null,
    suggested_owner_id: payload.suggestedOwnerId ?? null,
    project_id: body.projectId ?? payload.projectId ?? null,
    blocker_flag: body.blockerFlag ?? payload.blockerFlag ?? 0,
    confidence: payload.confidence ?? reviewItem.confidence,
    source_document_id: reviewItem.source_document_id,
    source_excerpt: payload.sourceExcerpt ?? null,
    last_activity_at: now,
    created_at: now,
    updated_at: now
  });

  db.prepare(`
    INSERT INTO work_assignment_decisions (
      id, work_item_id, recommended_owner_id, final_owner_id, reviewer_name, reason, created_at
    ) VALUES (
      @id, @work_item_id, @recommended_owner_id, @final_owner_id, @reviewer_name, @reason, @created_at
    )
  `).run({
    id: createId("assign"),
    work_item_id: workItemId,
    recommended_owner_id: payload.suggestedOwnerId ?? null,
    final_owner_id: body.ownerId ?? payload.ownerId ?? null,
    reviewer_name: body.reviewerName ?? "PM",
    reason: body.reason ?? "Confirmed from review inbox",
    created_at: now
  });

  db.prepare(`
    UPDATE review_queue_items
    SET review_state = 'confirmed', linked_work_item_id = ?, updated_at = ?
    WHERE id = ?
  `).run(workItemId, now, reviewItemId);

  return getWorkItem(db, workItemId);
}

export function rejectReviewItem(db, reviewItemId, reviewerName) {
  const result = db.prepare(`
    UPDATE review_queue_items
    SET review_state = 'rejected', updated_at = ?
    WHERE id = ?
  `).run(nowIso(), reviewItemId);

  return result.changes > 0 ? { id: reviewItemId, reviewerName } : null;
}

export function getWorkItem(db, workItemId) {
  const row = db.prepare(`
    SELECT w.*, p.name AS owner_name, sp.name AS suggested_owner_name, pr.name AS project_name
    FROM work_items w
    LEFT JOIN person_profiles p ON p.id = w.owner_id
    LEFT JOIN person_profiles sp ON sp.id = w.suggested_owner_id
    LEFT JOIN projects pr ON pr.id = w.project_id
    WHERE w.id = ?
  `).get(workItemId);

  if (!row) {
    return null;
  }

  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    dueDate: row.due_date,
    ownerId: row.owner_id,
    ownerName: row.owner_name,
    suggestedOwnerId: row.suggested_owner_id,
    suggestedOwnerName: row.suggested_owner_name,
    projectId: row.project_id,
    projectName: row.project_name,
    blockerFlag: Boolean(row.blocker_flag),
    confidence: row.confidence,
    sourceDocumentId: row.source_document_id,
    sourceExcerpt: row.source_excerpt,
    lastActivityAt: row.last_activity_at
  };
}

export function upsertTask(db, body) {
  const now = nowIso();

  if (body.id) {
    db.prepare(`
      UPDATE work_items
      SET title = @title,
          description = @description,
          status = @status,
          priority = @priority,
          due_date = @due_date,
          owner_id = @owner_id,
          suggested_owner_id = @suggested_owner_id,
          project_id = @project_id,
          blocker_flag = @blocker_flag,
          updated_at = @updated_at,
          last_activity_at = @last_activity_at
      WHERE id = @id
    `).run({
      id: body.id,
      title: body.title,
      description: body.description ?? "",
      status: body.status ?? "confirmed",
      priority: body.priority ?? "medium",
      due_date: body.dueDate ?? null,
      owner_id: body.ownerId ?? null,
      suggested_owner_id: body.suggestedOwnerId ?? null,
      project_id: body.projectId ?? null,
      blocker_flag: body.blockerFlag ? 1 : 0,
      updated_at: now,
      last_activity_at: now
    });
    return getWorkItem(db, body.id);
  }

  const id = createId("work");
  db.prepare(`
    INSERT INTO work_items (
      id, title, description, status, priority, due_date, owner_id, suggested_owner_id,
      project_id, blocker_flag, confidence, source_document_id, source_excerpt,
      last_activity_at, created_at, updated_at
    ) VALUES (
      @id, @title, @description, @status, @priority, @due_date, @owner_id, @suggested_owner_id,
      @project_id, @blocker_flag, @confidence, @source_document_id, @source_excerpt,
      @last_activity_at, @created_at, @updated_at
    )
  `).run({
    id,
    title: body.title,
    description: body.description ?? "",
    status: body.status ?? "confirmed",
    priority: body.priority ?? "medium",
    due_date: body.dueDate ?? null,
    owner_id: body.ownerId ?? null,
    suggested_owner_id: body.suggestedOwnerId ?? null,
    project_id: body.projectId ?? null,
    blocker_flag: body.blockerFlag ? 1 : 0,
    confidence: body.confidence ?? 1,
    source_document_id: body.sourceDocumentId ?? null,
    source_excerpt: body.sourceExcerpt ?? null,
    last_activity_at: now,
    created_at: now,
    updated_at: now
  });
  return getWorkItem(db, id);
}

export function updateTask(db, workItemId, body) {
  const existing = getWorkItem(db, workItemId);
  if (!existing) {
    return null;
  }

  return upsertTask(db, {
    id: workItemId,
    title: body.title ?? existing.title,
    description: body.description ?? existing.description ?? "",
    status: body.status ?? existing.status,
    priority: body.priority ?? existing.priority,
    dueDate: body.dueDate ?? existing.dueDate ?? null,
    ownerId: body.ownerId ?? existing.ownerId ?? null,
    suggestedOwnerId: body.suggestedOwnerId ?? existing.suggestedOwnerId ?? null,
    projectId: body.projectId ?? existing.projectId ?? null,
    blockerFlag: body.blockerFlag ?? existing.blockerFlag
  });
}

export function recordAssignmentDecision(db, workItemId, body) {
  const now = nowIso();
  const existing = getWorkItem(db, workItemId);
  if (!existing) {
    return null;
  }

  db.prepare(`
    UPDATE work_items
    SET owner_id = ?, suggested_owner_id = ?, updated_at = ?, last_activity_at = ?
    WHERE id = ?
  `).run(body.finalOwnerId ?? existing.ownerId, body.recommendedOwnerId ?? existing.suggestedOwnerId, now, now, workItemId);

  db.prepare(`
    INSERT INTO work_assignment_decisions (
      id, work_item_id, recommended_owner_id, final_owner_id, reviewer_name, reason, created_at
    ) VALUES (
      @id, @work_item_id, @recommended_owner_id, @final_owner_id, @reviewer_name, @reason, @created_at
    )
  `).run({
    id: createId("assign"),
    work_item_id: workItemId,
    recommended_owner_id: body.recommendedOwnerId ?? existing.suggestedOwnerId ?? null,
    final_owner_id: body.finalOwnerId ?? existing.ownerId ?? null,
    reviewer_name: body.reviewerName ?? "PM",
    reason: body.reason ?? "Assignment updated",
    created_at: now
  });

  return getWorkItem(db, workItemId);
}

export function createDailyLog(db, body) {
  const id = createId("log");
  db.prepare(`
    INSERT INTO daily_logs (
      id, author_id, log_date, summary, linked_projects_json, linked_tasks_json, visibility, source_type, created_at
    ) VALUES (
      @id, @author_id, @log_date, @summary, @linked_projects_json, @linked_tasks_json, @visibility, @source_type, @created_at
    )
  `).run({
    id,
    author_id: body.authorId ?? null,
    log_date: body.logDate ?? TODAY,
    summary: body.summary,
    linked_projects_json: JSON.stringify(body.linkedProjectIds ?? []),
    linked_tasks_json: JSON.stringify(body.linkedTaskIds ?? []),
    visibility: body.visibility ?? "internal",
    source_type: body.sourceType ?? "manual",
    created_at: nowIso()
  });
  return { id, ...body };
}

export function createMemoryRecord(db, body) {
  const now = nowIso();
  const id = createId("memory");
  db.prepare(`
    INSERT INTO memory_records (
      id, scope_type, scope_id, fact, confidence, source_document_id, validity_state,
      last_confirmed_date, created_at, updated_at
    ) VALUES (
      @id, @scope_type, @scope_id, @fact, @confidence, @source_document_id, @validity_state,
      @last_confirmed_date, @created_at, @updated_at
    )
  `).run({
    id,
    scope_type: body.scopeType,
    scope_id: body.scopeId ?? null,
    fact: body.fact,
    confidence: body.confidence ?? 1,
    source_document_id: body.sourceDocumentId ?? null,
    validity_state: body.validityState ?? "active",
    last_confirmed_date: body.lastConfirmedDate ?? TODAY,
    created_at: now,
    updated_at: now
  });
  return { id, ...body };
}

export function listPeople(db) {
  return db.prepare(`
    SELECT id, name, role, team, skills_json, capacity_hint, active_status
    FROM person_profiles
    ORDER BY name
  `).all().map((row) => ({
    id: row.id,
    name: row.name,
    role: row.role,
    team: row.team,
    skills: safeJsonParse(row.skills_json, []),
    capacityHint: row.capacity_hint,
    activeStatus: row.active_status
  }));
}

export function listProjects(db) {
  return db.prepare(`
    SELECT id, name, summary, status, phase, progress_percent, important_updates
    FROM projects
    ORDER BY name
  `).all().map((row) => ({
    id: row.id,
    name: row.name,
    summary: row.summary,
    status: row.status,
    phase: row.phase,
    progressPercent: row.progress_percent,
    importantUpdates: row.important_updates
  }));
}

export function updateProject(db, projectId, body) {
  const existing = db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId);
  if (!existing) {
    return null;
  }

  const progressPercent = Math.max(0, Math.min(100, Number(body.progressPercent ?? existing.progress_percent ?? 0)));
  const now = nowIso();

  db.prepare(`
    UPDATE projects
    SET name = @name,
        summary = @summary,
        status = @status,
        phase = @phase,
        progress_percent = @progress_percent,
        important_updates = @important_updates,
        updated_at = @updated_at
    WHERE id = @id
  `).run({
    id: projectId,
    name: body.name ?? existing.name,
    summary: body.summary ?? existing.summary ?? "",
    status: body.status ?? existing.status,
    phase: body.phase ?? existing.phase,
    progress_percent: progressPercent,
    important_updates: body.importantUpdates ?? existing.important_updates ?? "",
    updated_at: now
  });

  return listProjects(db).find((project) => project.id === projectId);
}

export function listCalendarEntries(db) {
  return db.prepare(`
    SELECT c.*, p.name AS owner_name, pr.name AS project_name, w.title AS work_title
    FROM calendar_entries c
    LEFT JOIN person_profiles p ON p.id = c.owner_id
    LEFT JOIN projects pr ON pr.id = c.project_id
    LEFT JOIN work_items w ON w.id = c.work_item_id
    ORDER BY c.start_at ASC
  `).all().map((row) => ({
    id: row.id,
    ownerName: row.owner_name,
    teamScope: row.team_scope,
    startAt: row.start_at,
    endAt: row.end_at,
    category: row.category,
    projectName: row.project_name,
    workTitle: row.work_title,
    editableNotes: row.editable_notes
  }));
}

export function createCalendarEntry(db, body) {
  const now = nowIso();
  const id = createId("calendar");
  db.prepare(`
    INSERT INTO calendar_entries (
      id, owner_id, team_scope, start_at, end_at, category, project_id, work_item_id,
      editable_notes, created_at, updated_at
    ) VALUES (
      @id, @owner_id, @team_scope, @start_at, @end_at, @category, @project_id, @work_item_id,
      @editable_notes, @created_at, @updated_at
    )
  `).run({
    id,
    owner_id: body.ownerId ?? null,
    team_scope: body.teamScope ?? "Investment Team",
    start_at: body.startAt,
    end_at: body.endAt,
    category: body.category ?? "focus",
    project_id: body.projectId ?? null,
    work_item_id: body.workItemId ?? null,
    editable_notes: body.editableNotes ?? "",
    created_at: now,
    updated_at: now
  });
  return { id, ...body };
}

export function getDashboardPayload(db) {
  const tasks = db.prepare(`
    SELECT w.*, p.name AS owner_name, sp.name AS suggested_owner_name, pr.name AS project_name
    FROM work_items w
    LEFT JOIN person_profiles p ON p.id = w.owner_id
    LEFT JOIN person_profiles sp ON sp.id = w.suggested_owner_id
    LEFT JOIN projects pr ON pr.id = w.project_id
    WHERE w.status != 'rejected'
    ORDER BY
      CASE w.priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
      COALESCE(w.due_date, '9999-12-31'),
      w.updated_at DESC
  `).all();

  const people = listPeople(db);
  const projects = listProjects(db);
  const calendar = listCalendarEntries(db);
  const logs = db.prepare(`
    SELECT d.id, d.log_date, d.summary, p.name AS author_name
    FROM daily_logs d
    LEFT JOIN person_profiles p ON p.id = d.author_id
    ORDER BY d.log_date DESC, d.created_at DESC
    LIMIT 8
  `).all();
  const memory = db.prepare(`
    SELECT id, scope_type, fact, last_confirmed_date, validity_state
    FROM memory_records
    WHERE validity_state = 'active'
    ORDER BY updated_at DESC
    LIMIT 8
  `).all();

  const tasksByOwner = people.map((person) => {
    const owned = tasks.filter((task) => task.owner_id === person.id);
    const overdue = owned.filter((task) => task.due_date && task.due_date < TODAY && task.status !== "done").length;
    const blockers = owned.filter((task) => task.blocker_flag).length;
    return {
      personId: person.id,
      personName: person.name,
      role: person.role,
      taskCount: owned.length,
      overdueCount: overdue,
      blockerCount: blockers,
      loadScore: scoreLoad(owned.length, overdue, blockers),
      capacityHint: person.capacityHint,
      tasks: owned.map((task) => mapTask(task))
    };
  });

  const unassigned = tasks.filter((task) => !task.owner_id).map(mapTask);
  const overdue = tasks.filter((task) => task.due_date && task.due_date < TODAY && task.status !== "done").map(mapTask);
  const stale = tasks.filter((task) => task.last_activity_at.slice(0, 10) < "2026-07-20" && task.status !== "done").map(mapTask);
  const blockers = tasks.filter((task) => task.blocker_flag).map(mapTask);

  const projectProgress = projects.map((project) => {
    const linked = tasks.filter((task) => task.project_id === project.id);
    const done = linked.filter((task) => task.status === "done").length;
    const derivedProgress = linked.length === 0 ? 0 : Math.round((done / linked.length) * 100);
    const progressPercent = project.progressPercent || derivedProgress;
    return {
      id: project.id,
      name: project.name,
      status: project.status,
      phase: project.phase,
      summary: project.summary,
      progressPercent,
      importantUpdates: project.importantUpdates,
      totalTasks: linked.length,
      doneTasks: done,
      openTasks: linked.length - done
    };
  });

  return {
    generatedFor: TODAY,
    summary: {
      taskCount: tasks.length,
      unassignedCount: unassigned.length,
      overdueCount: overdue.length,
      blockerCount: blockers.length
    },
    tasksByOwner,
    unassigned,
    overdue,
    stale,
    blockers,
    tasks: tasks.map(mapTask),
    projectProgress,
    calendar,
    logs,
    memory
  };
}

export function getCapacityPayload(db) {
  const dashboard = getDashboardPayload(db);
  return dashboard.tasksByOwner
    .map((person) => ({
      ...person,
      utilization: person.capacityHint === 0 ? 0 : Number((person.taskCount / person.capacityHint).toFixed(2)),
      balanceState:
        person.taskCount === 0 ? "underloaded" :
        person.taskCount > person.capacityHint ? "overloaded" :
        "balanced"
    }))
    .sort((a, b) => b.loadScore - a.loadScore);
}

export function getDailyDigest(db) {
  const dashboard = getDashboardPayload(db);
  const reviewCount = db.prepare("SELECT COUNT(*) AS count FROM review_queue_items WHERE review_state = 'pending'").get().count;
  const topOwners = dashboard.tasksByOwner
    .filter((entry) => entry.taskCount > 0)
    .sort((a, b) => b.loadScore - a.loadScore)
    .slice(0, 3)
    .map((entry) => `${entry.personName}: ${entry.taskCount} tasks, ${entry.overdueCount} overdue, ${entry.blockerCount} blockers`);

  const notes = [
    `${dashboard.summary.taskCount} confirmed tasks are currently tracked.`,
    `${dashboard.summary.unassignedCount} tasks still need ownership.`,
    `${reviewCount} extracted items are waiting for PM review.`
  ];

  return {
    generatedFor: TODAY,
    headline: "Daily PM operations digest",
    topPriorities: dashboard.tasks
      .filter((task) => task.priority === "high")
      .slice(0, 5),
    dueSoon: dashboard.tasks
      .filter((task) => task.dueDate && task.dueDate <= "2026-07-27" && task.status !== "done")
      .slice(0, 8),
    blockers: dashboard.blockers,
    workloadHighlights: topOwners,
    projectHighlights: dashboard.projectProgress.filter((project) => project.openTasks > 0).slice(0, 4),
    notes
  };
}

function mapTask(task) {
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    dueDate: task.due_date,
    ownerId: task.owner_id,
    ownerName: task.owner_name,
    suggestedOwnerName: task.suggested_owner_name,
    projectId: task.project_id,
    projectName: task.project_name,
    blockerFlag: Boolean(task.blocker_flag),
    confidence: task.confidence,
    sourceExcerpt: task.source_excerpt,
    lastActivityAt: task.last_activity_at
  };
}
