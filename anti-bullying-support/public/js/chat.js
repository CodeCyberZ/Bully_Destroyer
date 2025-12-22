import { loadConfig, renderContactInfo, renderChips } from './client.js';

const socket = io();
const messages = document.getElementById('messages');
const input = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const typing = document.getElementById('typing');
const quickReplies = document.getElementById('quickReplies');
const exportBtn = document.getElementById('exportChat');

let username = localStorage.getItem('username') || 'guest';
let role = localStorage.getItem('role') || 'user';
let roomId = null;

(async function init() {
  const config = await loadConfig();
  renderContactInfo(document.getElementById('contactInfo'), config);

  socket.emit('presence', { username, role });
  socket.emit('chat:start', { username });

  socket.on('chat:joined', ({ roomId: rid }) => { roomId = rid; });

  socket.on('chat:message', (msg) => {
    const li = document.createElement('li');
    li.className = msg.sender === username ? 'me' : 'other';
    li.innerHTML = `
      <div class="bubble">
        ${escapeHtml(msg.text)}
        <div class="meta">
          <span>${new Date(msg.ts).toLocaleTimeString()}</span>
          ${msg.flags?.length ? `<span class="flag">⚑</span>` : ''}
          ${msg.seen ? `<span class="seen">Seen</span>` : ''}
        </div>
        <div class="actions">
          <button class="react" data-index="${findMsgIndex(msg)}">Support</button>
          <button class="report" data-index="${findMsgIndex(msg)}">Report</button>
        </div>
      </div>
    `;
    messages.appendChild(li);
    messages.scrollTop = messages.scrollHeight;
  });

  socket.on('chat:typing', ({ sender, typing: isTyping }) => {
    typing.textContent = isTyping ? `${sender} is typing…` : '';
  });

  socket.on('chat:update', ({ index, message }) => {
    // In a real app, map indexes to DOM elements robustly
  });

  socket.on('chat:notice', ({ type, text }) => {
    const li = document.createElement('li');
    li.className = 'notice';
    li.textContent = text;
    messages.appendChild(li);
  });

  input.addEventListener('input', () => {
    socket.emit('chat:typing', { roomId, sender: username, typing: !!input.value });
  });

  sendBtn.addEventListener('click', send);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') send(); });

  function send() {
    const text = input.value.trim();
    if (!text) return;
    socket.emit('chat:message', { roomId, sender: username, text });
    input.value = '';
    socket.emit('chat:typing', { roomId, sender: username, typing: false });
  }

  renderChips(quickReplies, config.quickReplies || [
    'I’m here to listen.',
    'That sounds really tough.',
    'You don’t deserve to be treated that way.',
    'Would you like to talk through options?'
  ], (text) => {
    socket.emit('chat:quickReply', { roomId, sender: username, text });
  });

  exportBtn.addEventListener('click', () => {
    socket.emit('chat:export', { roomId });
  });

  socket.on('chat:export', ({ data }) => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.download = `chat-${roomId}.json`;
    a.href = url;
    a.click();
    URL.revokeObjectURL(url);
  });

  messages.addEventListener('click', (e) => {
    const target = e.target;
    if (target.classList.contains('react')) {
      const index = +target.dataset.index;
      socket.emit('chat:react', { roomId, index, reaction: 'support' });
    }
    if (target.classList.contains('report')) {
      const index = +target.dataset.index;
      const reason = prompt('Reason for report (optional)');
      socket.emit('chat:report', { roomId, index, reason });
    }
  });
})();

function escapeHtml(s) {
  const div = document.createElement('div');
  div.innerText = s;
  return div.innerHTML;
}

// Placeholder; in production, track indexes properly
function findMsgIndex(_msg) { return 0; }