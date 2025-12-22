import { loadConfig, renderContactInfo, renderChips } from './client.js';

const socket = io();
const sessionList = document.getElementById('sessionList');
const adminMessages = document.getElementById('adminMessages');
const adminInput = document.getElementById('adminInput');
const adminSend = document.getElementById('adminSend');
const closeSession = document.getElementById('closeSession');
const adminQuickReplies = document.getElementById('adminQuickReplies');

let role = 'admin';
let currentRoomId = null;

(async function init() {
  const config = await loadConfig();
  renderContactInfo(document.getElementById('contactInfo'), config);

  // Ensure admin is considered logged in (use login API on index)
  localStorage.setItem('role', 'admin');
  socket.emit('presence', { username: 'admin', role });

  // Render quick replies
  renderChips(adminQuickReplies, config.adminQuickReplies || [
    'Thank you for sharing.',
    'Let’s focus on what’s within your control.',
    'You are not alone in this.',
    'Would you like strategies for next time?'
  ], (text) => send(text));

  // Load sessions from presence (simple view)
  socket.on('presence:update', ({ users }) => {
    const sessions = [];
    for (const [roomId, s] of window.sessionsMock || []) {
      sessions.push({ roomId, user: s.user });
    }
    // Minimal placeholder: show online users to join their session
    sessionList.innerHTML = users
      .filter(u => u.status === 'online')
      .map(u => `
        <li>
          ${u.username}
          <button class="btn" data-user="${u.username}">Join</button>
        </li>`).join('');
  });

  sessionList.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-user]');
    if (!btn) return;
    const user = btn.dataset.user;
    // Ask server to start or join the user session
    socket.emit('chat:start', { username: user });
    socket.once('chat:joined', ({ roomId }) => {
      currentRoomId = roomId;
      socket.emit('admin:joinRoom', { roomId });
    });
  });

  socket.on('chat:message', (msg) => {
    if (!currentRoomId) return;
    const li = document.createElement('li');
    li.className = msg.sender === 'admin' ? 'me' : 'other';
    li.innerHTML = `
      <div class="bubble">
        ${escapeHtml(msg.text)}
        <div class="meta">
          <span>${new Date(msg.ts).toLocaleTimeString()}</span>
          ${msg.flags?.length ? `<span class="flag">⚑</span>` : ''}
        </div>
      </div>
    `;
    adminMessages.appendChild(li);
    adminMessages.scrollTop = adminMessages.scrollHeight;
  });

  adminSend.addEventListener('click', () => send(adminInput.value));
  adminInput.addEventListener('keydown', e => { if (e.key === 'Enter') send(adminInput.value); });

  function send(text) {
    text = (text || '').trim();
    if (!text || !currentRoomId) return;
    socket.emit('chat:message', { roomId: currentRoomId, sender: 'admin', text });
    adminInput.value = '';
  }

  closeSession.addEventListener('click', () => {
    if (!currentRoomId) return;
    socket.emit('admin:closeSession', { roomId: currentRoomId });
    alert('Session closed.');
    currentRoomId = null;
    adminMessages.innerHTML = '';
  });
})();

function escapeHtml(s) {
  const div = document.createElement('div');
  div.innerText = s;
  return div.innerHTML;
}