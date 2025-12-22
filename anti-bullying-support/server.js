const express = require("express");
const app = express();
const http = require("http").createServer(app);
const io = require("socket.io")(http);

app.use(express.static("public"));

let users = {}; // username: { status, socketId }

io.on("connection", socket => {

  socket.on("join", username => {
    if (users[username]) return;

    users[username] = {
      status: "online",
      socketId: socket.id
    };

    io.emit("users", users);
  });

  socket.on("message", data => {
    io.emit("message", data);
  });

  socket.on("disconnect", () => {
    for (let u in users) {
      if (users[u].socketId === socket.id) {
        users[u].status = "offline";
      }
    }
    io.emit("users", users);
  });

  socket.on("deleteAccount", username => {
    delete users[username];
    io.emit("users", users);
  });

});

http.listen(process.env.PORT || 3000, () => {
  console.log("Server running");
});
