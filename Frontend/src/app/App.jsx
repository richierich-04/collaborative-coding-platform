// App.jsx — CodeTogether (with Room Permissions + Output Panel)

import "./App.css";
import { Editor } from "@monaco-editor/react";
import { MonacoBinding } from "y-monaco";
import { useRef, useMemo, useState, useEffect, useCallback } from "react";
import * as Y from "yjs";
import { SocketIOProvider } from "y-socket.io";

const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:3000";

// Judge0 — free public instance (rate-limited). For production, host your own.
const JUDGE0_URL = import.meta.env.VITE_JUDGE0_URL || "https://judge0-ce.p.rapidapi.com";
const JUDGE0_KEY = import.meta.env.VITE_JUDGE0_KEY || ""; // set in .env

const LANGUAGES = [
  { id: "javascript", label: "JavaScript", ext: "js",  judge0Id: null  }, // runs in-browser
  { id: "typescript", label: "TypeScript", ext: "ts",  judge0Id: 74    },
  { id: "python",     label: "Python",     ext: "py",  judge0Id: 71    },
  { id: "go",         label: "Go",         ext: "go",  judge0Id: 60    },
  { id: "rust",       label: "Rust",       ext: "rs",  judge0Id: 73    },
  { id: "css",        label: "CSS",        ext: "css", judge0Id: null  },
  { id: "html",       label: "HTML",       ext: "html",judge0Id: null  }, // runs in-browser
  { id: "json",       label: "JSON",       ext: "json",judge0Id: null  },
];

const USER_COLORS = [
  "#60a5fa","#34d399","#f87171","#a78bfa",
  "#fbbf24","#fb923c","#e879f9","#2dd4bf",
];

function colorForUser(username) {
  let hash = 0;
  for (let i = 0; i < username.length; i++)
    hash = username.charCodeAt(i) + ((hash << 5) - hash);
  return USER_COLORS[Math.abs(hash) % USER_COLORS.length];
}

function initials(u) { return u.slice(0, 2).toUpperCase(); }
function fmtTime(ts)  { return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }

