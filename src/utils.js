import crypto from "node:crypto";

export const TODAY = "2026-07-24";

export function nowIso() {
  return new Date().toISOString();
}

export function createId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function safeJsonParse(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function normalizeWhitespace(value) {
  return value.replace(/\s+/g, " ").trim();
}

export function titleCaseTask(value) {
  const cleaned = normalizeWhitespace(value)
    .replace(/^["“”]+|["“”]+$/g, "")
    .replace(/\.$/, "");
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

export function inferPriorityFromText(text) {
  const value = text.toLowerCase();
  if (/(asap|urgent|today|now|close to be ready|let's start)/.test(value)) {
    return "high";
  }
  if (/(monday|tomorrow|question|should|need to)/.test(value)) {
    return "medium";
  }
  return "low";
}

export function scoreLoad(taskCount, overdueCount, blockerCount) {
  return taskCount * 2 + overdueCount * 3 + blockerCount * 4;
}
