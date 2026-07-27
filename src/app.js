import express from "express";
import path from "node:path";
import { createDatabase } from "./db.js";
import { ensureBootstrapData } from "./services/bootstrap.js";
import { processSourceDocument } from "./services/extractor.js";
import {
  confirmReviewItem,
  createCalendarEntry,
  createDailyLog,
  createMemoryRecord,
  getCapacityPayload,
  getDailyDigest,
  getDashboardPayload,
  importSourceDocument,
  listPeople,
  listProjects,
  listReviewInbox,
  rejectReviewItem,
  recordAssignmentDecision,
  updateProject,
  updateTask,
  upsertTask
} from "./services/repositories.js";

export function createApp() {
  const db = createDatabase();
  ensureBootstrapData(db);
  const app = express();
  app.locals.db = db;

  app.use(express.json());
  app.use(express.static(path.resolve("public")));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/api/bootstrap", (_req, res) => {
    res.json({
      people: listPeople(db),
      projects: listProjects(db)
    });
  });

  app.post("/api/sources/import", (req, res) => {
    const { sourceType, origin, rawContent, importBatch, sourceTimestamp } = req.body;
    if (!sourceType || !origin || !rawContent) {
      return res.status(400).json({ error: "sourceType, origin, and rawContent are required" });
    }
    const source = importSourceDocument(db, { sourceType, origin, rawContent, importBatch, sourceTimestamp });
    return res.status(201).json(source);
  });

  app.post("/api/sources/process", (req, res) => {
    const { sourceDocumentId } = req.body;
    if (!sourceDocumentId) {
      return res.status(400).json({ error: "sourceDocumentId is required" });
    }
    const items = processSourceDocument(db, sourceDocumentId);
    return res.json({ sourceDocumentId, created: items.length, items });
  });

  app.get("/api/review/inbox", (_req, res) => {
    res.json({ items: listReviewInbox(db) });
  });

  app.post("/api/review/inbox/:id/confirm", (req, res) => {
    const item = confirmReviewItem(db, req.params.id, req.body);
    if (!item) {
      return res.status(404).json({ error: "Review item not found" });
    }
    return res.json(item);
  });

  app.post("/api/review/inbox/:id/reject", (req, res) => {
    const result = rejectReviewItem(db, req.params.id, req.body.reviewerName ?? "PM");
    if (!result) {
      return res.status(404).json({ error: "Review item not found" });
    }
    return res.json(result);
  });

  app.get("/api/dashboard/daily", (_req, res) => {
    res.json(getDashboardPayload(db));
  });

  app.get("/api/dashboard/capacity", (_req, res) => {
    res.json({ generatedFor: "2026-07-24", items: getCapacityPayload(db) });
  });

  app.post("/api/tasks", (req, res) => {
    if (!req.body.title) {
      return res.status(400).json({ error: "title is required" });
    }
    const item = upsertTask(db, req.body);
    return res.status(req.body.id ? 200 : 201).json(item);
  });

  app.post("/api/tasks/:id/assign", (req, res) => {
    const item = recordAssignmentDecision(db, req.params.id, req.body);
    if (!item) {
      return res.status(404).json({ error: "Task not found" });
    }
    return res.json(item);
  });

  app.patch("/api/tasks/:id", (req, res) => {
    const item = updateTask(db, req.params.id, req.body);
    if (!item) {
      return res.status(404).json({ error: "Task not found" });
    }
    return res.json(item);
  });

  app.patch("/api/projects/:id", (req, res) => {
    const project = updateProject(db, req.params.id, req.body);
    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }
    return res.json(project);
  });

  app.post("/api/logs/daily", (req, res) => {
    if (!req.body.summary) {
      return res.status(400).json({ error: "summary is required" });
    }
    return res.status(201).json(createDailyLog(db, req.body));
  });

  app.post("/api/memory", (req, res) => {
    if (!req.body.scopeType || !req.body.fact) {
      return res.status(400).json({ error: "scopeType and fact are required" });
    }
    return res.status(201).json(createMemoryRecord(db, req.body));
  });

  app.post("/api/calendar", (req, res) => {
    if (!req.body.startAt || !req.body.endAt) {
      return res.status(400).json({ error: "startAt and endAt are required" });
    }
    return res.status(201).json(createCalendarEntry(db, req.body));
  });

  app.get("/api/digest/daily", (_req, res) => {
    res.json(getDailyDigest(db));
  });

  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api/")) {
      return next();
    }
    return res.sendFile(path.resolve("public/index.html"));
  });

  return app;
}
