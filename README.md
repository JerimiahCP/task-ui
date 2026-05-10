# Task Management Dashboard

A server-rendered Express frontend for the Task Management API. Provides a dark-themed dashboard with real-time updates via SSE, task CRUD operations, and an activity feed powered by webhook callbacks.

## Prerequisites

- Node.js 18+
- [task-api](../task-api/) running on `API_URL` (default: `http://localhost:8080`)

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `API_URL` | `http://localhost:8080` | Base URL of the task-api backend |
| `PORT` | `3000` | Port for this server |
| `WEBHOOK_SECRET` | — | Shared secret for verifying webhook payloads |
| `SESSION_SECRET` | — | Secret for session signing |

## Running

```bash
npm install
npm start        # production
npm run dev      # development with --watch
```

Then open http://localhost:3000/dashboard.
