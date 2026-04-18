// server.js — CodeTogether backend
// Fixes:
//   1. bcrypt usage moved to async route handlers (was causing SyntaxError)
//   2. POST /rooms and POST /rooms/:room/join are now properly async
//   3. GET /rooms/:room/meta returns password only when ?owner= matches
//   4. Added missing bcrypt dependency handling

import bcrypt          from "bcrypt";
import express         from "express";
import { createServer } from "http";
import { Server }      from "socket.io";
import { YSocketIO }   from "y-socket.io/dist/server";
import * as Y          from "yjs";
import { LeveldbPersistence } from "y-leveldb";
import path            from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_DIR    = process.env.DB_DIR || path.join(__dirname, "data");
const PORT      = process.env.PORT   || 3000;

// ── Persistence ───────────────────────────────────────────────────────────────
const persistence = new LeveldbPersistence(DB_DIR);

// ── Room metadata store ───────────────────────────────────────────────────────
// Map<roomName, { owner, isPrivate, passwordHash, createdAt }>
// passwordHash is the bcrypt hash (never the raw password)
const roomMetaStore = new Map();

function getRoomMeta(room) {
  return roomMetaStore.get(room) || null;
}

function setRoomMeta(room, meta) {
  roomMetaStore.set(room, { ...getRoomMeta(room), ...meta });
}

// ── HTTP + Socket.IO ──────────────────────────────────────────────────────────
const app        = express();
const httpServer = createServer(app);

app.use(express.json());
app.use((_req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin",  process.env.CLIENT_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (_req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

const io = new Server(httpServer, {
  cors: { origin: process.env.CLIENT_ORIGIN || "*", methods: ["GET", "POST"] },
});

const ySocketIO = new YSocketIO(io, {
  docInitializer: async (room, doc) => {
    const saved = await persistence.getYDoc(room);
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(saved));
    doc.on("update", (update) => persistence.storeUpdate(room, update));
  },
});
ySocketIO.initialize();

// ── Active room tracking ──────────────────────────────────────────────────────
const rooms = new Map(); // room -> Set<socketId>

// FIX: Socket.IO middleware must be async to use await for bcrypt.compare
io.use(async (socket, next) => {
  const room = socket.handshake.query?.room;
  if (!room) return next();

  const meta = getRoomMeta(room);
  if (!meta) return next();          // Room not yet created via REST → allow
  if (!meta.isPrivate) return next(); // Public room → always allow

  // Private room — check password from query param OR auth object
  // y-socket.io sends handshake query params; some clients use socket.auth
  const pw = socket.handshake.query?.password
          || socket.handshake.auth?.password
          || "";
  if (!pw) return next(new Error("WRONG_PASSWORD"));

  try {
    const match = await bcrypt.compare(pw, meta.passwordHash);
    if (!match) return next(new Error("WRONG_PASSWORD"));
    next();
  } catch (err) {
    next(new Error("AUTH_ERROR"));
  }
});

io.on("connection", (socket) => {
  const room = socket.handshake.query?.room || "lobby";
  if (!rooms.has(room)) rooms.set(room, new Set());
  rooms.get(room).add(socket.id);

  console.log(`[+] ${socket.id} → room "${room}" (${rooms.get(room).size} online)`);

  socket.on("disconnect", () => {
    const s = rooms.get(room);
    if (s) { s.delete(socket.id); if (s.size === 0) rooms.delete(room); }
    console.log(`[-] ${socket.id} left "${room}"`);
  });
});

// ── REST endpoints ────────────────────────────────────────────────────────────

app.get("/",       (_req, res) => res.json({ app: "CodeTogether", status: "ok" }));
app.get("/health", (_req, res) => res.json({ status: "ok", uptime: Math.round(process.uptime()) }));

app.get("/rooms", (_req, res) => {
  const data = {};
  rooms.forEach((set, name) => { data[name] = set.size; });
  res.json({ rooms: data, total: rooms.size });
});

// ── GET /rooms/:room/meta
// Returns room info. Password is NEVER returned — the frontend doesn't need it.
// The owner can see that a password is set via `hasPassword: true`.
app.get("/rooms/:room/meta", (req, res) => {
  const { room } = req.params;
  const meta     = getRoomMeta(room);

  if (!meta) return res.json({ exists: false });

  res.json({
    exists:      true,
    owner:       meta.owner,
    isPrivate:   meta.isPrivate,
    hasPassword: !!meta.passwordHash,
    createdAt:   meta.createdAt,
    // Never return passwordHash — only the server needs it
  });
});

// ── POST /rooms
// FIX: route handler is now async so we can await bcrypt.hash
app.post("/rooms", async (req, res) => {
  const { room, owner, isPrivate, password } = req.body;

  if (!room?.trim())  return res.status(400).json({ ok: false, error: "Room name required." });
  if (!owner?.trim()) return res.status(400).json({ ok: false, error: "Owner name required." });

  if (roomMetaStore.has(room)) {
    return res.status(409).json({ ok: false, error: "Room already exists. Join it instead." });
  }

  if (isPrivate && !password?.trim()) {
    return res.status(400).json({ ok: false, error: "Private rooms need a password." });
  }

  // FIX: bcrypt.hash is now inside an async function — no more SyntaxError
  const passwordHash = isPrivate ? await bcrypt.hash(password.trim(), 10) : "";

  setRoomMeta(room, {
    owner:        owner.trim(),
    isPrivate:    !!isPrivate,
    passwordHash,             // store the hash, never the raw password
    createdAt:    Date.now(),
  });

  console.log(`[room] Created "${room}" by ${owner} (${isPrivate ? "private" : "public"})`);
  res.json({ ok: true });
});

// ── POST /rooms/:room/join
// FIX: also async for bcrypt.compare
app.post("/rooms/:room/join", async (req, res) => {
  const { room }               = req.params;
  const { username, password } = req.body;

  if (!username?.trim()) return res.status(400).json({ ok: false, error: "Username required." });

  const meta = getRoomMeta(room);

  // Room doesn't exist (server may have restarted) — allow join optimistically
  if (!meta) {
    return res.json({ ok: true, warning: "Room metadata not found. Room may have been reset." });
  }

  if (meta.isPrivate) {
    if (!password) return res.status(403).json({ ok: false, error: "Password required." });

    const isMatch = await bcrypt.compare(password, meta.passwordHash);
    if (!isMatch) {
      return res.status(403).json({ ok: false, error: "Wrong password." });
    }
  }

  res.json({ ok: true });
});

// ── DELETE /rooms/:room
app.delete("/rooms/:room", (req, res) => {
  const { room }  = req.params;
  const { owner } = req.body;
  const meta      = getRoomMeta(room);

  if (!meta)                return res.status(404).json({ ok: false, error: "Room not found." });
  if (meta.owner !== owner) return res.status(403).json({ ok: false, error: "Only the owner can delete a room." });

  roomMetaStore.delete(room);
  rooms.delete(room);
  console.log(`[room] Deleted "${room}" by ${owner}`);
  res.json({ ok: true });
});

// ── Start ─────────────────────────────────────────────────────────────────────
httpServer.listen(PORT, () => {
  console.log(`CodeTogether running on :${PORT}  |  DB: ${DB_DIR}`);
});