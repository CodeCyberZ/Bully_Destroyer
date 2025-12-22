const socket = io();
const user = localStorage.getItem("user");

socket.emit("join", user);

socket.on("users", users => {
  const list = document.getElementById("users");
  list.innerHTML = "";
  for (let u in users) {
    list.innerHTML += `<li>${u} - ${users[u].status}</li>`;
  }
});

function goChat() {
  window.location.href = "chat.html";
}

function logout() {
  localStorage.clear();
  location.href = "index.html";
}

function deleteAccount() {
  socket.emit("deleteAccount", user);
  localStorage.clear();
  location.href = "index.html";
}
