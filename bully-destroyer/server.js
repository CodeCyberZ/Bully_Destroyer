// server.js
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve static files from 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Store active users in memory (For a full production app, use a Database like MongoDB)
let activeUsers = {}; 

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    // Handle Login
    socket.on('login', (data) => {
        const { username, role } = data;
        
        socket.username = username;
        socket.role = role;
        socket.join(username); // Create a room for this user

        if (role === 'user') {
            activeUsers[username] = { 
                id: socket.id, 
                username: username, 
                status: 'Online',
                messages: [] // Store temporary chat history
            };
            // Notify Admin of new user
            io.to('admin').emit('updateUserList', activeUsers);
        } else if (role === 'admin') {
            socket.join('admin');
            // Send current user list to admin immediately
            socket.emit('updateUserList', activeUsers);
        }
        
        // Broadcast status
        io.emit('statusChange', { username, status: 'Online' });
    });

    // Handle Messages
    socket.on('chatMessage', (data) => {
        const { target, message, sender } = data;
        const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        // If User sends to Admin
        if (socket.role === 'user') {
            // Save to history
            if(activeUsers[sender]) {
                activeUsers[sender].messages.push({ sender: 'You', text: message, time: timestamp });
            }
            // Send to Admin
            io.to('admin').emit('receiveMessage', { sender, message, time: timestamp });
        } 
        // If Admin sends to User
        else if (socket.role === 'admin') {
             // Save to user's history in memory so they see it if they refresh (basic persistence)
             if(activeUsers[target]) {
                activeUsers[target].messages.push({ sender: 'Admin', text: message, time: timestamp });
             }
             // Send to specific User
             io.to(target).emit('receiveMessage', { sender: 'Admin', message, time: timestamp });
        }
    });

    // Handle Typing Status
    socket.on('typing', (data) => {
        if(socket.role === 'user') {
            io.to('admin').emit('displayTyping', { username: socket.username });
        } else {
            io.to(data.target).emit('displayTyping', { username: 'Admin' });
        }
    });

    // Handle Account Deletion
    socket.on('deleteAccount', () => {
        const user = socket.username;
        if(activeUsers[user]) {
            activeUsers[user].status = 'Deactivated';
            io.to('admin').emit('userDeactivated', user);
            delete activeUsers[user];
            io.to('admin').emit('updateUserList', activeUsers);
        }
    });

    // Handle Disconnect
    socket.on('disconnect', () => {
        if (socket.role === 'user' && activeUsers[socket.username]) {
            activeUsers[socket.username].status = 'Offline';
            io.to('admin').emit('updateUserList', activeUsers);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));