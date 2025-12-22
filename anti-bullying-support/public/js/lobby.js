import { loadConfig, renderContactInfo } from './client.js';

const socket = io();
const presenceList = document.getElementById('presenceList');
const enterChat = document.getElementById('enterChat');
const logoutBtn = document.getElementById('logout');
const deleteBtn = document.getElementById('deleteAccount');

let currentUser = localStorage.getItem('username');
let role = localStorage.getItem('role');

(async function init() {
  const config = await loadConfig();
  renderContactInfo(document.getElementById('contactInfo'), config);

  if (!currentUser && !role) {
    // Redirect to login if not identified
    // User can still browse lobby from index via link
  } else {
    socket.emit('presence', { username: currentUser, role: role || 'user' });
  }

  const refreshLobby = async () => {
    const res = await fetch('/api/lobby');
    const { users, adminOnline } = await res.json();
    presenceList.innerHTML = `
      <li><strong>Admin:</strong> ${adminOnline ? 'online' : 'offline'}</li>
      ${users.map(u => `<li>${u.username} — ${u.status}${u.mood ? ` (${u.mood})` : ''}</li>`).join('')}
    `;
  };

  await refreshLobby();
  socket.on('presence:update', refreshLobby);

  enterChat?.addEventListener('click', () => {
    if (!currentUser) return alert('Please login first.');
    socket.emit('chat:start', { username: currentUser });
    window.location.href = 'chat.html';
  });

  logoutBtn?.addEventListener('click', async () => {
    if (!currentUser) return;
    await fetch('/api/user/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: currentUser })
    });
    localStorage.removeItem('role');
    alert('Logged out. Your profile remains in lobby.');
  });

  deleteBtn?.addEventListener('click', async () => {
    if (!currentUser) return;
    const ok = confirm('Delete your account? This removes your lobby profile.');
    if (!ok) return;
    await fetch('/api/user/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: currentUser })
    });
    localStorage.removeItem('username');
    localStorage.removeItem('role');
    alert('Account deleted.');
    window.location.href = 'index.html';
  });
})();