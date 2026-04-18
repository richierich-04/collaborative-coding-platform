// App.jsx — CodeTogether v2
// Features: Auth → Dashboard → Room flow → Collaborative Editor
// New: Auth, Dashboard with room history, Create/Join modals,
//      Java/Python/C++ support, stdin for code runner, undo button, leave room

import "./App.css";
import { Editor } from "@monaco-editor/react";
import { MonacoBinding } from "y-monaco";
import { useRef, useMemo, useState, useEffect, useCallback } from "react";
import * as Y from "yjs";
import { SocketIOProvider } from "y-socket.io";

// ─── Config ───────────────────────────────────────────────────────────────────
const SERVER_URL  = import.meta.env.VITE_SERVER_URL  || "http://localhost:3000";
const JUDGE0_URL  = import.meta.env.VITE_JUDGE0_URL  || "https://judge0-ce.p.rapidapi.com";
const JUDGE0_KEY  = import.meta.env.VITE_JUDGE0_KEY  || "";
const JUDGE0_HOST = "judge0-ce.p.rapidapi.com";

const LANGUAGES = [
  { id: "javascript", label: "JavaScript", ext: "js",   judge0Id: null, runnable: true,  browser: true  },
  { id: "python",     label: "Python 3",   ext: "py",   judge0Id: 71,   runnable: true,  browser: false },
  { id: "java",       label: "Java",       ext: "java", judge0Id: 62,   runnable: true,  browser: false },
  { id: "cpp",        label: "C++",        ext: "cpp",  judge0Id: 54,   runnable: true,  browser: false },
  { id: "c",          label: "C",          ext: "c",    judge0Id: 50,   runnable: true,  browser: false },
  { id: "typescript", label: "TypeScript", ext: "ts",   judge0Id: 74,   runnable: true,  browser: false },
  { id: "go",         label: "Go",         ext: "go",   judge0Id: 60,   runnable: true,  browser: false },
  { id: "rust",       label: "Rust",       ext: "rs",   judge0Id: 73,   runnable: true,  browser: false },
  { id: "csharp",     label: "C#",         ext: "cs",   judge0Id: 51,   runnable: true,  browser: false },
  { id: "html",       label: "HTML",       ext: "html", judge0Id: null, runnable: true,  browser: true  },
  { id: "css",        label: "CSS",        ext: "css",  judge0Id: null, runnable: false, browser: false },
  { id: "json",       label: "JSON",       ext: "json", judge0Id: null, runnable: false, browser: false },
];

const USER_COLORS = [
  "#00d4aa","#0ea5e9","#a78bfa","#f87171",
  "#fbbf24","#fb923c","#34d399","#e879f9",
];

// ─── Utils ────────────────────────────────────────────────────────────────────
function colorForUser(username) {
  let hash = 0;
  for (let i = 0; i < username.length; i++)
    hash = username.charCodeAt(i) + ((hash << 5) - hash);
  return USER_COLORS[Math.abs(hash) % USER_COLORS.length];
}

function initials(u) { return u.slice(0, 2).toUpperCase(); }

