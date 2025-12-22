const socket = io();
const user = localStorage.getItem("user") || "admin";

socket.emit("join", user);

function send() {
  socket.emit("message", {
    sender: user,
    text: msg.value
  });
  msg.value = "";
}

socket.on("message", data => {
  chat.innerHTML += `<p><b>${data.sender}:</b> ${data.text}</p>`;
});

function quick(text) {
  socket.emit("message", { sender: user, text });
}

function back() {
  history.back();
}
