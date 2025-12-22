function login() {
  const user = username.value;
  const pass = password.value;

  if (!user) return alert("Enter username");

  if (user === "admin" && pass === "admin123") {
    localStorage.setItem("role", "admin");
    window.location.href = "admin.html";
  } else {
    localStorage.setItem("user", user);
    window.location.href = "lobby.html";
  }
}
