# PM Operations Dashboard

Private internal PM operations system with:
- a structured backend over SQLite
- task extraction from imported source text
- PM review inbox
- capacity and task dashboard
- daily logs, memory capture, and digest APIs

## Run
1. `npm.cmd install`
2. `npm run import:sample`
3. `node src/server.js`
4. Open `http://localhost:3000`

## Key API routes
- `POST /api/sources/import`
- `POST /api/sources/process`
- `GET /api/review/inbox`
- `POST /api/review/inbox/:id/confirm`
- `POST /api/review/inbox/:id/reject`
- `GET /api/dashboard/daily`
- `GET /api/dashboard/capacity`
- `POST /api/tasks`
- `POST /api/tasks/:id/assign`
- `POST /api/logs/daily`
- `POST /api/memory`
- `POST /api/calendar`
- `GET /api/digest/daily`
