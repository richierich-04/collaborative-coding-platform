// server.js — CodeTogether backend
// Adds: Room permissions (public/private, password, owner tracking)
//
// Install deps:
//   npm install express socket.io y-socket.io y-leveldb
//
// Optional env vars:
//   PORT=3000
//   DB_DIR=./data
//   CLIENT_ORIGIN=*

import bcrypt from "bcrypt";

import express           from "express";
import { createServer }  from "http";
import { Server }        from "socket.io";
import { YSocketIO }     from "y-socket.io/dist/server";
import * as Y            from "yjs";
import { LeveldbPersistence } from "y-leveldb";
import path              from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_DIR    = process.env.DB_DIR || path.join(__dirname, "data");
const PORT      = process.env.PORT   || 3000;

// ── Persistence ───────────────────────────────────────────────────────────────
const persistence = new LeveldbPersistence(DB_DIR);

// ── Room metadata store ───────────────────────────────────────────────────────
// In production you'd use a database. For this project, an in-memory Map
// is fine — on server restart, rooms can be re-created.
//
// Structure: Map<roomName, RoomMeta>
// RoomMeta: { owner, isPrivate, password, createdAt }
//
// Why not store this in LevelDB too?
// Room metadata is small, frequently read, and doesn't need CRDT semantics.
// A plain Map with optional Redis/DB backing is the right tool.
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
  // Allow the Vite dev server (and any origin in dev) to talk to us
  res.setHeader("Access-Control-Allow-Origin",  process.env.CLIENT_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
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

// Guard: if a room is private, verify the socket knows the password before
// allowing it to join. We check on the socket "connection" event using
// the query params passed by y-socket.io.
io.use((socket, next) => {
  const room = socket.handshake.query?.room;
  if (!room) return next();

  const meta = getRoomMeta(room);
  // No meta = room not yet created via REST (legacy / direct socket join)
  if (!meta) return next();
  // Public room = always allowed
  if (!meta.isPrivate) return next();

  // Private room — check password passed as query param
  const pw = socket.handshake.query?.password || "";
  if (pw !== meta.password) {
    return next(new Error("WRONG_PASSWORD"));
  }
  next();
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

// Health
app.get("/",       (_req, res) => res.json({ app: "CodeTogether", status: "ok" }));
app.get("/health", (_req, res) => res.json({ status: "ok", uptime: Math.round(process.uptime()) }));

// List all rooms (counts only — don't leak passwords)
app.get("/rooms", (_req, res) => {
  const data = {};
  rooms.forEach((set, name) => { data[name] = set.size; });
  res.json({ rooms: data, total: rooms.size });
});

// ── GET /rooms/:room/meta
// Returns whether the room exists, its owner, and whether it's private.
// Does NOT return the password — only the owner sees that in the modal.
app.get("/rooms/:room/meta", (req, res) => {
  const { room } = req.params;
  const meta     = getRoomMeta(room);

  if (!meta) {
    return res.json({ exists: false });
  }

  // Return meta but never expose password to non-owners
  res.json({
    exists:    true,
    owner:     meta.owner,
    isPrivate: meta.isPrivate,
    createdAt: meta.createdAt,
    // password is only included if the requester is the owner —
    // but we can't verify that here without auth tokens.
    // For this project, we return it and let the UI decide whether to show it.
    // In production: use JWT or session to gate this.
  });
});

// ── POST /rooms
// Create a new room. The first person to call this becomes the owner.
// Body: { room, owner, isPrivate, password }
app.post("/rooms", (req, res) => {
  const { room, owner, isPrivate, password } = req.body;

  if (!room?.trim())  return res.status(400).json({ ok: false, error: "Room name required." });
  if (!owner?.trim()) return res.status(400).json({ ok: false, error: "Owner name required." });

  if (roomMetaStore.has(room)) {
    return res.status(409).json({ ok: false, error: "Room already exists. Join it instead." });
  }

  if (isPrivate && !password?.trim()) {
    return res.status(400).json({ ok: false, error: "Private rooms need a password." });
  }

  setRoomMeta(room, {
    owner:     owner.trim(),
    isPrivate: !!isPrivate,
    password: isPrivate ? await bcrypt.hash(password.trim(), 10) : "",
    createdAt: Date.now(),
  });

  console.log(`[room] Created "${room}" by ${owner} (${isPrivate ? "private" : "public"})`);
  res.json({ ok: true });
});

// ── POST /rooms/:room/join
// Validate that a user can join an existing room.
// Body: { username, password }
// This is a soft check — the real enforcement happens in the Socket.IO middleware.
// Having it as a REST call too means the UI can show an error before even
// attempting the WebSocket connection.
app.post("/rooms/:room/join", (req, res) => {
  const { room }              = req.params;
  const { username, password } = req.body;

  if (!username?.trim()) return res.status(400).json({ ok: false, error: "Username required." });

  const meta = getRoomMeta(room);

  // Room doesn't exist yet — this happens if someone shares an invite link
  // before the server restarted (meta is lost). Allow join; room will be
  // bootstrapped by Yjs sync. In production, persist meta to DB.
  if (!meta) {
    return res.json({ ok: true, warning: "Room metadata not found. Room may have been reset." });
  }

  if (meta.isPrivate) {
    const isMatch = await bcrypt.compare(password, meta.password);
    if (!isMatch) {
      return res.status(403).json({ ok: false, error: "Wrong password." });
    }
  }

  res.json({ ok: true });
});

// ── DELETE /rooms/:room  (owner only — stretch goal)
// In production you'd verify the requester is the owner via a token.
// Shown here as an example of the pattern.
app.delete("/rooms/:room", (req, res) => {
  const { room }  = req.params;
  const { owner } = req.body;
  const meta      = getRoomMeta(room);

  if (!meta)           return res.status(404).json({ ok: false, error: "Room not found." });
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
