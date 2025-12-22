// script.js
const socket = io();
let ROLE = null; // 'admin' | 'user'
let CURRENT_USER = null; // username for user, 'admin' for admin
let CHAT_WITH = null; // who the admin is chatting with, or 'admin' for user mode

/**
 * Routing helpers
 */
function showPage(id) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function setThemeToggle() {
  const btn = document.getElementById('themeToggle');
  const html = document.documentElement;
  const stored = localStorage.getItem('theme') || 'dark';
  html.setAttribute('data-theme', stored);
  btn.textContent = stored === 'dark' ? 'Light mode' : 'Dark mode';
  btn.onclick = () => {
    const current = html.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    html.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
    btn.textContent = next === 'dark' ? 'Light mode' : 'Dark mode';
  };
}

function formatTs(ts) {
  return new Date(ts).toLocaleString();
}

function renderStatus(status) {
  const map = {
    online: 'status-online',
    offline: 'status-offline',
    deactivated: 'status-deactivated'
  };
  return `<span class="status-pill ${map[status] || ''}">${status}</span>`;
}

/**
 * Login page setup
 */
function setupLogin() {
  const adminForm = document.getElementById('adminLoginForm');
  const userForm = document.getElementById('userLoginForm');

  adminForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('adminUsername').value.trim();
    const password = document.getElementById('adminPassword').value.trim();
    const res = await fetch('/api/admin/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    if (res.ok) {
      ROLE = 'admin';
      CURRENT_USER = 'admin';
      socket.emit('identify', { role: 'admin', username: 'admin' });
      loadAdminDashboard();
    } else {
      alert('Invalid admin credentials.');
    }
  });

  userForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('userUsername').value.trim();
    const res = await fetch('/api/user/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username })
    });
    const data = await res.json();
    if (data.ok) {
      ROLE = 'user';
      CURRENT_USER = data.username;
      socket.emit('identify', { role: 'user', username: CURRENT_USER });
      loadLobby();
    } else {
      alert(data.error || 'Unable to login.');
    }
  });
}

/**
 * Lobby page (user)
 */
async function loadLobby() {
  showPage('page-lobby');

  // Presence and list
  const res = await fetch('/api/lobby');
  const data = await res.json();
  const adminPresence = document.getElementById('adminPresence');
  adminPresence.textContent = `Admin: ${data.adminOnline ? 'online' : 'offline'}`;

  const list = document.getElementById('lobbyList');
  list.innerHTML = '';
  data.users.forEach(u => {
    const li = document.createElement('li');
    li.innerHTML = `
      <span>${u.username} ${u.mood ? `— ${u.mood}` : ''}</span>
      ${renderStatus(u.status)}
    `;
    list.appendChild(li);
  });

  document.getElementById('backToLogin').onclick = () => {
    ROLE = null; CURRENT_USER = null; CHAT_WITH = null;
    showPage('page-login');
  };

  document.getElementById('openSettings').onclick = () => {
    const dlg = document.getElementById('settingsDialog');
    document.getElementById('displayName').value = CURRENT_USER;
    dlg.showModal();
  };

  document.getElementById('logoutUser').onclick = async () => {
    await fetch('/api/user/logout', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: CURRENT_USER })
    });
    alert('Logged out. Your profile remains visible in the lobby.');
    showPage('page-login');
  };

  document.getElementById('openChatFromLobby').onclick = async () => {
    CHAT_WITH = 'admin';
    await loadChat();
  };

  // Mood check-in
  const moodSelect = document.getElementById('moodSelect');
  moodSelect.onchange = () => {
    const mood = moodSelect.value || null;
    socket.emit('mood', { username: CURRENT_USER, mood });
  };
}

/**
 * Admin dashboard
 */
