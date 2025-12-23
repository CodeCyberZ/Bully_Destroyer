// public/script.js
const socket = io();

// State
let currentUser = null;
let currentRole = null;
let currentChatTarget = null; // For admin to know who they are talking to

// --- Navigation & UI ---
function navigateTo(pageId) {
    document.querySelectorAll('section').forEach(s => s.classList.add('hidden-section'));
    document.querySelectorAll('section').forEach(s => s.classList.remove('active-section'));
    document.getElementById(pageId).classList.remove('hidden-section');
    document.getElementById(pageId).classList.add('active-section');
}

function switchTab(role) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    event.target.classList.add('active');
    if(role === 'user') {
        document.getElementById('user-form').style.display = 'block';
        document.getElementById('admin-form').style.display = 'none';
    } else {
        document.getElementById('user-form').style.display = 'none';
        document.getElementById('admin-form').style.display = 'block';
    }
}

// --- Dark Mode ---
const themeToggle = document.getElementById('theme-toggle');
themeToggle.addEventListener('click', () => {
    const isDark = document.body.getAttribute('data-theme') === 'dark';
    document.body.setAttribute('data-theme', isDark ? 'light' : 'dark');
    themeToggle.innerHTML = isDark ? '<i class="fas fa-moon"></i>' : '<i class="fas fa-sun"></i>';
});

// --- Auth Logic ---

// Check Local Storage for Quick Login
function loadSavedProfiles() {
    const saved = JSON.parse(localStorage.getItem('bullyDestroyerUsers')) || [];
    const container = document.getElementById('saved-profiles');
    container.innerHTML = '';
    saved.forEach(user => {
        const chip = document.createElement('div');
        chip.className = 'profile-chip';
        chip.innerHTML = `<span>${user}</span> <i class="fas fa-sign-in-alt"></i>`;
        chip.onclick = () => loginUser(user);
        container.appendChild(chip);
    });
}
loadSavedProfiles();

function userLogin() {
    const username = document.getElementById('username-input').value.trim();
    if(!username) return alert("Please enter a username");
    
    // Save to local storage
    let saved = JSON.parse(localStorage.getItem('bullyDestroyerUsers')) || [];
    if(!saved.includes(username)) {
        saved.push(username);
        localStorage.setItem('bullyDestroyerUsers', JSON.stringify(saved));
    }
    
    loginUser(username);
}

function loginUser(username) {
    currentUser = username;
    currentRole = 'user';
    socket.emit('login', { username, role: 'user' });
    navigateTo('chat-page');
    document.querySelector('.user-info h3').innerText = "Support Agent (Admin)";
}

function adminLogin() {
    const user = document.getElementById('admin-user').value;
    const pass = document.getElementById('admin-pass').value;
    
    if(user === 'admin' && pass === 'admin123') {
        currentUser = 'admin';
        currentRole = 'admin';
        socket.emit('login', { username: 'admin', role: 'admin' });
        navigateTo('admin-dashboard');
    } else {
        alert("Invalid Admin Credentials");
    }
}

function logout() {
    // Reload page to reset socket connection
    window.location.reload(); 
}

function deleteAccount() {
    if(confirm("Are you sure? This will delete your account info.")) {
        socket.emit('deleteAccount');
        
        // Remove from local storage
        let saved = JSON.parse(localStorage.getItem('bullyDestroyerUsers')) || [];
        saved = saved.filter(u => u !== currentUser);
        localStorage.setItem('bullyDestroyerUsers', JSON.stringify(saved));
        
        alert("Account Deactivated");
        window.location.reload();
    }
}

function toggleSettings() {
    document.getElementById('settings-modal').classList.toggle('hidden');
}

// --- Chat Logic ---

// Send Message
function sendMessage(role) {
    const inputId = role === 'user' ? 'user-message' : 'admin-message';
    const input = document.getElementById(inputId);
    const message = input.value.trim();
    
    if(!message) return;

    if (role === 'user') {
        // Render locally
        addMessageToUI('user-chat-window', 'You', message, 'sent');
        // Send to server
        socket.emit('chatMessage', { sender: currentUser, target: 'admin', message });
    } else {
        if(!currentChatTarget) return alert("Select a user first");
        addMessageToUI('admin-chat-window', 'Admin', message, 'sent');
        socket.emit('chatMessage', { sender: 'admin', target: currentChatTarget, message });
    }
    input.value = '';
}

function sendQuickReply(text) {
    const input = document.getElementById('user-message');
    input.value = text;
    sendMessage('user');
}

function sendAdminQuickReply(text) {
    const input = document.getElementById('admin-message');
    input.value = text;
    sendMessage('admin');
}

function addMessageToUI(windowId, sender, text, type, time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })) {
    const chatWindow = document.getElementById(windowId);
    const div = document.createElement('div');
    div.className = `message ${type}`;
    div.innerHTML = `<strong>${sender}</strong>: ${text} <span class="time">${time}</span>`;
    chatWindow.appendChild(div);
    chatWindow.scrollTop = chatWindow.scrollHeight;
}

// --- Socket Events ---

// Receive Message
socket.on('receiveMessage', (data) => {
    const { sender, message, time } = data;
    
    if (currentRole === 'user') {
        addMessageToUI('user-chat-window', 'Admin', message, 'received', time);
    } else if (currentRole === 'admin') {
        // Only show message if admin is currently looking at this user's chat
        if(currentChatTarget === sender) {
            addMessageToUI('admin-chat-window', sender, message, 'received', time);
        } else {
            // Visual cue that user sent a message (simple alert for now)
            // Ideally, highlight the user in the sidebar
            alert(`New message from ${sender}`);
        }
    }
});

// Admin: Update User List
socket.on('updateUserList', (activeUsers) => {
    if(currentRole !== 'admin') return;
    
    const list = document.getElementById('user-list');
    list.innerHTML = '';
    
    Object.values(activeUsers).forEach(u => {
        if(u.username === 'admin') return; // Don't show admin in list
        
        const li = document.createElement('li');
        li.className = 'user-item';
        if(currentChatTarget === u.username) li.classList.add('active');
        
        li.innerHTML = `
            <span>${u.username}</span> 
            <span class="status-dot ${u.status.toLowerCase()}"></span>
        `;
        li.onclick = () => loadAdminChat(u.username);
        list.appendChild(li);
    });
});

// Admin: Load Chat
function loadAdminChat(username) {
    currentChatTarget = username;
    document.getElementById('admin-chat-header').innerHTML = `<h3>Chatting with: ${username}</h3>`;
    document.getElementById('admin-input-area').style.display = 'block';
    document.getElementById('admin-chat-window').innerHTML = ''; // Clear previous chat
    
    // In a real app, you would fetch chat history from server here
    // For this prototype, the server sends history in 'updateUserList' but we are keeping it simple
}

// User Deactivation Notification
socket.on('userDeactivated', (username) => {
    if(currentRole === 'admin') {
        alert(`User ${username} has deactivated their account.`);
    }
});

// Typing Indicators
document.getElementById('user-message').addEventListener('keypress', () => {
    socket.emit('typing', { target: 'admin' });
});