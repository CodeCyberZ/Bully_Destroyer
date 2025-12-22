// server.js
const express = require('express');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

/**
 * In-memory data stores (for demo)
 * For production, use a database (e.g., Postgres, MongoDB).
 */
const STATE = {
  admin: {
    username: 'admin',
    password: 'admin123',
    online: false,
    socketId: null,
  },
  users: new Map(), // username -> { username, status, socketId, mood, createdAt }
  conversations: new Map(), // username -> [{ from, to, text, ts, read }]
  deletedUsers: new Set(), // track deactivated accounts (for status display)
};

/**
 * Helpers
 */
function isUsernameAvailable(username) {
  if (username === STATE.admin.username) return false;
  if (STATE.users.has(username)) return false;
  if (STATE.deletedUsers.has(username)) return false;
  return true;
}

function setUserStatus(username, status) {
  const user = STATE.users.get(username);
  if (!user) return;
  user.status = status; // 'online' | 'offline' | 'deactivated'
}

function ensureConversation(username) {
  if (!STATE.conversations.has(username)) {
    STATE.conversations.set(username, []);
  }
  return STATE.conversations.get(username);
}

function addMessage({ from, to, text }) {
  const ts = Date.now();
  const entry = { from, to, text, ts, read: false };
  const convo = ensureConversation(from === STATE.admin.username ? to : from);
  convo.push(entry);
  return entry;
}

function markReadFor(username) {
  const convo = STATE.conversations.get(username);
  if (!convo) return;
  convo.forEach(m => { m.read = true; });
}

/**
 * REST endpoints (admin/user auth & status)
 */

// Admin login
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  if (
    username === STATE.admin.username &&
    password === STATE.admin.password
  ) {
    STATE.admin.online = true;
    return res.json({ ok: true, username: STATE.admin.username });
  }
  return res.status(401).json({ ok: false, error: 'Invalid credentials' });
});

// Admin logout
app.post('/api/admin/logout', (_req, res) => {
  STATE.admin.online = false;
  STATE.admin.socketId = null;
  return res.json({ ok: true });
});

// User signup/login (username only)
app.post('/api/user/login', (req, res) => {
  const { username } = req.body;
  const safeName = String(username || '').trim();

  if (!safeName) {
    return res.status(400).json({ ok: false, error: 'Username required' });
  }
  if (!isUsernameAvailable(safeName)) {
    return res.status(409).json({ ok: false, error: 'Username not available' });
  }

  const profile = {
    username: safeName,
    status: 'offline',
    socketId: null,
    mood: null,
    createdAt: Date.now(),
  };
  STATE.users.set(safeName, profile);
  return res.json({ ok: true, username: safeName });
});

// User logout (remains in lobby)
app.post('/api/user/logout', (req, res) => {
  const { username } = req.body;
  const user = STATE.users.get(username);
  if (!user) {
    return res.status(404).json({ ok: false, error: 'User not found' });
  }
  user.status = 'offline';
  user.socketId = null;
  return res.json({ ok: true });
});

// Delete account (deactivated, removed from lobby)
app.post('/api/user/delete', (req, res) => {
  const { username } = req.body;
  const user = STATE.users.get(username);
  if (!user) {
    return res.status(404).json({ ok: false, error: 'User not found' });
  }
  user.status = 'deactivated';
  STATE.deletedUsers.add(username);
  STATE.users.delete(username);
  STATE.conversations.delete(username);
  return res.json({ ok: true });
});

// Lobby: list users and statuses
app.get('/api/lobby', (_req, res) => {
  const list = Array.from(STATE.users.values()).map(u => ({
    username: u.username,
    status: u.status,
    mood: u.mood,
  }));
  return res.json({ ok: true, users: list, adminOnline: STATE.admin.online });
});

// Admin dashboard: summaries
app.get('/api/admin/dashboard', (_req, res) => {
  const summaries = Array.from(STATE.users.values()).map(u => {
    const convo = STATE.conversations.get(u.username) || [];
    const unread = convo.filter(m => m.to === STATE.admin.username && !m.read).length;
    return {
      username: u.username,
      status: u.status,
      mood: u.mood,
      messages: convo.length,
      unread,
      lastActivity: convo.length ? convo[convo.length - 1].ts : u.createdAt,
    };
  });
  return res.json({ ok: true, summaries });
});

// Get conversation (admin or user)
app.get('/api/convo/:username', (req, res) => {
  const { username } = req.params;
  const convo = STATE.conversations.get(username) || [];
  return res.json({ ok: true, messages: convo });
});

/**
 * Socket.IO (real-time chat)
 */
io.on('connection', (socket) => {
  // Identify role on connection
  socket.on('identify', ({ role, username }) => {
    if (role === 'admin' && username === STATE.admin.username) {
      STATE.admin.socketId = socket.id;
      STATE.admin.online = true;
      io.emit('presence', { adminOnline: true });
    } else if (role === 'user' && STATE.users.has(username)) {
      const user = STATE.users.get(username);
      user.socketId = socket.id;
      setUserStatus(username, 'online');
      io.emit('presence', {
        users: Array.from(STATE.users.values()).map(u => ({
          username: u.username,
          status: u.status,
          mood: u.mood,
        })),
        adminOnline: STATE.admin.online,
      });
    }
  });

  // Mood check-in from user
  socket.on('mood', ({ username, mood }) => {
    const user = STATE.users.get(username);
    if (user) {
      user.mood = mood;
      io.emit('moodUpdate', { username, mood });
    }
  });

  // Typing indicator
  socket.on('typing', ({ from, to, typing }) => {
    if (to === STATE.admin.username && STATE.admin.socketId) {
      io.to(STATE.admin.socketId).emit('typing', { from, typing });
    } else {
      const user = STATE.users.get(to);
      if (user?.socketId) io.to(user.socketId).emit('typing', { from, typing });
    }
  });

  // Send message
  socket.on('message', ({ from, to, text }) => {
    const msg = addMessage({ from, to, text });

    // deliver to recipient
    if (to === STATE.admin.username && STATE.admin.socketId) {
      io.to(STATE.admin.socketId).emit('message', msg);
    } else {
      const user = STATE.users.get(to);
      if (user?.socketId) io.to(user.socketId).emit('message', msg);
    }

    // echo to sender
    socket.emit('message', msg);
  });

  // Mark read
  socket.on('markRead', ({ username }) => {
    markReadFor(username);
  });

  // Disconnect handling
  socket.on('disconnect', () => {
    // If admin disconnected
    if (STATE.admin.socketId === socket.id) {
      STATE.admin.online = false;
      STATE.admin.socketId = null;
      io.emit('presence', { adminOnline: false });
    } else {
      // Possibly a user
      for (const [uname, user] of STATE.users.entries()) {
        if (user.socketId === socket.id) {
          user.socketId = null;
          setUserStatus(uname, 'offline');
          io.emit('presence', {
            users: Array.from(STATE.users.values()).map(u => ({
              username: u.username,
              status: u.status,
              mood: u.mood,
            })),
            adminOnline: STATE.admin.online,
          });
          break;
        }
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`BULLY DESTROYER server running on port ${PORT}`);
});