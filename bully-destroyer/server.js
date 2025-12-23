const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve static files from 'public' folder
app.use(express.static(path.join(__dirname, 'public')));

// Store data in memory (RAM)
let users = {}; 
let adminSocketId = null;

io.on('connection', (socket) => {
    
    // --- USER EVENTS ---
    socket.on('user_join', (username) => {
        users[socket.id] = {
            id: socket.id,
            username: username,
            status: 'online',
            messages: [] // Store chat history
        };
        // Notify admin if online
        if (adminSocketId) {
            io.to(adminSocketId).emit('update_user_list', users);
        }
    });

    socket.on('user_message', (text) => {
        const user = users[socket.id];
        if (user) {
            const msgData = {
                sender: 'user',
                name: user.username,
                text: text,
                time: new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})
            };
            user.messages.push(msgData);
            
            // Send back to user (to show on their screen)
            socket.emit('receive_message', msgData);
            
            // Send to Admin
            if (adminSocketId) {
                io.to(adminSocketId).emit('admin_receive_message', { userId: socket.id, msg: msgData });
            }
        }
    });

    socket.on('delete_account', () => {
        delete users[socket.id];
        if (adminSocketId) io.to(adminSocketId).emit('update_user_list', users);
    });

    // --- ADMIN EVENTS ---
    socket.on('admin_join', (creds) => {
        if (creds.username === 'admin' && creds.password === 'admin123') {
            adminSocketId = socket.id;
            socket.emit('admin_login_success', users);
        } else {
            socket.emit('admin_login_fail');
        }
    });

    socket.on('admin_message', ({ targetId, text }) => {
        if (users[targetId]) {
            const msgData = {
                sender: 'admin',
                name: 'Admin',
                text: text,
                time: new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})
            };
            users[targetId].messages.push(msgData);

            // Send to the specific user
            io.to(targetId).emit('receive_message', msgData);
            
            // Send back to admin (to update their own UI)
            socket.emit('admin_receive_message', { userId: targetId, msg: msgData });
        }
    });

    // --- DISCONNECT ---
    socket.on('disconnect', () => {
        if (socket.id === adminSocketId) {
            adminSocketId = null;
        }
        if (users[socket.id]) {
            users[socket.id].status = 'offline';
            if (adminSocketId) io.to(adminSocketId).emit('update_user_list', users);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));