async function loadAdminDashboard() {
  showPage('page-admin');

  document.getElementById('backToLoginAdmin').onclick = () => {
    showPage('page-login');
  };

  document.getElementById('logoutAdmin').onclick = async () => {
    await fetch('/api/admin/logout', { method: 'POST' });
    alert('Admin logged out.');
    showPage('page-login');
  };

  const res = await fetch('/api/admin/dashboard');
  const data = await res.json();

  const tbody = document.getElementById('adminTableBody');
  tbody.innerHTML = '';

  data.summaries
    .sort((a, b) => b.lastActivity - a.lastActivity)
    .forEach(row => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${row.username}</td>
        <td>${renderStatus(row.status)}</td>
        <td>${row.mood || '-'}</td>
        <td>${row.messages}</td>
        <td>${row.unread}</td>
        <td>${formatTs(row.lastActivity)}</td>
        <td><button class="openChatBtn" data-username="${row.username}">Open</button></td>
      `;
      tbody.appendChild(tr);
    });

  tbody.querySelectorAll('.openChatBtn').forEach(btn => {
    btn.onclick = async () => {
      CHAT_WITH = btn.dataset.username;
      await loadChat();
    };
  });

  // Tag buttons (just visual cues for now)
  document.querySelectorAll('.tag-btn').forEach(b => {
    b.onclick = () => alert(`Tag applied: ${b.dataset.tag}`);
  });
}

/**
 * Chat page
 */
async function loadChat() {
  showPage('page-chat');

  const title = document.getElementById('chatTitle');
  const messagesEl = document.getElementById('chatMessages');
  const inputEl = document.getElementById('chatInput');
  const sendBtn = document.getElementById('sendBtn');
  const typingEl = document.getElementById('typingIndicator');

  title.textContent =
    ROLE === 'admin'
      ? `Chat with ${CHAT_WITH}`
      : `Chat with admin`;

  // Load history
  const convoKey = ROLE === 'admin' ? CHAT_WITH : CURRENT_USER;
  const res = await fetch(`/api/convo/${convoKey}`);
  const data = await res.json();

  messagesEl.innerHTML = '';
  data.messages.forEach(m => appendMessage(m));

  // Mark as read
  socket.emit('markRead', { username: convoKey });

  // Quick replies
  const quick = document.getElementById('quickReplies');
  quick.innerHTML = '';
  const adminQuick = [
    'I’m here to listen.',
    'That sounds really tough.',
    'You’re not alone in this.',
    'Would you like some resources?',
    'We can take this step by step.'
  ];
  const userQuick = [
    'I feel overwhelmed.',
    'Someone keeps targeting me.',
    'I need advice.',
    'Can I share what happened?',
    'Thank you for listening.'
  ];
  const phrases = ROLE === 'admin' ? adminQuick : userQuick;
  phrases.forEach(p => {
    const btn = document.createElement('button');
    btn.className = 'quick-btn';
    btn.textContent = p;
    btn.onclick = () => sendMessage(p);
    quick.appendChild(btn);
  });

  // Typing indicator
  let typingTimeout = null;
  inputEl.addEventListener('input', () => {
    socket.emit('typing', { from: CURRENT_USER, to: CHAT_WITH, typing: true });
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
      socket.emit('typing', { from: CURRENT_USER, to: CHAT_WITH, typing: false });
    }, 800);
  });

  // Send
  sendBtn.onclick = () => {
    const text = inputEl.value.trim();
    if (!text) return;
    sendMessage(text);
    inputEl.value = '';
  };

  document.getElementById('backFromChat').onclick = () => {
    if (ROLE === 'admin') loadAdminDashboard();
    else loadLobby();
  };

  // Socket listeners (simple dedupe)
  socket.off('message');
  socket.on('message', (msg) => {
    // Display only messages belonging to this convo
    const peer = ROLE === 'admin' ? CHAT_WITH : 'admin';
    const mine = msg.from === CURRENT_USER && msg.to === peer;
    const theirs = msg.to === CURRENT_USER && msg.from === peer;
    if (mine || theirs) {
      appendMessage(msg);
    }
  });

  socket.off('typing');
  socket.on('typing', ({ from, typing }) => {
    const expectedPeer = ROLE === 'admin' ? CHAT_WITH : 'admin';
    if (from === expectedPeer) {
      typingEl.classList.toggle('show', typing);
    }
  });
}

function appendMessage(msg) {
  const messagesEl = document.getElementById('chatMessages');
  const div = document.createElement('div');
  const isMe = msg.from === CURRENT_USER;
  div.className = `msg ${isMe ? 'me' : 'other'}`;
  div.innerHTML = `
    <div>${escapeHtml(msg.text)}</div>
    <div class="msg-meta">${msg.from} • ${new Date(msg.ts).toLocaleTimeString()}</div>
  `;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function sendMessage(text) {
  const peer = ROLE === 'admin' ? CHAT_WITH : 'admin';
  socket.emit('message', { from: CURRENT_USER, to: peer, text });
}

/**
 * Presence updates
 */
socket.on('presence', (payload) => {
  // Update admin presence if on lobby
  const adminEl = document.getElementById('adminPresence');
  if (adminEl && typeof payload.adminOnline === 'boolean') {
    adminEl.textContent = `Admin: ${payload.adminOnline ? 'online' : 'offline'}`;
  }
  // Update lobby list
  if (payload.users) {
    const list = document.getElementById('lobbyList');
    if (!list) return;
    list.innerHTML = '';
    payload.users.forEach(u => {
      const li = document.createElement('li');
      li.innerHTML = `
        <span>${u.username} ${u.mood ? `— ${u.mood}` : ''}</span>
        ${renderStatus(u.status)}
      `;
      list.appendChild(li);
    });
  }
});

/**
 * Mood updates broadcast
 */
socket.on('moodUpdate', ({ username, mood }) => {
  // If on admin dashboard, reload summary for latest mood
  if (ROLE === 'admin' && document.getElementById('page-admin').classList.contains('active')) {
    loadAdminDashboard();
  }
});

/**
 * Settings modal logic
 */
function setupSettingsModal() {
  const dlg = document.getElementById('settingsDialog');
  const closeBtn = document.getElementById('closeSettings');
  const saveBtn = document.getElementById('saveSettings');
  const delBtn = document.getElementById('deleteAccount');

  closeBtn.onclick = () => dlg.close();

  saveBtn.onclick = (e) => {
    e.preventDefault();
    const name = document.getElementById('displayName').value.trim();
    if (!name) return;
    // rename only if available
    if (name === CURRENT_USER) return dlg.close();
    // basic client-side uniqueness check—server enforces too
    alert('Display name updates are limited in this demo. Please choose your username at login.');
    dlg.close();
  };

  delBtn.onclick = async (e) => {
    e.preventDefault();
    const confirmDelete = confirm('Delete account? This cannot be undone.');
    if (!confirmDelete) return;
    const res = await fetch('/api/user/delete', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: CURRENT_USER })
    });
    if (res.ok) {
      alert('Account deleted. You will be returned to login.');
      dlg.close();
      showPage('page-login');
    } else {
      alert('Unable to delete account.');
    }
  };
}

/**
 * Security helpers
 */
function escapeHtml(str) {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

/**
 * Boot
 */
window.addEventListener('DOMContentLoaded', () => {
  setThemeToggle();
  setupLogin();
  setupSettingsModal();

  // Restore theme session
  const theme = localStorage.getItem('theme') || 'dark';
  document.documentElement.setAttribute('data-theme', theme);
});