const socket = io();

socket.emit("join", "admin");

socket.on("users", users => {
  document.getElementById("users").innerHTML =
    JSON.stringify(users, null, 2);
});

function logout() {
  localStorage.clear();
  location.href = "index.html";
}
