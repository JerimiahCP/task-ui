import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const API_URL = (process.env.API_URL || "http://localhost:8080").replace(
  /\/$/,
  ""
);
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || "";

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ---------------------------------------------------------------------------
// In-memory stores
// ---------------------------------------------------------------------------
const MAX_ACTIVITY = 50;
const activityLog = []; // recent webhook events
const sseClients = new Set(); // active SSE connections

function pushActivity(event) {
  activityLog.unshift({ ...event, receivedAt: new Date().toISOString() });
  if (activityLog.length > MAX_ACTIVITY) activityLog.length = MAX_ACTIVITY;
  // broadcast to all SSE clients
  for (const res of sseClients) {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }
}

// ---------------------------------------------------------------------------
// Helper — proxy fetch to the backend API
// ---------------------------------------------------------------------------
async function apiFetch(urlPath, options = {}) {
  const url = `${API_URL}${urlPath}`;
  const headers = { "Content-Type": "application/json", ...options.headers };
  const res = await fetch(url, { ...options, headers });
  const body = res.headers.get("content-type")?.includes("application/json")
    ? await res.json()
    : await res.text();
  return { status: res.status, ok: res.ok, body };
}

// ---------------------------------------------------------------------------
// GET /health — checks own status + connectivity to the API
// ---------------------------------------------------------------------------
app.get("/health", async (_req, res) => {
  let apiHealthy = false;
  let apiDetail = "unreachable";
  try {
    const upstream = await apiFetch("/health");
    apiHealthy = upstream.ok;
    apiDetail = upstream.body;
  } catch (err) {
    apiDetail = err.message;
  }
  const status = apiHealthy ? 200 : 503;
  res.status(status).json({
    status: apiHealthy ? "healthy" : "degraded",
    service: "task-ui",
    upstreamApi: { healthy: apiHealthy, detail: apiDetail },
  });
});

// ---------------------------------------------------------------------------
// GET / and GET /dashboard — server-rendered dashboard
// ---------------------------------------------------------------------------
async function renderDashboard(_req, res) {
  let tasks = [];
  let apiError = null;
  try {
    const result = await apiFetch("/tasks");
    if (result.ok) {
      tasks = Array.isArray(result.body) ? result.body : result.body.tasks || [];
    } else {
      apiError = `API returned ${result.status}`;
    }
  } catch (err) {
    apiError = `Cannot reach API: ${err.message}`;
  }

  const stats = {
    total: tasks.length,
    inProgress: tasks.filter((t) => t.status === "in_progress").length,
    done: tasks.filter((t) => t.status === "done").length,
    critical: tasks.filter((t) => t.priority === "critical").length,
  };

  res.render("dashboard", {
    tasks,
    stats,
    apiError,
    activity: activityLog.slice(0, 20),
  });
}

app.get("/", renderDashboard);
app.get("/dashboard", renderDashboard);

// ---------------------------------------------------------------------------
// POST /webhook — receives webhook callbacks from task-api
// ---------------------------------------------------------------------------
app.post("/webhook", (req, res) => {
  // Optional: verify shared secret
  if (WEBHOOK_SECRET) {
    const provided = req.headers["x-webhook-secret"];
    if (provided !== WEBHOOK_SECRET) {
      return res.status(401).json({ error: "invalid webhook secret" });
    }
  }

  const event = {
    type: req.body.event || "unknown",
    taskId: req.body.task_id || req.body.taskId || null,
    title: req.body.title || "",
    changes: req.body.changes || {},
    timestamp: req.body.timestamp || new Date().toISOString(),
  };

  pushActivity(event);
  res.status(200).json({ received: true });
});

// ---------------------------------------------------------------------------
// GET /api/activity — returns recent webhook events
// ---------------------------------------------------------------------------
app.get("/api/activity", (_req, res) => {
  res.json(activityLog);
});

// ---------------------------------------------------------------------------
// GET /events — SSE endpoint for real-time updates
// ---------------------------------------------------------------------------
app.get("/events", (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.write(":ok\n\n");

  sseClients.add(res);
  req.on("close", () => sseClients.delete(res));
});

// ---------------------------------------------------------------------------
// Proxy: /api/tasks/* → API_URL/tasks/*
// ---------------------------------------------------------------------------
const PROXY_METHODS = ["GET", "POST", "PATCH", "PUT", "DELETE"];

app.all("/api/tasks/:path(*)?", async (req, res) => {
  if (!PROXY_METHODS.includes(req.method)) {
    return res.status(405).json({ error: "method not allowed" });
  }

  const downstream = `/tasks${req.params.path ? "/" + req.params.path : ""}`;
  const queryString = new URLSearchParams(req.query).toString();
  const fullPath = queryString ? `${downstream}?${queryString}` : downstream;

  try {
    const options = { method: req.method };
    if (["POST", "PATCH", "PUT"].includes(req.method) && req.body) {
      options.body = JSON.stringify(req.body);
    }
    const result = await apiFetch(fullPath, options);
    res.status(result.status).json(result.body);
  } catch (err) {
    res.status(502).json({ error: "upstream API error", detail: err.message });
  }
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`task-ui listening on http://localhost:${PORT}`);
  console.log(`Proxying API requests to ${API_URL}`);
});

export default app;
