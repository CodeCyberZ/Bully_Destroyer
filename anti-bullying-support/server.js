// server.js
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const bodyParser = require('body-parser');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.json());

// In-memory stores (replace with a DB for production)
const STATE = {
  admin: { username: 'admin', password: 'admin123', online: false },
  users: new Map(),         // username -> { username, status, createdAt, mood }
  sessions: new Map(),      // sessionId -> { user, roomId, createdAt, closedAt }
  conversations: new Map(), // roomId -> [{ sender, text, ts, flags, reaction, seen }]
  presence: new Map(),      // socketId -> { username, role }
};

// Helpers
const uniqueRoomId = () => 'room_' + crypto.randomBytes(8).toString('hex');
const now = () => new Date().toISOString();
const statuses = { ONLINE: 'online', OFFLINE: 'offline', DEACTIVATED: 'deactivated' };

// Basic profanity filter (soft)
const banned = ['idiot','stupid','kill','hate','die'];
const softFilter = (text) => {
  const lowered = text.toLowerCase();
  const hit = banned.find(w => lowered.includes(w));
  return hit ? { flagged: true, word: hit } : { flagged: false };
};

// REST: Admin login
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body || {};
  if (username === STATE.admin.username && password === STATE.admin.password) {
    STATE.admin.online = true;
    return res.json({ ok: true, role: 'admin' });
  }
  return res.status(401).json({ ok: false, error: 'Invalid credentials' });
});

// REST: User signup/login (anonymous unique username)
app.post('/api/user/login', (req, res) => {
  const { username, mood } = req.body || {};
  if (!username || typeof username !== 'string') {
    return res.status(400).json({ ok: false, error: 'Username required' });
  }
  const existing = STATE.users.get(username);
  if (existing && existing.status !== statuses.DEACTIVATED) {
    return res.status(409).json({ ok: false, error: 'Username already in use' });
  }
  const profile = { username, status: statuses.ONLINE, createdAt: now(), mood: mood || null };
  STATE.users.set(username, profile);
  res.json({ ok: true, role: 'user', profile });
});

// REST: User logout (profile remains in lobby)
app.post('/api/user/logout', (req, res) => {
  const { username } = req.body || {};
  const u = STATE.users.get(username);
  if (!u) return res.status(404).json({ ok: false, error: 'User not found' });
  u.status = statuses.OFFLINE;
  return res.json({ ok: true });
});

// REST: User delete (deactivate)
app.post('/api/user/delete', (req, res) => {
  const { username } = req.body || {};
  const u = STATE.users.get(username);
  if (!u) return res.status(404).json({ ok: false, error: 'User not found' });
  u.status = statuses.DEACTIVATED;
  return res.json({ ok: true });
});

// REST: Lobby presence
app.get('/api/lobby', (req, res) => {
  const list = Array.from(STATE.users.values())
    .filter(u => u.status !== statuses.DEACTIVATED)
    .map(u => ({ username: u.username, status: u.status, mood: u.mood }));
  res.json({ ok: true, users: list, adminOnline: STATE.admin.online });
});

// REST: Config (contact info, quick replies)
app.get('/config.json', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'config.json'));
});

// Socket.IO
io.on('connection', (socket) => {
  // Register presence
  socket.on('presence', ({ username, role }) => {
    STATE.presence.set(socket.id, { username, role });
    io.emit('presence:update', {
      users: Array.from(STATE.users.values()),
      adminOnline: STATE.admin.online
    });
  });

  // Create or join chat room between user and admin
  socket.on('chat:start', ({ username }) => {
    let roomId = null;
    // Find existing session for user
    for (const [sid, s] of STATE.sessions.entries()) {
      if (s.user === username && !s.closedAt) {
        roomId = s.roomId;
        break;
      }
    }
    if (!roomId) {
      roomId = uniqueRoomId();
      STATE.sessions.set(roomId, { user: username, roomId, createdAt: now(), closedAt: null });
      STATE.conversations.set(roomId, []);
    }
    socket.join(roomId);
    socket.emit('chat:joined', { roomId });
  });

  // Admin joins a room
  socket.on('admin:joinRoom', ({ roomId }) => {
    socket.join(roomId);
    socket.emit('chat:joined', { roomId });
  });

  // Typing indicator
  socket.on('chat:typing', ({ roomId, sender, typing }) => {
    socket.to(roomId).emit('chat:typing', { sender, typing });
  });

  // Send message
  socket.on('chat:message', ({ roomId, sender, text }) => {
    const { flagged, word } = softFilter(text || '');
    const msg = {
      sender,
      text,
      ts: now(),
      flags: flagged ? [{ type: 'profanity', word }] : [],
      reaction: null,
      seen: false
    };
    const conv = STATE.conversations.get(roomId);
    if (!conv) return;
    conv.push(msg);
    io.to(roomId).emit('chat:message', msg);
    if (flagged) {
      io.to(roomId).emit('chat:notice', { type: 'nudge', text: 'Let’s keep things respectful.' });
    }
  });

  // Message reaction
  socket.on('chat:react', ({ roomId, index, reaction }) => {
    const conv = STATE.conversations.get(roomId);
    if (!conv || conv[index] == null) return;
    conv[index].reaction = reaction;
    io.to(roomId).emit('chat:update', { index, message: conv[index] });
  });

  // Read receipts
  socket.on('chat:seen', ({ roomId, index }) => {
    const conv = STATE.conversations.get(roomId);
    if (!conv || conv[index] == null) return;
    conv[index].seen = true;
    io.to(roomId).emit('chat:update', { index, message: conv[index] });
  });

  // Report message
  socket.on('chat:report', ({ roomId, index, reason }) => {
    const conv = STATE.conversations.get(roomId);
    if (!conv || conv[index] == null) return;
    const msg = conv[index];
    msg.flags.push({ type: 'report', reason });
    io.to(roomId).emit('chat:notice', { type: 'report', text: 'Message reported. Admin will review.' });
  });

  // Quick replies (server echoes; clients can also render locally)
  socket.on('chat:quickReply', ({ roomId, sender, text }) => {
    const msg = { sender, text, ts: now(), flags: [], reaction: null, seen: false };
    const conv = STATE.conversations.get(roomId);
    if (!conv) return;
    conv.push(msg);
    io.to(roomId).emit('chat:message', msg);
  });

  // Export conversation
  socket.on('chat:export', ({ roomId }) => {
    const conv = STATE.conversations.get(roomId) || [];
    socket.emit('chat:export', { roomId, data: conv });
  });

  // Close session (admin)
  socket.on('admin:closeSession', ({ roomId }) => {
    const s = STATE.sessions.get(roomId);
    if (s && !s.closedAt) s.closedAt = now();
    socket.emit('admin:sessionClosed', { roomId });
  });

  socket.on('disconnect', () => {
    const p = STATE.presence.get(socket.id);
    if (p) {
      if (p.role === 'user') {
        const u = STATE.users.get(p.username);
        if (u && u.status !== statuses.DEACTIVATED) {
          u.status = statuses.OFFLINE;
        }
      }
      if (p.role === 'admin') {
        STATE.admin.online = false;
      }
      STATE.presence.delete(socket.id);
      io.emit('presence:update', {
        users: Array.from(STATE.users.values()),
        adminOnline: STATE.admin.online
      });
    }
  });
});

// Fallback to index for unknown routes (optional SPA behavior)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});