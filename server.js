const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const express = require("express");
const session = require("express-session");

const app = express();
const port = Number(process.env.PORT) || 3000;
const publicDir = path.join(__dirname, "public");
const dataDir = path.join(__dirname, "data");
const usersFile = path.join(dataDir, "users.json");
const ticketsFile = path.join(dataDir, "tickets.json");

fs.mkdirSync(dataDir, { recursive: true });
for (const [file, initial] of [[usersFile, []], [ticketsFile, []]]) {
  if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify(initial));
}

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const writeJson = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2));
const adminEmails = new Set((process.env.ADMIN_EMAILS || "").split(",").map((email) => email.trim().toLowerCase()).filter(Boolean));

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, expected] = stored.split(":");
  const actual = crypto.scryptSync(password, salt, 64).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"));
}

function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}

function requireLogin(request, response, next) {
  if (!request.session.userId) return response.status(401).json({ error: "Please sign in." });
  next();
}

function requireAdmin(request, response, next) {
  if (!request.session.userId) return response.status(401).json({ error: "Please sign in." });
  const user = readJson(usersFile).find((item) => item.id === request.session.userId);
  if (!user || user.role !== "admin") return response.status(403).json({ error: "Admin access required." });
  next();
}

app.use(express.json({ limit: "100kb" }));
app.use(session({
  name: "resource.sid",
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex"),
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax", secure: false, maxAge: 7 * 24 * 60 * 60 * 1000 },
}));

app.get("/api/session", (request, response) => {
  const users = readJson(usersFile);
  const user = users.find((item) => item.id === request.session.userId);
  response.json({ user: user ? publicUser(user) : null });
});

app.post("/api/register", (request, response) => {
  const name = String(request.body.name || "").trim();
  const email = String(request.body.email || "").trim().toLowerCase();
  const password = String(request.body.password || "");

  if (name.length < 2) return response.status(400).json({ error: "Enter a display name." });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return response.status(400).json({ error: "Enter a valid email." });
  if (password.length < 8) return response.status(400).json({ error: "Password must be at least 8 characters." });

  const users = readJson(usersFile);
  if (users.some((user) => user.email === email)) return response.status(409).json({ error: "An account already exists for that email." });

  const user = { id: crypto.randomUUID(), name, email, passwordHash: hashPassword(password), role: adminEmails.has(email) ? "admin" : "member", createdAt: new Date().toISOString() };
  users.push(user);
  writeJson(usersFile, users);
  request.session.userId = user.id;
  response.status(201).json({ user: publicUser(user) });
});

app.post("/api/login", (request, response) => {
  const email = String(request.body.email || "").trim().toLowerCase();
  const password = String(request.body.password || "");
  const users = readJson(usersFile);
  const user = users.find((item) => item.email === email);

  if (!user || !verifyPassword(password, user.passwordHash)) return response.status(401).json({ error: "Incorrect email or password." });
  request.session.userId = user.id;
  response.json({ user: publicUser(user) });
});

app.post("/api/logout", (request, response) => {
  request.session.destroy(() => response.json({ ok: true }));
});

app.get("/api/tickets", requireLogin, (request, response) => {
  const tickets = readJson(ticketsFile);
  const user = readJson(usersFile).find((item) => item.id === request.session.userId);
  const visible = user.role === "admin" ? tickets : tickets.filter((ticket) => ticket.userId === user.id);
  response.json(visible.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
});

app.post("/api/tickets", requireLogin, (request, response) => {
  const subject = String(request.body.subject || "").trim();
  const message = String(request.body.message || "").trim();
  if (subject.length < 3 || message.length < 10) return response.status(400).json({ error: "Add a subject and a detailed message." });

  const user = readJson(usersFile).find((item) => item.id === request.session.userId);
  const tickets = readJson(ticketsFile);
  const now = new Date().toISOString();
  const ticket = { id: crypto.randomUUID(), userId: user.id, name: user.name, email: user.email, subject, status: "open", createdAt: now, updatedAt: now, messages: [{ id: crypto.randomUUID(), userId: user.id, name: user.name, role: user.role, body: message, createdAt: now }] };
  tickets.push(ticket);
  writeJson(ticketsFile, tickets);
  response.status(201).json(ticket);
});

app.post("/api/tickets/:id/messages", requireLogin, (request, response) => {
  const body = String(request.body.body || "").trim();
  if (body.length < 2) return response.status(400).json({ error: "Message cannot be empty." });

  const users = readJson(usersFile);
  const user = users.find((item) => item.id === request.session.userId);
  const tickets = readJson(ticketsFile);
  const ticket = tickets.find((item) => item.id === request.params.id);
  if (!ticket || (user.role !== "admin" && ticket.userId !== user.id)) return response.status(404).json({ error: "Ticket not found." });

  const now = new Date().toISOString();
  ticket.messages.push({ id: crypto.randomUUID(), userId: user.id, name: user.name, role: user.role, body, createdAt: now });
  ticket.updatedAt = now;
  if (user.role === "admin") ticket.status = "pending";
  writeJson(ticketsFile, tickets);
  response.json(ticket);
});

app.patch("/api/tickets/:id", requireAdmin, (request, response) => {
  const status = String(request.body.status || "");
  if (!["open", "pending", "closed"].includes(status)) return response.status(400).json({ error: "Invalid ticket status." });
  const tickets = readJson(ticketsFile);
  const ticket = tickets.find((item) => item.id === request.params.id);
  if (!ticket) return response.status(404).json({ error: "Ticket not found." });
  ticket.status = status;
  ticket.updatedAt = new Date().toISOString();
  writeJson(ticketsFile, tickets);
  response.json(ticket);
});

app.get("/background.jpg", (request, response, next) => {
  const backgroundFile = path.join(publicDir, "background.jpg");
  if (fs.existsSync(backgroundFile)) return response.sendFile(backgroundFile);
  response.redirect("https://images.unsplash.com/photo-1519501025264-65ba15a82390?auto=format&fit=crop&w=2400&q=85");
});

app.get("/", (_request, response) => response.sendFile(path.join(publicDir, "resources.html")));
app.use(express.static(publicDir));
app.get("/health", (_request, response) => response.json({ status: "ok" }));

app.listen(port, "0.0.0.0", () => console.log(`5M Resources is running on port ${port}`));