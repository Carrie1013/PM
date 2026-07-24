import { createId, inferPriorityFromText, normalizeWhitespace, nowIso, TODAY, titleCaseTask } from "../utils.js";

const projectMatchers = [
  { pattern: /mark proposal/i, name: "Mark Proposal" },
  { pattern: /tax monitoring|tax transition|frontierone_tax_monitoring_mockup/i, name: "Tax Monitoring Demo" },
  { pattern: /household optimization demo/i, name: "Household Optimization Demo" },
  { pattern: /core with alts|alts preference|income preference sweep/i, name: "Core With Alts Sweep" }
];

function detectSpeakerName(line) {
  const names = ["Carrie Feng", "Joy Zheng", "Helen Luo", "Jane Bai", "Robert Michaud"];
  return names.find((name) => line.toLowerCase().startsWith(name.toLowerCase()));
}

function extractDueDate(line) {
  const value = line.toLowerCase();
  if (value.includes("monday")) {
    return "2026-07-27";
  }
  if (value.includes("tomorrow")) {
    return "2026-07-25";
  }
  if (value.includes("today")) {
    return TODAY;
  }
  return null;
}

function detectProjectId(db, line) {
  for (const matcher of projectMatchers) {
    if (matcher.pattern.test(line)) {
      const project = db.prepare("SELECT id FROM projects WHERE name = ?").get(matcher.name);
      if (project) {
        return project.id;
      }
    }
  }
  return null;
}

function findPersonIdByName(db, name) {
  if (!name) {
    return null;
  }
  const person = db.prepare("SELECT id FROM person_profiles WHERE name = ?").get(name);
  return person?.id ?? null;
}

function recommendOwner(db, projectId, explicitOwnerId) {
  if (explicitOwnerId) {
    return explicitOwnerId;
  }
  if (projectId) {
    const project = db.prepare("SELECT pm_owner_id FROM projects WHERE id = ?").get(projectId);
    if (project?.pm_owner_id) {
      return project.pm_owner_id;
    }
  }
  const leastLoaded = db.prepare(`
    SELECT p.id, COUNT(w.id) AS task_count
    FROM person_profiles p
    LEFT JOIN work_items w ON w.owner_id = p.id AND w.status NOT IN ('done', 'rejected')
    WHERE p.active_status = 'active'
    GROUP BY p.id
    ORDER BY task_count ASC, p.capacity_hint DESC
    LIMIT 1
  `).get();
  return leastLoaded?.id ?? null;
}

function buildCandidate(line, speakerName) {
  const normalized = normalizeWhitespace(line);
  const explicitOwnerMatch = normalized.match(/^([A-Z][a-z]+ [A-Z][a-z]+)[: ]/);
  const extractedOwner = explicitOwnerMatch ? explicitOwnerMatch[1] : speakerName;

  const taskPatterns = [
    /i will ([^.!\n]+)/i,
    /should ([^.!\n]+)/i,
    /we should ([^.!\n]+)/i,
    /can you ([^.!\n]+)/i,
    /need to ([^.!\n]+)/i,
    /fix:\s*([^.!\n]+)/i,
    /question\s+([^.!\n]+)/i
  ];

  for (const pattern of taskPatterns) {
    const match = normalized.match(pattern);
    if (match) {
      return {
        title: titleCaseTask(match[1]),
        description: normalized,
        extractedOwner,
        dueDate: extractDueDate(normalized),
        blockerFlag: /question|why is|if it’s not there|if it's not there/i.test(normalized) ? 1 : 0,
        priority: inferPriorityFromText(normalized),
        confidence: /i will|can you|fix:/i.test(normalized) ? 0.9 : 0.72
      };
    }
  }

  if (/close to be ready|working|eta|let's meet now|let’s meet now|thanks/i.test(normalized)) {
    return null;
  }

  if (/proposal has been modified|updated with 95th value|household optimization demo is working|here are the risk and returns/i.test(normalized)) {
    return {
      title: titleCaseTask(`Review update: ${normalized}`),
      description: normalized,
      extractedOwner,
      dueDate: extractDueDate(normalized),
      blockerFlag: 0,
      priority: "medium",
      confidence: 0.65
    };
  }

  return null;
}

function findDuplicateCandidates(db, candidate) {
  const rows = db.prepare(`
    SELECT id, title, owner_id, due_date
    FROM work_items
    WHERE lower(title) = lower(?)
       OR source_excerpt = ?
  `).all(candidate.title, candidate.description);
  return rows.map((row) => row.id);
}

export function processSourceDocument(db, sourceDocumentId) {
  const document = db.prepare("SELECT * FROM source_documents WHERE id = ?").get(sourceDocumentId);
  if (!document) {
    throw new Error("Source document not found");
  }

  const lines = document.raw_content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  let currentSpeaker = null;
  const now = nowIso();
  const results = [];

  const insertReview = db.prepare(`
    INSERT INTO review_queue_items (
      id, item_type, extracted_payload_json, confidence, duplicate_candidates_json, review_state,
      source_document_id, created_at, updated_at
    ) VALUES (
      @id, @item_type, @extracted_payload_json, @confidence, @duplicate_candidates_json, 'pending',
      @source_document_id, @created_at, @updated_at
    )
  `);

  for (const line of lines) {
    const speaker = detectSpeakerName(line);
    if (speaker) {
      currentSpeaker = speaker;
      continue;
    }

    const candidate = buildCandidate(line, currentSpeaker);
    if (!candidate) {
      continue;
    }

    const ownerId = findPersonIdByName(db, candidate.extractedOwner);
    const projectId = detectProjectId(db, line);
    const suggestedOwnerId = recommendOwner(db, projectId, ownerId);
    const duplicateCandidates = findDuplicateCandidates(db, candidate);
    const payload = {
      title: candidate.title,
      description: candidate.description,
      ownerId,
      suggestedOwnerId,
      projectId,
      dueDate: candidate.dueDate,
      priority: candidate.priority,
      blockerFlag: candidate.blockerFlag,
      confidence: candidate.confidence,
      sourceExcerpt: line
    };

    const reviewItem = {
      id: createId("review"),
      item_type: "work_item",
      extracted_payload_json: JSON.stringify(payload),
      confidence: candidate.confidence,
      duplicate_candidates_json: JSON.stringify(duplicateCandidates),
      source_document_id: document.id,
      created_at: now,
      updated_at: now
    };

    insertReview.run(reviewItem);
    results.push({ ...payload, reviewItemId: reviewItem.id, duplicateCandidates });
  }

  db.prepare("UPDATE source_documents SET parse_state = 'processed' WHERE id = ?").run(document.id);
  return results;
}
