import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createApp } from "../src/app.js";

function dbPathFor(name) {
  return path.resolve(`data/${name}.db`);
}

function resetDatabase(dbPath) {
  if (fs.existsSync(dbPath)) {
    fs.rmSync(dbPath, { force: true });
  }
  const walPath = `${dbPath}-wal`;
  const shmPath = `${dbPath}-shm`;
  if (fs.existsSync(walPath)) {
    fs.rmSync(walPath, { force: true });
  }
  if (fs.existsSync(shmPath)) {
    fs.rmSync(shmPath, { force: true });
  }
}

async function run(name, fn) {
  const safeName = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const dbPath = dbPathFor(safeName);
  process.env.PM_DB_PATH = dbPath;
  resetDatabase(dbPath);
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    console.error(error);
    process.exitCode = 1;
  } finally {
    delete process.env.PM_DB_PATH;
  }
}

async function withServer(app, fn) {
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    await fn(baseUrl);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

async function api(baseUrl, url, options = {}) {
  const response = await fetch(`${baseUrl}${url}`, {
    headers: { "Content-Type": "application/json" },
    ...options
  });

  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  return { status: response.status, body };
}

await run("imports sample text and produces review items", async () => {
  const app = createApp();
  const rawContent = fs.readFileSync(path.resolve("sample_mock_data/investmentteamgroupchatthisweek.txt"), "utf8");
  await withServer(app, async (baseUrl) => {
    const importResponse = await api(baseUrl, "/api/sources/import", {
      method: "POST",
      body: JSON.stringify({
        sourceType: "teams_group_chat",
        origin: "groupchat.txt",
        rawContent
      })
    });

    assert.equal(importResponse.status, 201);

    const processResponse = await api(baseUrl, "/api/sources/process", {
      method: "POST",
      body: JSON.stringify({ sourceDocumentId: importResponse.body.id })
    });

    assert.equal(processResponse.status, 200);
    assert.ok(processResponse.body.created > 0);

    const reviewResponse = await api(baseUrl, "/api/review/inbox");
    assert.equal(reviewResponse.status, 200);
    assert.ok(reviewResponse.body.items.some((item) => /tax transition section/i.test(item.payload.title)));
  });
  app.locals.db.close();
});

await run("confirming a review item creates a tracked task", async () => {
  const app = createApp();
  const rawContent = "Carrie Feng\nI will finish the tax transition section Monday.";
  await withServer(app, async (baseUrl) => {
    const imported = await api(baseUrl, "/api/sources/import", {
      method: "POST",
      body: JSON.stringify({
        sourceType: "teams_group_chat",
        origin: "single-line.txt",
        rawContent
      })
    });
    assert.equal(imported.status, 201);

    const processed = await api(baseUrl, "/api/sources/process", {
      method: "POST",
      body: JSON.stringify({ sourceDocumentId: imported.body.id })
    });
    assert.equal(processed.status, 200);

    const review = await api(baseUrl, "/api/review/inbox");
    assert.equal(review.status, 200);
    const target = review.body.items[0];

    const confirmed = await api(baseUrl, `/api/review/inbox/${target.id}/confirm`, {
      method: "POST",
      body: JSON.stringify({
        reviewerName: "Carrie Feng",
        ownerId: target.payload.suggestedOwnerId
      })
    });
    assert.equal(confirmed.status, 200);
    assert.equal(confirmed.body.dueDate, "2026-07-27");

    const dashboard = await api(baseUrl, "/api/dashboard/daily");
    assert.equal(dashboard.status, 200);
    assert.ok(dashboard.body.tasks.some((task) => /tax transition section/i.test(task.title)));
  });
  app.locals.db.close();
});

await run("daily logs and memory entries are accepted", async () => {
  const app = createApp();
  await withServer(app, async (baseUrl) => {
    const bootstrap = await api(baseUrl, "/api/bootstrap");
    assert.equal(bootstrap.status, 200);
    const authorId = bootstrap.body.people[0].id;

    const log = await api(baseUrl, "/api/logs/daily", {
      method: "POST",
      body: JSON.stringify({
        authorId,
        summary: "Discussed a client request orally and captured follow-up."
      })
    });
    assert.equal(log.status, 201);

    const memory = await api(baseUrl, "/api/memory", {
      method: "POST",
      body: JSON.stringify({
        scopeType: "team",
        fact: "The PM reviews extracted tasks before assignment becomes official."
      })
    });
    assert.equal(memory.status, 201);

    const digest = await api(baseUrl, "/api/digest/daily");
    assert.equal(digest.status, 200);
    assert.equal(digest.body.headline, "Daily PM operations digest");
  });
  app.locals.db.close();
});

if (process.exitCode) {
  process.exit(process.exitCode);
}