// ─── Join Screen ──────────────────────────────────────────────────────────────
function JoinScreen({ onJoin }) {
  const [name,     setName]     = useState("");
  const [room,     setRoom]     = useState(() =>
    new URLSearchParams(window.location.search).get("room") || ""
  );
  const [isOwner,  setIsOwner]  = useState(false); // true = create new room
  const [isPrivate,setIsPrivate]= useState(false);
  const [password, setPassword] = useState("");
  const [error,    setError]    = useState("");
  const [checking, setChecking] = useState(false);

  // When user types a room name, check if it exists
  useEffect(() => {
    if (!room.trim()) return;
    const t = setTimeout(async () => {
      try {
        setChecking(true);
        const res  = await fetch(`${SERVER_URL}/rooms/${encodeURIComponent(room.trim())}/meta`);
        const data = await res.json();
        // Room doesn't exist → user will be creating it
        setIsOwner(!data.exists);
        setIsPrivate(false);
        setPassword("");
      } catch (_) {
        setIsOwner(true);
      } finally {
        setChecking(false);
      }
    }, 400);
    return () => clearTimeout(t);
  }, [room]);

  const submit = async () => {
    const n = name.trim(), r = room.trim();
    if (!n) return setError("Username is required.");
    if (!r) return setError("Room name is required.");

    if (!isOwner) {
      // Joining existing room — verify password if needed
      try {
        const res  = await fetch(`${SERVER_URL}/rooms/${encodeURIComponent(r)}/join`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: n, password }),
        });
        const data = await res.json();
        if (!data.ok) return setError(data.error || "Could not join room.");
      } catch (_) {
        return setError("Server unreachable. Is the server running?");
      }
    } else {
      // Creating room
      try {
        const res  = await fetch(`${SERVER_URL}/rooms`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            room: r,
            owner: n,
            isPrivate,
            password: isPrivate ? password : "",
          }),
        });
        const data = await res.json();
        if (!data.ok) return setError(data.error || "Could not create room.");
      } catch (_) {
        return setError("Server unreachable. Is the server running?");
      }
    }

    setError("");
    onJoin(n, r, isOwner);
  };

  const existingRoom = room.trim() && !isOwner && !checking;
  const newRoom      = room.trim() &&  isOwner && !checking;

  return (
    <main className="join-screen">
      <div className="join-card">
        <div className="join-logo"><span className="join-logo-icon">&lt;/&gt;</span></div>
        <h1 className="join-title">CodeTogether</h1>
        <p className="join-subtitle">Real-time collaborative coding</p>

        <div className="join-fields">
          <div className="field-group">
            <label className="field-label">Username</label>
            <input className="field-input" type="text" placeholder=""
              value={name} onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === "Enter" && submit()} autoFocus />
          </div>

          <div className="field-group">
            <label className="field-label">Room</label>
            <div className="room-input-wrap">
              <input className="field-input" type="text" placeholder=""
                value={room} onChange={e => setRoom(e.target.value)}
                onKeyDown={e => e.key === "Enter" && submit()} />
              {checking && <span className="room-checking">checking…</span>}
              {existingRoom && <span className="room-badge room-badge--exists">🔗 existing room</span>}
              {newRoom      && <span className="room-badge room-badge--new">✨ new room</span>}
            </div>
            <span className="field-hint">Type a name to join or create a room.</span>
          </div>

          {/* Creating new room — privacy toggle */}
          {isOwner && room.trim() && (
            <div className="field-group">
              <label className="field-label">Room visibility</label>
              <div className="visibility-toggle">
                <button
                  className={`vis-btn${!isPrivate ? " vis-btn--active" : ""}`}
                  onClick={() => setIsPrivate(false)}
                >🌐 Public</button>
                <button
                  className={`vis-btn${isPrivate ? " vis-btn--active" : ""}`}
                  onClick={() => setIsPrivate(true)}
                >🔒 Private</button>
              </div>
              {isPrivate && (
                <input className="field-input" type="password" placeholder="Set a room password"
                  value={password} onChange={e => setPassword(e.target.value)}
                  style={{ marginTop: 8 }} />
              )}
            </div>
          )}

          {/* Joining private room — need password */}
          {existingRoom && (
            <div className="field-group">
              <label className="field-label">Password <span style={{color:"var(--text-muted)",fontWeight:400}}>(leave blank if public)</span></label>
              <input className="field-input" type="password" placeholder="Room password"
                value={password} onChange={e => setPassword(e.target.value)}
                onKeyDown={e => e.key === "Enter" && submit()} />
            </div>
          )}

          {error && <p className="field-error">{error}</p>}

          <button className="join-btn" onClick={submit}>
            {isOwner ? "Create & Join Room" : "Join Room"}
          </button>
        </div>
      </div>
    </main>
  );
}

// ─── Chat Panel ───────────────────────────────────────────────────────────────
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
        {messages.length === 0 && <p className="chat-empty">No messages yet. Say hello!</p>}
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

// ─── File Tabs Bar ────────────────────────────────────────────────────────────
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

