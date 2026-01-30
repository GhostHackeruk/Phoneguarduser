// /js/auth.js
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updateProfile
} from "https://www.gstatic.com/firebasejs/12.8.0/firebase-auth.js";

import { doc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.8.0/firebase-firestore.js";
import { auth, db } from "./firebase.js";

export async function registerUser(name, email, pass) {
  const cred = await createUserWithEmailAndPassword(auth, email, pass);
  await updateProfile(cred.user, { displayName: name });

  // Create Firestore user doc
  await setDoc(doc(db, "users", cred.user.uid), {
    name: name,
    email: email,
    balance: 0,
    status: "active",
    role: "user",
    createdAt: serverTimestamp()
  }, { merge: true });

  return cred.user;
}

export async function loginUser(email, pass) {
  const cred = await signInWithEmailAndPassword(auth, email, pass);
  return cred.user;
}
