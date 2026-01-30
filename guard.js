// /js/guard.js
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.8.0/firebase-auth.js";
import { auth } from "./firebase.js";

export function requireAuth(redirectTo = "login.html") {
  onAuthStateChanged(auth, (user) => {
    if (!user) window.location.href = redirectTo;
  });
}

export function redirectIfLoggedIn(to = "home.html") {
  onAuthStateChanged(auth, (user) => {
    if (user) window.location.href = to;
  });
}