// ─── Output Panel ─────────────────────────────────────────────────────────────
// Runs JS/HTML in a sandboxed iframe (no API needed).
// For Python/Go/Rust/TS, calls Judge0 if VITE_JUDGE0_KEY is set.
function OutputPanel({ code, language, onClose }) {
  const [output,  setOutput]  = useState(null);  // null = not run yet
  const [running, setRunning] = useState(false);
  const [error,   setError]   = useState(null);
  const iframeRef = useRef(null);

  const langMeta = LANGUAGES.find(l => l.id === language);

  // Run JS in-browser via sandboxed iframe
  const runJS = useCallback(() => {
    setRunning(true);
    setError(null);
    setOutput(null);

    const logs = [];
    const handler = (e) => {
      if (e.data?.type === "log")   logs.push(...e.data.lines);
      if (e.data?.type === "done")  { setOutput(logs); setRunning(false); }
      if (e.data?.type === "error") { setError(e.data.msg); setRunning(false); }
    };
    window.addEventListener("message", handler);

    const srcdoc = `
      <script>
        const _logs = [];
        const _push = (...a) => {
          const line = a.map(x => {
            try { return typeof x === "object" ? JSON.stringify(x, null, 2) : String(x); }
            catch(_) { return String(x); }
          }).join(" ");
          _logs.push(line);
          parent.postMessage({ type: "log", lines: [line] }, "*");
        };
        console.log   = _push;
        console.warn  = _push;
        console.error = _push;
        console.info  = _push;
        window.onerror = (msg) => {
          parent.postMessage({ type: "error", msg: "Runtime error: " + msg }, "*");
        };
        try {
          ${code}
          parent.postMessage({ type: "done" }, "*");
        } catch(e) {
          parent.postMessage({ type: "error", msg: e.toString() }, "*");
        }
      </script>
    `;

    if (iframeRef.current) iframeRef.current.remove();
    const iframe    = document.createElement("iframe");
    iframeRef.current = iframe;
    iframe.sandbox  = "allow-scripts";
    iframe.style.display = "none";
    iframe.srcdoc   = srcdoc;
    document.body.appendChild(iframe);

    // Cleanup listener after 10s timeout
    setTimeout(() => {
      window.removeEventListener("message", handler);
      if (running) { setError("Timed out after 10s"); setRunning(false); }
    }, 10000);

    // Remove handler once done
    const origHandler = handler;
    window.addEventListener("message", function cleanup(e) {
      if (e.data?.type === "done" || e.data?.type === "error") {
        window.removeEventListener("message", origHandler);
        window.removeEventListener("message", cleanup);
      }
    });
  }, [code, language]);

  // Run HTML — render in iframe directly
  const runHTML = useCallback(() => {
    setRunning(false);
    setError(null);
    setOutput("__HTML__"); // sentinel — renders iframe preview
  }, []);

  // Run via Judge0
  const runJudge0 = useCallback(async () => {
    if (!JUDGE0_KEY) {
      setError("No Judge0 API key set. Add VITE_JUDGE0_KEY to your .env file.\nGet a free key at rapidapi.com/judge0-official/api/judge0-ce");
      return;
    }
    setRunning(true);
    setError(null);
    setOutput(null);

    try {
      // Submit
      const submitRes = await fetch(`${JUDGE0_URL}/submissions?base64_encoded=false&wait=false`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-RapidAPI-Key": JUDGE0_KEY,
          "X-RapidAPI-Host": "judge0-ce.p.rapidapi.com",
        },
        body: JSON.stringify({
          language_id: langMeta.judge0Id,
          source_code: code,
          stdin: "",
        }),
      });
      const { token } = await submitRes.json();

      // Poll until done
      let result;
      for (let i = 0; i < 20; i++) {
        await new Promise(r => setTimeout(r, 800));
        const pollRes = await fetch(
          `${JUDGE0_URL}/submissions/${token}?base64_encoded=false`,
          { headers: { "X-RapidAPI-Key": JUDGE0_KEY, "X-RapidAPI-Host": "judge0-ce.p.rapidapi.com" } }
        );
        result = await pollRes.json();
        if (result.status?.id >= 3) break; // 3+ = finished
      }

      if (result.stderr)       setError(result.stderr);
      else if (result.compile_output) setError(result.compile_output);
      else setOutput((result.stdout || "(no output)").split("\n"));
    } catch (e) {
      setError("Judge0 error: " + e.message);
    } finally {
      setRunning(false);
    }
  }, [code, language, langMeta]);

  const run = () => {
    if (language === "javascript") return runJS();
    if (language === "html")       return runHTML();
    return runJudge0();
  };

  const canRun = language !== "css" && language !== "json";

  return (
    <div className="output-panel">
      {/* Header */}
      <div className="output-header">
        <div className="output-header-left">
          <span className="output-title">Output</span>
          <span className="output-lang-badge">{langMeta?.label}</span>
          {language === "javascript" || language === "html"
            ? <span className="output-engine">runs in-browser</span>
            : JUDGE0_KEY
              ? <span className="output-engine">via Judge0</span>
              : <span className="output-engine output-engine--warn">needs Judge0 key</span>
          }
        </div>
        <div className="output-header-right">
          {canRun && (
            <button className="run-btn" onClick={run} disabled={running}>
              {running
                ? <><span className="run-spinner" />Running…</>
                : <><span className="run-icon">▶</span> Run</>
              }
            </button>
          )}
          <button className="output-close-btn" onClick={onClose}>✕</button>
        </div>
      </div>

      {/* Body */}
      <div className="output-body">
        {output === null && !error && !running && (
          <div className="output-empty">
            {canRun
              ? <><span className="output-empty-icon">▶</span><p>Press <strong>Run</strong> to execute your code</p></>
              : <><span className="output-empty-icon">◌</span><p>{language.toUpperCase()} files can't be executed</p></>
            }
          </div>
        )}

        {running && (
          <div className="output-empty">
            <span className="output-empty-icon output-pulse">⬡</span>
            <p>Running…</p>
          </div>
        )}

        {/* HTML preview */}
        {output === "__HTML__" && !running && (
          <iframe
            className="output-html-frame"
            sandbox="allow-scripts allow-same-origin"
            srcDoc={code}
            title="HTML preview"
          />
        )}

        {/* Text output */}
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

        {/* Error */}
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

// ─── Room Info Modal (for owners) ─────────────────────────────────────────────
function RoomInfoModal({ room, isOwner, roomMeta, onClose }) {
  const [copied, setCopied] = useState(false);
  const inviteUrl = `${window.location.origin}?room=${encodeURIComponent(room)}`;

  const copy = () => {
    navigator.clipboard.writeText(inviteUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">Room Info</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
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
          {isOwner && roomMeta?.isPrivate && roomMeta?.password && (
            <div className="modal-row">
              <span className="modal-label">Password</span>
              <span className="modal-value modal-mono">{roomMeta.password}</span>
            </div>
          )}

          <div className="modal-divider" />

          <div className="modal-label" style={{marginBottom:8}}>Invite link</div>
          <div className="modal-invite-row">
            <span className="modal-invite-url">{inviteUrl}</span>
            <button className="modal-copy-btn" onClick={copy}>
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>

          {!isOwner && (
            <p className="modal-hint">Only the room owner can change settings.</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Editor App ───────────────────────────────────────────────────────────────
function EditorApp({ userName, room, isOwner: initialIsOwner }) {
  const userColor = useMemo(() => colorForUser(userName), [userName]);

  const ydoc   = useMemo(() => new Y.Doc(), []);
  const yFiles = useMemo(() => ydoc.getMap("files"),  [ydoc]);
  const yMeta  = useMemo(() => ydoc.getMap("meta"),   [ydoc]);

  const providerRef    = useRef(null);
  const editorRef      = useRef(null);
  const monacoRef      = useRef(null);
  const bindingRef     = useRef(null);
  const decorationsRef = useRef([]);

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

  // Drag handle for resizing output panel
  const dragRef = useRef(null);

  const startDrag = (e) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = outputPanelH;
    const onMove = (ev) => {
      const delta = startY - ev.clientY;
      setOutputPanelH(Math.max(120, Math.min(600, startH + delta)));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup",   onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup",   onUp);
  };

  // Fetch room meta (owner, privacy)
  useEffect(() => {
    fetch(`${SERVER_URL}/rooms/${encodeURIComponent(room)}/meta`)
      .then(r => r.json())
      .then(d => {
        setRoomMeta(d);
        setIsOwner(d.owner === userName);
      })
      .catch(() => {});
  }, [room, userName]);

  // Sync tabs
  const syncTabs = useCallback(() => {
    const order  = yMeta.get("tabOrder") || Array.from(yFiles.keys());
    const synced = order.filter(id => yFiles.has(id)).map(id => ({ id, ...yFiles.get(id) }));
    if (synced.length > 0) setTabs(synced);
  }, [yFiles, yMeta]);

  useEffect(() => {
    const provider = new SocketIOProvider(SERVER_URL, room, ydoc, { autoConnect: true });
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

    // Track current code for the output panel
    setCurrentCode(yText.toString());
    yText.observe(() => setCurrentCode(yText.toString()));

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
  }, []); // eslint-disable-line

  // Live cursor decorations (unchanged)
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
            .cursor-line-${clientId} { border-left: 2px solid ${color}; margin-left: -1px; }
            .cursor-label-${clientId}::after {
              content: "${name}";
              background: ${color}; color: #000;
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
            const [s, e]    = head > state.selection.anchor ? [anchorPos, pos] : [pos, anchorPos];
            newDecs.push({
              range: new monaco.Range(s.lineNumber, s.column, e.lineNumber, e.column),
              options: { className: "remote-selection" },
            });
          }
        } catch (_) {}
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

  const langMeta = LANGUAGES.find(l => l.id === language);
  const canRun   = language !== "css" && language !== "json";

  return (
    <main className="editor-layout">

      {/* ── Sidebar ── */}
      <aside className="sidebar">
        <div className="sidebar-header">
          <span className="sidebar-logo">&lt;/&gt;</span>
          <span className="sidebar-brand">CodeTogether</span>
        </div>

        <div className="sidebar-section">
          <p className="sidebar-section-label">Room</p>
          <div className="room-pill" onClick={() => setShowRoomInfo(true)} style={{cursor:"pointer"}} title="Room info">
            <div className="room-pill-left">
              <span className="room-privacy-icon">{roomMeta?.isPrivate ? "🔒" : "🌐"}</span>
              <span className="room-name">{room}</span>
            </div>
            <span className={`conn-dot ${connected ? "conn-dot--live" : "conn-dot--off"}`} />
          </div>
          {isOwner && (
            <div className="owner-badge">👑 You own this room</div>
          )}
        </div>

        <div className="sidebar-section">
          <p className="sidebar-section-label">Language</p>
          <select className="lang-select" value={language} onChange={changeLang}>
            {LANGUAGES.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
          </select>
        </div>

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
                const isRoomOwner = roomMeta?.owner === u.username;
                return (
                  <li key={u.username} className="user-item">
                    <div className="user-avatar" style={{ background: c + "22", color: c }}>
                      {initials(u.username)}
                    </div>
                    <span className="user-name">
                      {u.username}
                      {isMe        && <span className="user-you"> (you)</span>}
                      {isRoomOwner && <span className="user-owner-crown" title="Room owner"> 👑</span>}
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
          <div className="sidebar-section sidebar-section--grow sidebar-section--no-pad">
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
        {/* Tabs + Run button row */}
        <div className="editor-topbar">
          <FileTabs
            tabs={tabs} activeTab={activeTab} language={language}
            onSelect={selectTab} onCreate={createTab}
            onRename={renameTab} onDelete={deleteTab}
          />
          {canRun && (
            <button
              className={`topbar-run-btn${showOutput ? " topbar-run-btn--active" : ""}`}
              onClick={() => setShowOutput(v => !v)}
              title={showOutput ? "Hide output panel" : "Show output panel"}
            >
              <span className="run-icon">▶</span>
              {showOutput ? "Hide Output" : "Run"}
            </button>
          )}
        </div>

        {/* Editor + resizable output panel */}
        <div className="editor-and-output">
          <div className="editor-wrap" style={{ flex: 1, minHeight: 0 }}>
            <Editor
              height="100%"
              language={language}
              defaultValue="// Start coding..."
              theme="vs-dark"
              onMount={handleMount}
              options={{
                fontSize: 14,
                fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                minimap: { enabled: true },
                lineNumbers: "on",
                wordWrap: "on",
                tabSize: 2,
                scrollBeyondLastLine: false,
                smoothScrolling: true,
                cursorBlinking: "phase",
                bracketPairColorization: { enabled: true },
                padding: { top: 8 },
              }}
            />
          </div>

          {showOutput && (
            <>
              {/* Drag handle */}
              <div className="output-drag-handle" onMouseDown={startDrag} ref={dragRef} />
              <div style={{ height: outputPanelH, flexShrink: 0 }}>
                <OutputPanel
                  code={currentCode}
                  language={language}
                  onClose={() => setShowOutput(false)}
                />
              </div>
            </>
          )}
        </div>
      </section>

      {/* Room info modal */}
      {showRoomInfo && (
        <RoomInfoModal
          room={room}
          isOwner={isOwner}
          roomMeta={roomMeta}
          onClose={() => setShowRoomInfo(false)}
        />
      )}
    </main>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────
function App() {
  const [session, setSession] = useState(() => {
    const p    = new URLSearchParams(window.location.search);
    const user = p.get("username") || "";
    const room = p.get("room")     || "";
    return user && room ? { user, room, isOwner: false } : null;
  });

  const handleJoin = (user, room, isOwner) => {
    window.history.pushState({}, "",
      `?username=${encodeURIComponent(user)}&room=${encodeURIComponent(room)}`);
    setSession({ user, room, isOwner });
  };

  return session
    ? <EditorApp userName={session.user} room={session.room} isOwner={session.isOwner} />
    : <JoinScreen onJoin={handleJoin} />;
}

export default App;