import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const dataDirectory = path.resolve("data");
const defaultDatabasePath = path.join(dataDirectory, "pm.db");

function ensureDataDirectory() {
  if (!fs.existsSync(dataDirectory)) {
    fs.mkdirSync(dataDirectory, { recursive: true });
  }
}

function createConnection() {
  ensureDataDirectory();
  const dbPath = process.env.PM_DB_PATH ?? defaultDatabasePath;
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return db;
}

export function initializeDatabase(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS person_profiles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      role TEXT,
      team TEXT,
      email_identity TEXT,
      teams_channel_identity TEXT,
      teams_chat_identity TEXT,
      skills_json TEXT NOT NULL DEFAULT '[]',
      capacity_hint INTEGER NOT NULL DEFAULT 5,
      active_status TEXT NOT NULL DEFAULT 'active',
      preferences_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      summary TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      phase TEXT NOT NULL DEFAULT 'execution',
      progress_percent INTEGER NOT NULL DEFAULT 0,
      important_updates TEXT NOT NULL DEFAULT '',
      target_start_date TEXT,
      target_end_date TEXT,
      pm_owner_id TEXT,
      stakeholders_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (pm_owner_id) REFERENCES person_profiles(id)
    );

    CREATE TABLE IF NOT EXISTS source_documents (
      id TEXT PRIMARY KEY,
      source_type TEXT NOT NULL,
      origin TEXT NOT NULL,
      import_batch TEXT NOT NULL,
      source_timestamp TEXT NOT NULL,
      raw_content TEXT NOT NULL,
      parse_state TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS work_items (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'pending_review',
      priority TEXT NOT NULL DEFAULT 'medium',
      due_date TEXT,
      owner_id TEXT,
      suggested_owner_id TEXT,
      project_id TEXT,
      blocker_flag INTEGER NOT NULL DEFAULT 0,
      confidence REAL NOT NULL DEFAULT 0.0,
      source_document_id TEXT,
      source_excerpt TEXT,
      last_activity_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (owner_id) REFERENCES person_profiles(id),
      FOREIGN KEY (suggested_owner_id) REFERENCES person_profiles(id),
      FOREIGN KEY (project_id) REFERENCES projects(id),
      FOREIGN KEY (source_document_id) REFERENCES source_documents(id)
    );

    CREATE TABLE IF NOT EXISTS work_assignment_decisions (
      id TEXT PRIMARY KEY,
      work_item_id TEXT NOT NULL,
      recommended_owner_id TEXT,
      final_owner_id TEXT,
      reviewer_name TEXT NOT NULL,
      reason TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (work_item_id) REFERENCES work_items(id),
      FOREIGN KEY (recommended_owner_id) REFERENCES person_profiles(id),
      FOREIGN KEY (final_owner_id) REFERENCES person_profiles(id)
    );

    CREATE TABLE IF NOT EXISTS calendar_entries (
      id TEXT PRIMARY KEY,
      owner_id TEXT,
      team_scope TEXT,
      start_at TEXT NOT NULL,
      end_at TEXT NOT NULL,
      category TEXT NOT NULL,
      project_id TEXT,
      work_item_id TEXT,
      editable_notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (owner_id) REFERENCES person_profiles(id),
      FOREIGN KEY (project_id) REFERENCES projects(id),
      FOREIGN KEY (work_item_id) REFERENCES work_items(id)
    );

    CREATE TABLE IF NOT EXISTS daily_logs (
      id TEXT PRIMARY KEY,
      author_id TEXT,
      log_date TEXT NOT NULL,
      summary TEXT NOT NULL,
      linked_projects_json TEXT NOT NULL DEFAULT '[]',
      linked_tasks_json TEXT NOT NULL DEFAULT '[]',
      visibility TEXT NOT NULL DEFAULT 'internal',
      source_type TEXT NOT NULL DEFAULT 'manual',
      created_at TEXT NOT NULL,
      FOREIGN KEY (author_id) REFERENCES person_profiles(id)
    );

    CREATE TABLE IF NOT EXISTS memory_records (
      id TEXT PRIMARY KEY,
      scope_type TEXT NOT NULL,
      scope_id TEXT,
      fact TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 0.8,
      source_document_id TEXT,
      validity_state TEXT NOT NULL DEFAULT 'active',
      last_confirmed_date TEXT NOT NULL,
      superseded_by_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (source_document_id) REFERENCES source_documents(id),
      FOREIGN KEY (superseded_by_id) REFERENCES memory_records(id)
    );

    CREATE TABLE IF NOT EXISTS review_queue_items (
      id TEXT PRIMARY KEY,
      item_type TEXT NOT NULL,
      extracted_payload_json TEXT NOT NULL,
      confidence REAL NOT NULL,
      duplicate_candidates_json TEXT NOT NULL DEFAULT '[]',
      review_state TEXT NOT NULL DEFAULT 'pending',
      source_document_id TEXT NOT NULL,
      linked_work_item_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (source_document_id) REFERENCES source_documents(id),
      FOREIGN KEY (linked_work_item_id) REFERENCES work_items(id)
    );
  `);

  ensureColumn(db, "projects", "progress_percent", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "projects", "important_updates", "TEXT NOT NULL DEFAULT ''");
}

function ensureColumn(db, tableName, columnName, definition) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  if (!columns.some((column) => column.name === columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

export function createDatabase() {
  const db = createConnection();
  initializeDatabase(db);
  return db;
}

export const databasePath = defaultDatabasePath;