function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function fmtDate(ts) {
  const d = new Date(ts);
  const now = new Date();
  const diff = now - d;
  if (diff < 86400000) return "Today";
  if (diff < 172800000) return "Yesterday";
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function generateId() {
  return Math.random().toString(36).slice(2, 9);
}

// ─── Simple localStorage "auth" ───────────────────────────────────────────────
const AUTH_KEY  = "ct_user";
const ROOMS_KEY = "ct_rooms";

function getStoredUser()  { try { return JSON.parse(localStorage.getItem(AUTH_KEY)); } catch { return null; } }
function setStoredUser(u) { localStorage.setItem(AUTH_KEY, JSON.stringify(u)); }
function clearStoredUser(){ localStorage.removeItem(AUTH_KEY); }

function getStoredRooms(username) {
  try {
    const all = JSON.parse(localStorage.getItem(ROOMS_KEY)) || {};
    return all[username] || [];
  } catch { return []; }
}

function addStoredRoom(username, roomEntry) {
  try {
    const all = JSON.parse(localStorage.getItem(ROOMS_KEY)) || {};
    const rooms = all[username] || [];
    // Deduplicate by room name
    const filtered = rooms.filter(r => r.name !== roomEntry.name);
    all[username] = [roomEntry, ...filtered].slice(0, 20);
    localStorage.setItem(ROOMS_KEY, JSON.stringify(all));
  } catch {}
}

// Stored "users" DB (simple)
const USERS_KEY = "ct_users_db";
function getUsers() { try { return JSON.parse(localStorage.getItem(USERS_KEY)) || {}; } catch { return {}; } }
function saveUsers(db) { localStorage.setItem(USERS_KEY, JSON.stringify(db)); }

function signUp(username, password) {
  const db = getUsers();
  if (db[username]) return { ok: false, error: "Username already taken." };
  db[username] = { password, createdAt: Date.now() };
  saveUsers(db);
  return { ok: true };
}

function signIn(username, password) {
  const db = getUsers();
  if (!db[username]) return { ok: false, error: "User not found." };
  if (db[username].password !== password) return { ok: false, error: "Wrong password." };
  return { ok: true };
}

// ════════════════════════════════════════════════════════
// AUTH SCREEN
// ════════════════════════════════════════════════════════
function AuthScreen({ onAuth }) {
  const [tab,      setTab]      = useState("signin");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm,  setConfirm]  = useState("");
  const [error,    setError]    = useState("");
  const [loading,  setLoading]  = useState(false);

  const submit = async () => {
    setError("");
    if (!username.trim()) return setError("Username is required.");
    if (!password)        return setError("Password is required.");

    setLoading(true);
    await new Promise(r => setTimeout(r, 200)); // simulate async

    if (tab === "signup") {
      if (password !== confirm) { setLoading(false); return setError("Passwords don't match."); }
      const res = signUp(username.trim(), password);
      if (!res.ok) { setLoading(false); return setError(res.error); }
    } else {
      const res = signIn(username.trim(), password);
      if (!res.ok) { setLoading(false); return setError(res.error); }
    }

    const user = { username: username.trim(), color: colorForUser(username.trim()) };
    setStoredUser(user);
    setLoading(false);
    onAuth(user);
  };

  const handleKey = (e) => { if (e.key === "Enter") submit(); };

  return (
    <div className="auth-root">
      {/* Branding */}
      <div className="auth-brand">
        <div className="brand-logo">
          <div className="brand-logo-mark">&lt;/&gt;</div>
          <span className="brand-name">CodeTogether</span>
        </div>

        <div className="brand-hero">
          <p className="brand-eyebrow">Real-time collaboration</p>
          <h1 className="brand-headline">
            Code together,<br />
            <em>ship faster.</em>
          </h1>
          <p className="brand-sub">
            A collaborative coding environment with live cursors, chat, multi-language support, and instant code execution.
          </p>
        </div>

        <div className="brand-features">
          <div className="brand-feature"><span className="brand-feature-dot" />Live collaborative editing with presence</div>
          <div className="brand-feature"><span className="brand-feature-dot" />Run Python, Java, C++, Go, Rust & more</div>
          <div className="brand-feature"><span className="brand-feature-dot" />Persistent rooms with history</div>
          <div className="brand-feature"><span className="brand-feature-dot" />Real-time chat built in</div>
        </div>
      </div>

      {/* Form */}
      <div className="auth-form-panel">
        <div className="auth-card">
          <div className="auth-tab-row">
            <button className={`auth-tab${tab === "signin"  ? " auth-tab--active" : ""}`} onClick={() => { setTab("signin");  setError(""); }}>Sign In</button>
            <button className={`auth-tab${tab === "signup" ? " auth-tab--active" : ""}`} onClick={() => { setTab("signup"); setError(""); }}>Sign Up</button>
          </div>

          <h2 className="auth-heading">{tab === "signin" ? "Welcome back" : "Create account"}</h2>
          <p className="auth-subheading">{tab === "signin" ? "Sign in to access your rooms." : "Join the collaborative coding experience."}</p>

          <div className="auth-fields">
            <div className="field-group">
              <label className="field-label">Username</label>
              <input className="field-input" type="text" placeholder="your_username"
                value={username} onChange={e => setUsername(e.target.value)}
                onKeyDown={handleKey} autoFocus autoComplete="username" />
            </div>

            <div className="field-group">
              <label className="field-label">Password</label>
              <input className="field-input" type="password" placeholder="••••••••"
                value={password} onChange={e => setPassword(e.target.value)}
                onKeyDown={handleKey} autoComplete={tab === "signup" ? "new-password" : "current-password"} />
            </div>

            {tab === "signup" && (
              <div className="field-group">
                <label className="field-label">Confirm Password</label>
                <input className="field-input" type="password" placeholder="••••••••"
                  value={confirm} onChange={e => setConfirm(e.target.value)}
                  onKeyDown={handleKey} autoComplete="new-password" />
              </div>
            )}

            {error && <p className="field-error">{error}</p>}

            <button className="auth-btn" onClick={submit} disabled={loading}>
              {loading ? "Please wait…" : tab === "signin" ? "Sign In →" : "Create Account →"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════
// CREATE ROOM MODAL
// ════════════════════════════════════════════════════════
function CreateRoomModal({ onClose, onCreated, currentUser }) {
  const [roomName,  setRoomName]  = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [password,  setPassword]  = useState("");
  const [error,     setError]     = useState("");
  const [loading,   setLoading]   = useState(false);

  const submit = async () => {
    setError("");
    const r = roomName.trim();
    if (!r) return setError("Room name is required.");
    if (isPrivate && !password.trim()) return setError("Private rooms need a password.");

    setLoading(true);
    try {
      const res  = await fetch(`${SERVER_URL}/rooms`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ room: r, owner: currentUser.username, isPrivate, password: isPrivate ? password : "" }),
      });
      const data = await res.json();
      if (!data.ok) { setError(data.error || "Could not create room."); setLoading(false); return; }
    } catch {
      // server may be offline, allow optimistically
    }

    const entry = {
      name: r, isPrivate, owner: currentUser.username,
      members: [{ username: currentUser.username, color: currentUser.color }],
      lastSeen: Date.now(), createdAt: Date.now(),
    };

    setLoading(false);
    onCreated(entry, isPrivate ? password : "");
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">Create Room</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="field-group">
            <label className="field-label">Room Name</label>
            <input className="field-input" type="text" placeholder=""
              value={roomName} onChange={e => setRoomName(e.target.value.toLowerCase().replace(/\s+/g, "-"))}
              onKeyDown={e => e.key === "Enter" && submit()} autoFocus />
          </div>

          <div className="field-group">
            <label className="field-label">Visibility</label>
            <div className="vis-toggle">
              <button className={`vis-btn${!isPrivate ? " vis-btn--active" : ""}`} onClick={() => setIsPrivate(false)}>🌐 Public</button>
              <button className={`vis-btn${ isPrivate ? " vis-btn--active" : ""}`} onClick={() => setIsPrivate(true)}>🔒 Private</button>
            </div>
          </div>

          {isPrivate && (
            <div className="field-group">
              <label className="field-label">Room Password</label>
              <input className="field-input" type="password" placeholder="••••••••"
                value={password} onChange={e => setPassword(e.target.value)}
                onKeyDown={e => e.key === "Enter" && submit()} />
            </div>
          )}

          {error && <p className="field-error">{error}</p>}

          <button className="modal-submit-btn" onClick={submit} disabled={loading}>
            {loading ? "Creating…" : "Create Room →"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════
// JOIN ROOM MODAL
// ════════════════════════════════════════════════════════
function JoinRoomModal({ onClose, onJoined, currentUser }) {
  const [roomName, setRoomName] = useState(() => new URLSearchParams(window.location.search).get("room") || "");
  const [password, setPassword] = useState("");
  const [meta,     setMeta]     = useState(null);
  const [checking, setChecking] = useState(false);
  const [error,    setError]    = useState("");
  const [loading,  setLoading]  = useState(false);

  useEffect(() => {
    if (!roomName.trim()) { setMeta(null); return; }
    const t = setTimeout(async () => {
      setChecking(true);
      try {
        const res  = await fetch(`${SERVER_URL}/rooms/${encodeURIComponent(roomName.trim())}/meta`);
        const data = await res.json();
        setMeta(data.exists ? data : null);
      } catch { setMeta(null); }
      finally  { setChecking(false); }
    }, 500);
    return () => clearTimeout(t);
  }, [roomName]);

  const submit = async () => {
    setError("");
    const r = roomName.trim();
    if (!r) return setError("Room name is required.");

    setLoading(true);
    try {
      const res  = await fetch(`${SERVER_URL}/rooms/${encodeURIComponent(r)}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: currentUser.username, password }),
      });
      const data = await res.json();
      if (!data.ok) { setError(data.error || "Could not join."); setLoading(false); return; }
    } catch {
      // allow optimistically
    }

    const entry = {
      name: r, isPrivate: meta?.isPrivate || false,
      owner: meta?.owner || "unknown",
      members: [{ username: currentUser.username, color: currentUser.color }],
      lastSeen: Date.now(), createdAt: meta?.createdAt || Date.now(),
    };

    setLoading(false);
    onJoined(entry, password);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">Join Room</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="field-group">
            <label className="field-label">Room Name</label>
            <input className="field-input" type="text" placeholder="room-name"
              value={roomName} onChange={e => setRoomName(e.target.value.toLowerCase().replace(/\s+/g, "-"))}
              onKeyDown={e => e.key === "Enter" && submit()} autoFocus />
            {checking && <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Checking…</span>}
            {!checking && meta && (
              <span style={{ fontSize: 11, color: "var(--green)" }}>
                ✓ Room found · {meta.isPrivate ? "🔒 Private" : "🌐 Public"} · Owner: {meta.owner}
              </span>
            )}
          </div>

          {(!meta || meta.isPrivate) && roomName.trim() && (
            <div className="field-group">
              <label className="field-label">Password {meta && !meta.isPrivate ? "(optional)" : ""}</label>
              <input className="field-input" type="password" placeholder="Leave blank if public"
                value={password} onChange={e => setPassword(e.target.value)}
                onKeyDown={e => e.key === "Enter" && submit()} />
            </div>
          )}

          {error && <p className="field-error">{error}</p>}

          <button className="modal-submit-btn" onClick={submit} disabled={loading}>
            {loading ? "Joining…" : "Join Room →"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════
// DASHBOARD
// ════════════════════════════════════════════════════════
function Dashboard({ currentUser, onEnterRoom, onLogout }) {
  const [rooms,         setRooms]         = useState(() => getStoredRooms(currentUser.username));
  const [showCreate,    setShowCreate]    = useState(false);
  const [showJoin,      setShowJoin]      = useState(false);

  const userColor = currentUser.color || colorForUser(currentUser.username);

  const handleCreated = (entry, password) => {
    addStoredRoom(currentUser.username, entry);
    setRooms(getStoredRooms(currentUser.username));
    setShowCreate(false);
    onEnterRoom(entry.name, true, password);
  };

  const handleJoined = (entry, password) => {
    addStoredRoom(currentUser.username, entry);
    setRooms(getStoredRooms(currentUser.username));
    setShowJoin(false);
    onEnterRoom(entry.name, entry.owner === currentUser.username, password);
  };

  const enterExistingRoom = (room) => {
    // update lastSeen
    const updated = { ...room, lastSeen: Date.now() };
    addStoredRoom(currentUser.username, updated);
    setRooms(getStoredRooms(currentUser.username));
    onEnterRoom(room.name, room.owner === currentUser.username, "");
  };

  return (
    <div className="dash-root">
      {/* Nav */}
      <nav className="dash-nav">
        <div className="nav-logo">
          <div className="nav-logo-mark">&lt;/&gt;</div>
          <span className="nav-brand">CodeTogether</span>
        </div>
        <div className="nav-right">
          <div className="nav-user">
            <div className="nav-avatar" style={{ background: userColor + "22", color: userColor }}>
              {initials(currentUser.username)}
            </div>
            <span className="nav-username">{currentUser.username}</span>
          </div>
          <button className="nav-logout" onClick={onLogout}>Sign out</button>
        </div>
      </nav>

      {/* Body */}
      <div className="dash-body">
        <div className="dash-hero">
          <h1 className="dash-greeting">
            Hello, <span>{currentUser.username}</span>
          </h1>
          <p className="dash-sub">Pick a room to jump into, or start something new.</p>
        </div>

        {/* Quick actions */}
        <div className="dash-actions">
          <div className="action-card action-card--create" onClick={() => setShowCreate(true)}>
            <div className="action-icon">✦</div>
            <div className="action-title">Create Room</div>
            <div className="action-desc">Start a new collaborative coding session. Invite teammates with a link.</div>
          </div>
          <div className="action-card action-card--join" onClick={() => setShowJoin(true)}>
            <div className="action-icon">⇥</div>
            <div className="action-title">Join Room</div>
            <div className="action-desc">Enter an existing room by name. Enter the password if it's private.</div>
          </div>
        </div>

        {/* Room history */}
        <div>
          <div className="dash-section-header">
            <span className="dash-section-title">Your Rooms</span>
            <span className="dash-section-count">{rooms.length}</span>
          </div>

          {rooms.length === 0 ? (
            <div className="rooms-empty">
              <span className="rooms-empty-icon">📭</span>
              <div className="rooms-empty-title">No rooms yet</div>
              <div style={{ fontSize: 13, color: "var(--text-muted)" }}>Create or join a room to get started.</div>
            </div>
          ) : (
            <div className="rooms-grid">
              {rooms.map(room => (
                <div key={room.name} className="room-card" onClick={() => enterExistingRoom(room)}>
                  <div className="room-card-top">
                    <span className="room-card-name">{room.name}</span>
                    <span className={`room-card-badge ${room.owner === currentUser.username ? "room-card-badge--owner" : "room-card-badge--member"}`}>
                      {room.owner === currentUser.username ? "Owner" : "Member"}
                    </span>
                  </div>

                  <div className="room-card-meta">
                    <div className="room-card-row">
                      <span className="room-card-row-icon">{room.isPrivate ? "🔒" : "🌐"}</span>
                      <span>{room.isPrivate ? "Private" : "Public"}</span>
                      <span style={{ color: "var(--text-faint)" }}>·</span>
                      <span>Owner: {room.owner}</span>
                    </div>
                    <div className="room-card-row">
                      <span className="room-card-row-icon">🕐</span>
                      <span>{fmtDate(room.lastSeen)}</span>
                    </div>
                  </div>

                  <div className="room-card-members">
                    <div className="member-avatars">
                      {(room.members || []).slice(0, 5).map((m, i) => {
                        const c = m.color || colorForUser(m.username);
                        return (
                          <div key={i} className="member-avatar"
                            style={{ background: c + "22", color: c }}
                            title={m.username}>
                            {initials(m.username)}
                          </div>
                        );
                      })}
                    </div>
                    <span className="room-card-enter">
                      Enter <span>→</span>
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {showCreate && (
        <CreateRoomModal
          currentUser={currentUser}
          onClose={() => setShowCreate(false)}
          onCreated={handleCreated}
        />
      )}

      {showJoin && (
        <JoinRoomModal
          currentUser={currentUser}
          onClose={() => setShowJoin(false)}
          onJoined={handleJoined}
        />
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════
// CHAT PANEL
// ════════════════════════════════════════════════════════
function ChatPanel({ ydoc, userName, userColor }) {
  const yMessages = useMemo(() => ydoc.getArray("chat:messages"), [ydoc]);
  const [messages, setMessages] = useState(() => yMessages.toArray());
  const [draft, setDraft]       = useState("");
  const bottomRef               = useRef(null);

  useEffect(() => {
    const handler = () => setMessages(yMessages.toArray());
    yMessages.observe(handler);
    return () => yMessages.unobserve(handler);
  }, [yMessages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    yMessages.push([{ username: userName, color: userColor, text, ts: Date.now() }]);
    setDraft("");
  };

  return (
    <div className="chat-panel">
      <div className="chat-messages">
        {messages.length === 0 && <p className="chat-empty">No messages yet.</p>}
        {messages.map((m, i) => {
          const isMe       = m.username === userName;
          const showHeader = i === 0 || messages[i - 1].username !== m.username;
          return (
            <div key={i} className={`chat-msg${isMe ? " chat-msg--me" : ""}`}>
              {showHeader && (
                <div className="chat-msg-header">
                  <span className="chat-msg-author" style={{ color: m.color || colorForUser(m.username) }}>
                    {m.username}
                  </span>
                  <span className="chat-msg-time">{fmtTime(m.ts)}</span>
                </div>
              )}
              <div className="chat-msg-bubble">{m.text}</div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
      <div className="chat-input-row">
        <input className="chat-input" placeholder="Message…"
          value={draft} onChange={e => setDraft(e.target.value)}
          onKeyDown={e => e.key === "Enter" && send()} />
        <button className="chat-send-btn" onClick={send}>↑</button>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════
// FILE TABS
// ════════════════════════════════════════════════════════
function FileTabs({ tabs, activeTab, language, onSelect, onCreate, onRename, onDelete }) {
  const ext = LANGUAGES.find(l => l.id === language)?.ext ?? "js";
  const [editingId, setEditingId] = useState(null);
  const [editVal,   setEditVal]   = useState("");

  const startEdit = (tab, e) => {
    e.stopPropagation();
    setEditingId(tab.id);
    setEditVal(tab.name);
  };

  const commitEdit = (id) => {
    if (editVal.trim()) onRename(id, editVal.trim());
    setEditingId(null);
  };

  return (
    <div className="file-tabs">
      {tabs.map(tab => (
        <div key={tab.id}
          className={`file-tab${tab.id === activeTab ? " file-tab--active" : ""}`}
          onClick={() => onSelect(tab.id)}
          onDoubleClick={e => startEdit(tab, e)}
        >
          {editingId === tab.id ? (
            <input
              className="file-tab-rename"
              value={editVal}
              autoFocus
              onChange={e => setEditVal(e.target.value)}
              onBlur={() => commitEdit(tab.id)}
              onKeyDown={e => {
                if (e.key === "Enter")  commitEdit(tab.id);
                if (e.key === "Escape") setEditingId(null);
                e.stopPropagation();
              }}
              onClick={e => e.stopPropagation()}
            />
          ) : (
            <span className="file-tab-name">{tab.name}.{ext}</span>
          )}
          {tabs.length > 1 && (
            <button className="file-tab-close"
              onClick={e => { e.stopPropagation(); onDelete(tab.id); }}>×</button>
          )}
        </div>
      ))}
      <button className="file-tab-new" onClick={onCreate} title="New file">+</button>
    </div>
  );
}

// ════════════════════════════════════════════════════════
// OUTPUT PANEL
// ════════════════════════════════════════════════════════
function OutputPanel({ code, language, onClose }) {
  const [output,  setOutput]  = useState(null);
  const [running, setRunning] = useState(false);
  const [error,   setError]   = useState(null);
  const [stdin,   setStdin]   = useState("");
  const iframeRef = useRef(null);

  const langMeta = LANGUAGES.find(l => l.id === language);

  const runJS = useCallback(() => {
    setRunning(true); setError(null); setOutput(null);
    const logs = [];

    const handler = (e) => {
      if (e.data?.type === "log")   logs.push(...e.data.lines);
      if (e.data?.type === "done")  { setOutput(logs); setRunning(false); }
      if (e.data?.type === "error") { setError(e.data.msg); setRunning(false); }
    };
    window.addEventListener("message", handler);

    const srcdoc = `<script>
      const _l=[];
      const _p=(...a)=>{
        const line=a.map(x=>{try{return typeof x==='object'?JSON.stringify(x,null,2):String(x);}catch{return String(x);}}).join(' ');
        _l.push(line);
        parent.postMessage({type:'log',lines:[line]},'*');
      };
      console.log=console.warn=console.error=console.info=_p;
      window.onerror=(msg)=>parent.postMessage({type:'error',msg:'Runtime error: '+msg},'*');
      try{${code};parent.postMessage({type:'done'},'*');}
      catch(e){parent.postMessage({type:'error',msg:e.toString()},'*');}
    <\/script>`;

    if (iframeRef.current) iframeRef.current.remove();
    const iframe = document.createElement("iframe");
    iframeRef.current = iframe;
    iframe.sandbox = "allow-scripts";
    iframe.style.display = "none";
    iframe.srcdoc = srcdoc;
    document.body.appendChild(iframe);

    const cleanup = (e) => {
      if (e.data?.type === "done" || e.data?.type === "error") {
        window.removeEventListener("message", handler);
        window.removeEventListener("message", cleanup);
      }
    };
    window.addEventListener("message", cleanup);
    setTimeout(() => { window.removeEventListener("message", handler); }, 15000);
  }, [code]);

  const runHTML = useCallback(() => {
    setRunning(false); setError(null); setOutput("__HTML__");
  }, []);

  const runJudge0 = useCallback(async () => {
    if (!JUDGE0_KEY) {
      setError(
        "No Judge0 API key configured.\n\n" +
        "Add VITE_JUDGE0_KEY to your .env file.\n" +
        "Get a free key at: rapidapi.com/judge0-official/api/judge0-ce\n\n" +
        "For JavaScript, you can run code directly in the browser!"
      );
      return;
    }
    setRunning(true); setError(null); setOutput(null);

    try {
      const submitRes = await fetch(`${JUDGE0_URL}/submissions?base64_encoded=false&wait=false`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-RapidAPI-Key":  JUDGE0_KEY,
          "X-RapidAPI-Host": JUDGE0_HOST,
        },
        body: JSON.stringify({ language_id: langMeta.judge0Id, source_code: code, stdin }),
      });
      const { token } = await submitRes.json();

      let result;
      for (let i = 0; i < 20; i++) {
        await new Promise(r => setTimeout(r, 800));
        const pollRes = await fetch(`${JUDGE0_URL}/submissions/${token}?base64_encoded=false`, {
          headers: { "X-RapidAPI-Key": JUDGE0_KEY, "X-RapidAPI-Host": JUDGE0_HOST },
        });
        result = await pollRes.json();
        if (result.status?.id >= 3) break;
      }

      if (result.stderr)              setError(result.stderr);
      else if (result.compile_output) setError("Compile error:\n" + result.compile_output);
      else setOutput((result.stdout || "(no output)").split("\n"));
    } catch (e) {
      setError("Judge0 request failed: " + e.message);
    } finally {
      setRunning(false);
    }
  }, [code, langMeta, stdin]);

  const run = () => {
    if (language === "javascript") return runJS();
    if (language === "html")       return runHTML();
    return runJudge0();
  };

  const needsStdin = langMeta?.judge0Id && !langMeta?.browser;

  return (
    <div className="output-panel">
      <div className="output-header">
        <div className="output-header-left">
          <span className="output-title">Output</span>
          <span className="output-lang-badge">{langMeta?.label}</span>
          {langMeta?.browser
            ? <span className="output-engine">runs in-browser</span>
            : JUDGE0_KEY
              ? <span className="output-engine">via Judge0</span>
              : <span className="output-engine output-engine--warn">needs Judge0 key</span>
          }
        </div>
        <div className="output-header-right">
          {langMeta?.runnable && (
            <button className="run-btn" onClick={run} disabled={running}>
              {running ? <><span className="run-spinner" />Running…</> : <><span className="run-icon">▶</span>Run</>}
            </button>
          )}
          <button className="output-close-btn" onClick={onClose}>✕</button>
        </div>
      </div>

      <div className="output-body">
        {needsStdin && (
          <div className="stdin-wrapper" style={{ marginBottom: 12 }}>
            <div className="stdin-label">stdin (optional)</div>
            <textarea className="stdin-input" placeholder="Program input…"
              value={stdin} onChange={e => setStdin(e.target.value)} />
          </div>
        )}

        {output === null && !error && !running && (
          <div className="output-empty">
            {langMeta?.runnable
              ? <><span className="output-empty-icon">▶</span><p>Press <strong>Run</strong> to execute</p></>
              : <><span className="output-empty-icon">◌</span><p>{language.toUpperCase()} cannot be executed</p></>
            }
          </div>
        )}

        {running && (
          <div className="output-empty">
            <span className="output-empty-icon output-pulse">⬡</span><p>Running…</p>
          </div>
        )}

        {output === "__HTML__" && !running && (
          <iframe className="output-html-frame" sandbox="allow-scripts allow-same-origin" srcDoc={code} title="Preview" />
        )}

        {output && output !== "__HTML__" && !running && (
          <div className="output-lines">
            {output.length === 0
              ? <span className="output-line output-line--muted">(no output)</span>
              : output.map((line, i) => (
                <div key={i} className="output-line">
                  <span className="output-line-num">{i + 1}</span>
                  <span className="output-line-text">{line}</span>
                </div>
              ))
            }
          </div>
        )}

        {error && !running && (
          <div className="output-error">
            <span className="output-error-icon">✗</span>
            <pre className="output-error-text">{error}</pre>
          </div>
        )}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════
// EDITOR APP
// ════════════════════════════════════════════════════════
function EditorApp({ currentUser, room, isOwner: initialIsOwner, savedPassword, onLeave }) {
  const userName  = currentUser.username;
  const userColor = currentUser.color || colorForUser(userName);

  const ydoc   = useMemo(() => new Y.Doc(), []);
  const yFiles = useMemo(() => ydoc.getMap("files"),  [ydoc]);
  const yMeta  = useMemo(() => ydoc.getMap("meta"),   [ydoc]);

  const providerRef    = useRef(null);
  const editorRef      = useRef(null);
  const monacoRef      = useRef(null);
  const bindingRef     = useRef(null);
  const decorationsRef = useRef([]);
  // Undo history: array of { tabId, code }
  const undoHistoryRef = useRef([]);
  const lastSaveRef    = useRef({});

  const [connected,    setConnected]    = useState(false);
  const [users,        setUsers]        = useState([]);
  const [sidePanel,    setSidePanel]    = useState("users");
  const [tabs,         setTabs]         = useState([{ id: "file-1", name: "main", language: "javascript" }]);
  const [activeTab,    setActiveTabState] = useState("file-1");
  const [language,     setLanguage]     = useState("javascript");
  const [showOutput,   setShowOutput]   = useState(false);
  const [outputPanelH, setOutputPanelH] = useState(260);
  const [showRoomInfo, setShowRoomInfo] = useState(false);
  const [roomMeta,     setRoomMeta]     = useState(null);
  const [isOwner,      setIsOwner]      = useState(initialIsOwner);
  const [currentCode,  setCurrentCode]  = useState("");
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);

  // Drag handle for resizing output panel
  const startDrag = (e) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = outputPanelH;
    const onMove = (ev) => setOutputPanelH(Math.max(120, Math.min(600, startH + startY - ev.clientY)));
    const onUp   = () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup",   onUp);
  };

  // Fetch room meta
  useEffect(() => {
    fetch(`${SERVER_URL}/rooms/${encodeURIComponent(room)}/meta`)
      .then(r => r.json())
      .then(d => { setRoomMeta(d); if (d.owner === userName) setIsOwner(true); })
      .catch(() => {});
  }, [room, userName]);

  const syncTabs = useCallback(() => {
    const order  = yMeta.get("tabOrder") || Array.from(yFiles.keys());
    const synced = order.filter(id => yFiles.has(id)).map(id => ({ id, ...yFiles.get(id) }));
    if (synced.length > 0) setTabs(synced);
  }, [yFiles, yMeta]);

  useEffect(() => {
    const handshakeOpts = { autoConnect: true };
    if (savedPassword) handshakeOpts.query = { password: savedPassword };

    const provider = new SocketIOProvider(SERVER_URL, room, ydoc, handshakeOpts);
    providerRef.current = provider;

    provider.on("status", ({ status }) => setConnected(status === "connected"));
    provider.on("sync", (ok) => {
      if (!ok) return;
      setConnected(true);
      if (yFiles.size === 0) {
        ydoc.transact(() => {
          yFiles.set("file-1", { name: "main", language: "javascript" });
          yMeta.set("tabOrder", ["file-1"]);
          yMeta.set("activeTab", "file-1");
        });
      }
      syncTabs();
      const savedActive = yMeta.get("activeTab");
      if (savedActive) setActiveTabState(savedActive);
    });

    provider.awareness.on("change", () => {
      const states = Array.from(provider.awareness.getStates().values());
      const map    = new Map();
      states.forEach(s => { if (s.user?.username) map.set(s.user.username, s.user); });
      setUsers(Array.from(map.values()));
    });

    yFiles.observe(syncTabs);
    yMeta.observe(() => {
      syncTabs();
      const a = yMeta.get("activeTab");
      if (a) setActiveTabState(a);
    });

    setTimeout(() => {
      provider.awareness.setLocalStateField("user", { username: userName, color: userColor });
    }, 500);

    return () => {
      provider.awareness.setLocalStateField("user", null);
      bindingRef.current?.destroy?.();
      provider.disconnect();
      ydoc.destroy();
    };
  }, []); // eslint-disable-line

  const rebind = useCallback((tabId) => {
    const editor   = editorRef.current;
    const monaco   = monacoRef.current;
    const provider = providerRef.current;
    if (!editor || !monaco || !provider) return;

    bindingRef.current?.destroy?.();
    bindingRef.current = null;

    const yText = ydoc.getText(`file:${tabId}`);
    const code  = yText.toString();
    setCurrentCode(code);

    // Seed undo history snapshot for this tab
    if (!lastSaveRef.current[tabId]) lastSaveRef.current[tabId] = code;

    yText.observe(() => {
      const c = yText.toString();
      setCurrentCode(c);
    });

    bindingRef.current = new MonacoBinding(
      yText, editor.getModel(), new Set([editor]), provider.awareness
    );

    const meta = yFiles.get(tabId);
    const lang = meta?.language || "javascript";
    setLanguage(lang);
    monaco.editor.setModelLanguage(editor.getModel(), lang);
  }, [ydoc, yFiles]);

  const handleMount = useCallback((editor, monaco) => {
    editorRef.current  = editor;
    monacoRef.current  = monaco;
    rebind(activeTab);

    editor.onDidChangeCursorSelection(e => {
      const model = editor.getModel();
      if (!model) return;
      providerRef.current?.awareness.setLocalStateField("selection", {
        anchor: model.getOffsetAt(e.selection.getStartPosition()),
        head:   model.getOffsetAt(e.selection.getEndPosition()),
      });
    });

    // Save undo snapshot on Ctrl+S
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      const tabId = yMeta.get("activeTab") || "file-1";
      const code  = editor.getModel()?.getValue() || "";
      undoHistoryRef.current = [
        ...undoHistoryRef.current.filter(h => h.tabId !== tabId),
        { tabId, code, ts: Date.now() }
      ].slice(-50);
      lastSaveRef.current[tabId] = code;
    });
  }, []); // eslint-disable-line

  // Live cursors
  useEffect(() => {
    const editor   = editorRef.current;
    const monaco   = monacoRef.current;
    const provider = providerRef.current;
    if (!editor || !monaco || !provider || !connected) return;

    const render = () => {
      const newDecs = [];
      provider.awareness.getStates().forEach((state, clientId) => {
        if (clientId === provider.awareness.clientID) return;
        if (!state.user?.username || !state.selection) return;
        const { head } = state.selection;
        const model    = editor.getModel();
        if (!model) return;
        try {
          const pos   = model.getPositionAt(head);
          const color = state.user.color || colorForUser(state.user.username);
          const name  = state.user.username;
          let styleEl = document.getElementById(`cursor-style-${clientId}`);
          if (!styleEl) {
            styleEl    = document.createElement("style");
            styleEl.id = `cursor-style-${clientId}`;
            document.head.appendChild(styleEl);
          }
          styleEl.textContent = `
            .cursor-line-${clientId}  { border-left: 2px solid ${color}; margin-left: -1px; }
            .cursor-label-${clientId}::after {
              content: "${name}"; background: ${color}; color: #000;
              font-size: 10px; font-family: var(--font-ui, sans-serif);
              padding: 1px 4px; border-radius: 3px;
              position: absolute; top: -18px; left: 0;
              white-space: nowrap; pointer-events: none;
            }
          `;
          newDecs.push({
            range: new monaco.Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column),
            options: { className: `cursor-line-${clientId}`, beforeContentClassName: `cursor-label-${clientId}`, stickiness: 1 },
          });
          if (state.selection.anchor !== state.selection.head) {
            const anchorPos = model.getPositionAt(state.selection.anchor);
            const [s, end]  = head > state.selection.anchor ? [anchorPos, pos] : [pos, anchorPos];
            newDecs.push({
              range: new monaco.Range(s.lineNumber, s.column, end.lineNumber, end.column),
              options: { className: "remote-selection" },
            });
          }
        } catch {}
      });
      decorationsRef.current = editor.deltaDecorations(decorationsRef.current, newDecs);
    };

    provider.awareness.on("change", render);
    return () => provider.awareness.off("change", render);
  }, [connected]);

  const selectTab = useCallback((id) => {
    setActiveTabState(id);
    yMeta.set("activeTab", id);
    rebind(id);
  }, [yMeta, rebind]);

  const createTab = useCallback(() => {
    const id   = `file-${Date.now()}`;
    const name = `file${yFiles.size + 1}`;
    ydoc.transact(() => {
      yFiles.set(id, { name, language });
      yMeta.set("tabOrder", [...(yMeta.get("tabOrder") || []), id]);
      yMeta.set("activeTab", id);
    });
    selectTab(id);
  }, [ydoc, yFiles, yMeta, language, selectTab]);

  const renameTab = useCallback((id, name) => {
    const meta = yFiles.get(id) || {};
    yFiles.set(id, { ...meta, name });
  }, [yFiles]);

  const deleteTab = useCallback((id) => {
    const order = (yMeta.get("tabOrder") || []).filter(x => x !== id);
    ydoc.transact(() => {
      yFiles.delete(id);
      yMeta.set("tabOrder", order);
      yMeta.set("activeTab", order[0] || "");
    });
    if (order[0]) selectTab(order[0]);
  }, [ydoc, yFiles, yMeta, selectTab]);

  const changeLang = useCallback((e) => {
    const lang = e.target.value;
    setLanguage(lang);
    const meta = yFiles.get(activeTab) || {};
    yFiles.set(activeTab, { ...meta, language: lang });
    const model = editorRef.current?.getModel();
    if (model && monacoRef.current)
      monacoRef.current.editor.setModelLanguage(model, lang);
    setTabs(prev => prev.map(t => t.id === activeTab ? { ...t, language: lang } : t));
  }, [activeTab, yFiles]);

  // Undo to last snapshot
  const handleUndo = useCallback(() => {
    const tabId = activeTab;
    const snapshots = undoHistoryRef.current.filter(h => h.tabId === tabId);
    if (snapshots.length === 0) {
      alert("No saved snapshots yet. Use Ctrl+S (Cmd+S) to save a snapshot, then you can undo to it.");
      return;
    }
    const snap = snapshots[snapshots.length - 1];
    const yText = ydoc.getText(`file:${tabId}`);
    ydoc.transact(() => {
      yText.delete(0, yText.length);
      yText.insert(0, snap.code);
    });
    undoHistoryRef.current = undoHistoryRef.current.filter(h => !(h.tabId === tabId && h.ts === snap.ts));
  }, [activeTab, ydoc]);

  const langMeta = LANGUAGES.find(l => l.id === language);
  const canRun   = langMeta?.runnable;

  const inviteUrl = `${window.location.origin}?room=${encodeURIComponent(room)}`;
  const [copied, setCopied] = useState(false);
  const copyInvite = () => {
    navigator.clipboard.writeText(inviteUrl).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  };

  const handleLeave = () => {
    // Update room lastSeen in history
    const entry = { name: room, isPrivate: roomMeta?.isPrivate || false, owner: roomMeta?.owner || "", members: users, lastSeen: Date.now(), createdAt: roomMeta?.createdAt || Date.now() };
    addStoredRoom(userName, entry);
    setShowLeaveConfirm(false);
    onLeave();
  };

  return (
    <main className="editor-layout">
      {/* ── Sidebar ── */}
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="sidebar-logo-mark">&lt;/&gt;</div>
          <span className="sidebar-brand">CodeTogether</span>
        </div>

        {/* Room info */}
        <div className="sidebar-section">
          <p className="sidebar-section-label">Room</p>
          <div className="room-pill" onClick={() => setShowRoomInfo(true)} title="Room info">
            <div className="room-pill-left">
              <span className="room-privacy-icon">{roomMeta?.isPrivate ? "🔒" : "🌐"}</span>
              <span className="room-name">{room}</span>
            </div>
            <span className={`conn-dot ${connected ? "conn-dot--live" : "conn-dot--off"}`} />
          </div>
          {isOwner && <div className="owner-badge">👑 You own this room</div>}
          <button className="leave-btn" onClick={() => setShowLeaveConfirm(true)}>
            ← Leave Room
          </button>
        </div>

        {/* Language */}
        <div className="sidebar-section">
          <p className="sidebar-section-label">Language</p>
          <select className="lang-select" value={language} onChange={changeLang}>
            {LANGUAGES.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
          </select>
        </div>

        {/* Sidebar tabs */}
        <div className="sidebar-tabs">
          <button className={`sidebar-tab-btn${sidePanel === "users" ? " sidebar-tab-btn--active" : ""}`}
            onClick={() => setSidePanel("users")}>
            Users <span className="user-count">{users.length}</span>
          </button>
          <button className={`sidebar-tab-btn${sidePanel === "chat" ? " sidebar-tab-btn--active" : ""}`}
            onClick={() => setSidePanel("chat")}>
            Chat
          </button>
        </div>

        {sidePanel === "users" && (
          <div className="sidebar-section sidebar-section--grow">
            <ul className="user-list">
              {users.map(u => {
                const c    = u.color || colorForUser(u.username);
                const isMe = u.username === userName;
                return (
                  <li key={u.username} className="user-item">
                    <div className="user-avatar" style={{ background: c + "22", color: c }}>{initials(u.username)}</div>
                    <span className="user-name">
                      {u.username}
                      {isMe && <span className="user-you"> (you)</span>}
                      {roomMeta?.owner === u.username && <span title="Owner"> 👑</span>}
                    </span>
                    <span className="user-cursor-dot" style={{ background: c }} />
                  </li>
                );
              })}
              {users.length === 0 && <li className="user-empty">Connecting…</li>}
            </ul>
          </div>
        )}

        {sidePanel === "chat" && (
          <div className="sidebar-section sidebar-section--chat">
            <ChatPanel ydoc={ydoc} userName={userName} userColor={userColor} />
          </div>
        )}

        <div className="sidebar-footer">
          <div className="you-avatar" style={{ background: userColor + "22", color: userColor }}>
            {initials(userName)}
          </div>
          <div className="you-info">
            <span className="you-name">{userName}</span>
            <span className="you-role">{isOwner ? "Owner" : "Editor"}</span>
          </div>
        </div>
      </aside>

      {/* ── Editor + Output ── */}
      <section className="editor-section">
        <div className="editor-topbar">
          <FileTabs
            tabs={tabs} activeTab={activeTab} language={language}
            onSelect={selectTab} onCreate={createTab}
            onRename={renameTab} onDelete={deleteTab}
          />
          <div className="topbar-actions">
            <button className="topbar-undo-btn" onClick={handleUndo} title="Undo to last Ctrl+S snapshot">
              ↩ Undo
            </button>
            {canRun && (
              <button
                className={`topbar-run-btn${showOutput ? " topbar-run-btn--active" : ""}`}
                onClick={() => setShowOutput(v => !v)}
              >
                <span className="run-icon">▶</span>
                {showOutput ? "Hide" : "Run"}
              </button>
            )}
          </div>
        </div>

        <div className="editor-and-output">
          <div className="editor-wrap">
            <Editor
              height="100%"
              language={language}
              defaultValue={`// Welcome to ${room}!\n// Start coding…\n`}
              theme="vs-dark"
              onMount={handleMount}
              options={{
                fontSize: 14,
                fontFamily: "'Space Mono', 'Fira Code', monospace",
                minimap: { enabled: false },
                lineNumbers: "on",
                wordWrap: "on",
                tabSize: 2,
                scrollBeyondLastLine: false,
                smoothScrolling: true,
                cursorBlinking: "phase",
                bracketPairColorization: { enabled: true },
                padding: { top: 12 },
                renderLineHighlight: "gutter",
              }}
            />
          </div>

          {showOutput && (
            <>
              <div className="output-drag-handle" onMouseDown={startDrag} />
              <div style={{ height: outputPanelH, flexShrink: 0 }}>
                <OutputPanel code={currentCode} language={language} onClose={() => setShowOutput(false)} />
              </div>
            </>
          )}
        </div>
      </section>

      {/* Room info modal */}
      {showRoomInfo && (
        <div className="modal-overlay" onClick={() => setShowRoomInfo(false)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Room Info</h2>
              <button className="modal-close" onClick={() => setShowRoomInfo(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="modal-row">
                <span className="modal-label">Room</span>
                <span className="modal-value modal-mono">{room}</span>
              </div>
              <div className="modal-row">
                <span className="modal-label">Visibility</span>
                <span className={`modal-badge ${roomMeta?.isPrivate ? "modal-badge--private" : "modal-badge--public"}`}>
                  {roomMeta?.isPrivate ? "🔒 Private" : "🌐 Public"}
                </span>
              </div>
              <div className="modal-row">
                <span className="modal-label">Owner</span>
                <span className="modal-value">{roomMeta?.owner || "—"}</span>
              </div>
              <div className="modal-divider" />
              <div className="modal-label" style={{ marginBottom: 8 }}>Invite link</div>
              <div className="modal-invite-row">
                <span className="modal-invite-url">{inviteUrl}</span>
                <button className="modal-copy-btn" onClick={copyInvite}>{copied ? "Copied!" : "Copy"}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Leave confirm modal */}
      {showLeaveConfirm && (
        <div className="modal-overlay" onClick={() => setShowLeaveConfirm(false)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Leave Room?</h2>
              <button className="modal-close" onClick={() => setShowLeaveConfirm(false)}>✕</button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6 }}>
                You'll be taken back to your dashboard. The room and its code will remain intact — you can rejoin anytime.
              </p>
              <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
                <button
                  style={{ flex: 1, padding: "10px", background: "var(--bg-700)", border: "1px solid var(--border)", borderRadius: "var(--radius)", color: "var(--text-secondary)", cursor: "pointer", fontFamily: "var(--font-ui)", fontSize: 13 }}
                  onClick={() => setShowLeaveConfirm(false)}
                >Stay</button>
                <button
                  style={{ flex: 1, padding: "10px", background: "var(--red-dim)", border: "1px solid rgba(244,63,94,0.3)", borderRadius: "var(--radius)", color: "var(--red)", cursor: "pointer", fontFamily: "var(--font-ui)", fontSize: 13, fontWeight: 600 }}
                  onClick={handleLeave}
                >Leave Room</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

// ════════════════════════════════════════════════════════
// ROOT APP
// ════════════════════════════════════════════════════════
function App() {
  const [user,    setUser]    = useState(() => getStoredUser());
  const [session, setSession] = useState(null);
  // session: { room, isOwner, password }

  const handleAuth = (u) => {
    setStoredUser(u);
    setUser(u);
  };

  const handleLogout = () => {
    clearStoredUser();
    setUser(null);
    setSession(null);
  };

  const handleEnterRoom = (room, isOwner, password) => {
    setSession({ room, isOwner, password });
    window.history.pushState({}, "", `?room=${encodeURIComponent(room)}`);
  };

  const handleLeave = () => {
    setSession(null);
    window.history.pushState({}, "", "/");
  };

  if (!user) return <AuthScreen onAuth={handleAuth} />;

  if (session) return (
    <EditorApp
      currentUser={user}
      room={session.room}
      isOwner={session.isOwner}
      savedPassword={session.password}
      onLeave={handleLeave}
    />
  );

  return (
    <Dashboard
      currentUser={user}
      onEnterRoom={handleEnterRoom}
      onLogout={handleLogout}
    />
  );
}

export default App;