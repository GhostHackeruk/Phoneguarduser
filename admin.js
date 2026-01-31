import { auth, db } from "./firebase.js";

import {
  browserLocalPersistence,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

import {
  doc, getDoc, setDoc, updateDoc,
  collection, addDoc, getDocs, query, where, limit,
  increment, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// ---------- UI helpers ----------
const $ = (id) => document.getElementById(id);

function setStatus(el, text, type="") {
  el.classList.remove("err","ok");
  if (type) el.classList.add(type);
  el.textContent = text;
}

function safeNum(v){
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return n;
}

async function isAdmin(uid){
  const ref = doc(db, "admins", uid);
  const snap = await getDoc(ref);
  return snap.exists();
}

function requireAdminOrThrow(){
  if (!state.user) throw new Error("Not logged in.");
  if (!state.admin) throw new Error("Not an admin (admins/{uid} missing).");
}

const state = {
  user: null,
  admin: false
};

// ---------- Elements ----------
const authInfo = $("authInfo");
const authMsg  = $("authMsg");
const balMsg   = $("balMsg");
const payMsg   = $("payMsg");
const notifMsg = $("notifMsg");
const depMsg   = $("depMsg");
const purMsg   = $("purMsg");

// ---------- Auth: prevent auto logout ----------
async function initAuthPersistence(){
  try{
    await setPersistence(auth, browserLocalPersistence);
    setStatus(authMsg, "Auth persistence: local ✅", "ok");
  }catch(e){
    // still may work without persistence in some browsers
    setStatus(authMsg, "Auth persistence warning: "+(e?.message||e), "err");
  }
}

// ---------- Auth UI ----------
$("btnLogin").addEventListener("click", async ()=>{
  const email = $("email").value.trim();
  const pass  = $("pass").value;
  if (!email || !pass){
    setStatus(authMsg, "Email & password দিন।", "err"); return;
  }
  try{
    setStatus(authMsg, "Signing in…");
    await signInWithEmailAndPassword(auth, email, pass);
    setStatus(authMsg, "Signed in. Checking admin…", "ok");
  }catch(e){
    setStatus(authMsg, "Login error: " + (e?.message||e), "err");
  }
});

$("btnLogout").addEventListener("click", async ()=>{
  try{
    await signOut(auth);
    setStatus(authMsg, "Logged out.", "ok");
  }catch(e){
    setStatus(authMsg, "Logout error: " + (e?.message||e), "err");
  }
});

$("btnRefresh").addEventListener("click", ()=>{
  // reload data areas (only if admin)
  loadPayments().catch(()=>{});
  loadDeposits().catch(()=>{});
  loadPurchases().catch(()=>{});
});

// ---------- Listen auth state ----------
onAuthStateChanged(auth, async (user)=>{
  state.user = user || null;
  state.admin = false;

  if (!user){
    authInfo.textContent = "Status: logged out";
    setStatus(authMsg, "Please login.", "");
    return;
  }

  authInfo.textContent = `Logged in: ${user.email || "(no email)"} • UID: ${user.uid}`;

  try{
    const ok = await isAdmin(user.uid);
    state.admin = ok;
    if (!ok){
      setStatus(authMsg, "Not admin: Firestore admins/{UID} doc নেই।", "err");
      return;
    }
    setStatus(authMsg, "Admin verified ✅ You can use the panel.", "ok");

    // load default
    await loadPayments();
    await loadDeposits();
    await loadPurchases();
  }catch(e){
    setStatus(authMsg, "Admin check error: " + (e?.message||e), "err");
  }
});

// ---------- Balance actions ----------
$("btnBalCheck").addEventListener("click", async ()=>{
  try{
    requireAdminOrThrow();
    const uid = $("userUid").value.trim();
    if (!uid) throw new Error("User UID দিন।");

    const ref = doc(db, "users", uid);
    const snap = await getDoc(ref);
    if (!snap.exists()){
      setStatus(balMsg, `User doc not found: users/${uid}`, "err");
      return;
    }
    const data = snap.data();
    setStatus(balMsg, `Balance: ${data.balance ?? 0}\nusers/${uid}`, "ok");
  }catch(e){
    setStatus(balMsg, "Error: " + (e?.message||e), "err");
  }
});

$("btnBalAdd").addEventListener("click", async ()=>{
  try{
    requireAdminOrThrow();
    const uid = $("userUid").value.trim();
    const amt = safeNum($("amount").value);
    if (!uid) throw new Error("User UID দিন।");
    if (amt === null) throw new Error("Amount সঠিক দিন (number)।");

    const ref = doc(db, "users", uid);
    const snap = await getDoc(ref);
    if (!snap.exists()){
      // create user doc if missing
      await setDoc(ref, { balance: 0, updatedAt: serverTimestamp() }, { merge:true });
    }
    await updateDoc(ref, { balance: increment(amt), updatedAt: serverTimestamp() });
    setStatus(balMsg, `Added ${amt}. Updated users/${uid}.balance ✅`, "ok");
  }catch(e){
    setStatus(balMsg, "Error: " + (e?.message||e), "err");
  }
});

$("btnBalSet").addEventListener("click", async ()=>{
  try{
    requireAdminOrThrow();
    const uid = $("userUid").value.trim();
    const amt = safeNum($("amount").value);
    if (!uid) throw new Error("User UID দিন।");
    if (amt === null) throw new Error("Amount সঠিক দিন (number)।");

    const ref = doc(db, "users", uid);
    await setDoc(ref, { balance: amt, updatedAt: serverTimestamp() }, { merge:true });
    setStatus(balMsg, `Set balance = ${amt}. users/${uid} ✅`, "ok");
  }catch(e){
    setStatus(balMsg, "Error: " + (e?.message||e), "err");
  }
});

// ---------- Payments (settings/payment) ----------
$("btnPayLoad").addEventListener("click", ()=> loadPayments());
$("btnPaySave").addEventListener("click", ()=> savePayments());

async function loadPayments(){
  try{
    requireAdminOrThrow();
    const ref = doc(db, "settings", "payment");
    const snap = await getDoc(ref);
    if (snap.exists()){
      const d = snap.data();
      $("bkash").value = d.bkash || "";
      $("nagad").value = d.nagad || "";
      $("rocket").value = d.rocket || "";
      setStatus(payMsg, "Loaded settings/payment ✅", "ok");
    }else{
      setStatus(payMsg, "No doc found. You can Save to create settings/payment.", "");
    }
  }catch(e){
    setStatus(payMsg, "Error: " + (e?.message||e), "err");
  }
}

async function savePayments(){
  try{
    requireAdminOrThrow();
    const data = {
      bkash: $("bkash").value.trim(),
      nagad: $("nagad").value.trim(),
      rocket: $("rocket").value.trim(),
      updatedAt: serverTimestamp()
    };
    await setDoc(doc(db, "settings", "payment"), data, { merge:true });
    setStatus(payMsg, "Saved settings/payment ✅", "ok");
  }catch(e){
    setStatus(payMsg, "Error: " + (e?.message||e), "err");
  }
}

// ---------- Notifications ----------
$("btnSendNotif").addEventListener("click", async ()=>{
  try{
    requireAdminOrThrow();
    const title = $("nTitle").value.trim();
    const body  = $("nBody").value.trim();
    if (!title || !body) throw new Error("Title + Message দিন।");

    await addDoc(collection(db, "notifications"), {
      title, body,
      createdAt: serverTimestamp(),
      read: false
    });

    setStatus(notifMsg, "Sent ✅ (notifications auto ID)", "ok");
    $("nTitle").value = "";
    $("nBody").value = "";
  }catch(e){
    setStatus(notifMsg, "Error: " + (e?.message||e), "err");
  }
});

// ---------- Deposit approvals ----------
$("btnLoadDeposits").addEventListener("click", ()=> loadDeposits());

async function loadDeposits(){
  try{
    requireAdminOrThrow();
    setStatus(depMsg, "Loading pending deposits…");
    const q = query(collection(db, "depositRequests"), where("status","==","pending"), limit(50));
    const snaps = await getDocs(q);

    const rows = $("depRows");
    rows.innerHTML = "";

    if (snaps.empty){
      rows.innerHTML = `<tr><td colspan="6" style="color:rgba(131,205,187,.65)">No pending deposits.</td></tr>`;
      setStatus(depMsg, "Loaded. 0 pending.", "ok");
      return;
    }

    snaps.forEach(s=>{
      const d = s.data();
      const reqId = s.id;
      const userUid = d.userUid || d.uid || "";
      const amount = d.amount ?? "";
      const method = d.method ?? "";
      const txid   = d.txid ?? d.txId ?? "";

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><span class="tag">${reqId}</span></td>
        <td>${userUid}</td>
        <td>${amount}</td>
        <td>${method}</td>
        <td>${txid}</td>
        <td class="actions">
          <button class="btn small primary" data-act="approve" data-id="${reqId}">Approve</button>
          <button class="btn small danger" data-act="reject" data-id="${reqId}">Reject</button>
        </td>
      `;
      rows.appendChild(tr);
    });

    rows.querySelectorAll("button[data-act]").forEach(btn=>{
      btn.addEventListener("click", async ()=>{
        const act = btn.getAttribute("data-act");
        const id  = btn.getAttribute("data-id");
        if (act === "approve") await approveDeposit(id);
        if (act === "reject")  await rejectDeposit(id);
      });
    });

    setStatus(depMsg, `Loaded pending deposits: ${snaps.size}`, "ok");
  }catch(e){
    setStatus(depMsg, "Error: " + (e?.message||e), "err");
  }
}

async function approveDeposit(reqId){
  try{
    requireAdminOrThrow();
    const ref = doc(db, "depositRequests", reqId);
    const snap = await getDoc(ref);
    if (!snap.exists()) throw new Error("Request not found.");

    const d = snap.data();
    const userUid = d.userUid || d.uid;
    const amount = safeNum(d.amount);
    if (!userUid) throw new Error("userUid missing in request.");
    if (amount === null) throw new Error("amount invalid in request.");

    // ensure user exists
    const uref = doc(db, "users", userUid);
    const us = await getDoc(uref);
    if (!us.exists()) await setDoc(uref, { balance: 0, updatedAt: serverTimestamp() }, { merge:true });

    // add balance + mark approved
    await updateDoc(uref, { balance: increment(amount), updatedAt: serverTimestamp() });
    await updateDoc(ref, { status:"approved", approvedAt: serverTimestamp(), approvedBy: state.user.uid });

    setStatus(depMsg, `Approved ${reqId}. Added ${amount} to ${userUid} ✅`, "ok");
    await loadDeposits();
  }catch(e){
    setStatus(depMsg, "Approve error: " + (e?.message||e), "err");
  }
}

async function rejectDeposit(reqId){
  try{
    requireAdminOrThrow();
    await updateDoc(doc(db, "depositRequests", reqId), {
      status:"rejected",
      rejectedAt: serverTimestamp(),
      rejectedBy: state.user.uid
    });
    setStatus(depMsg, `Rejected ${reqId} ✅`, "ok");
    await loadDeposits();
  }catch(e){
    setStatus(depMsg, "Reject error: " + (e?.message||e), "err");
  }
}

// ---------- Purchase approvals ----------
$("btnLoadPurchases").addEventListener("click", ()=> loadPurchases());

async function loadPurchases(){
  try{
    requireAdminOrThrow();
    setStatus(purMsg, "Loading pending purchases…");
    const q = query(collection(db, "purchaseRequests"), where("status","==","pending"), limit(50));
    const snaps = await getDocs(q);

    const rows = $("purRows");
    rows.innerHTML = "";

    if (snaps.empty){
      rows.innerHTML = `<tr><td colspan="6" style="color:rgba(131,205,187,.65)">No pending purchases.</td></tr>`;
      setStatus(purMsg, "Loaded. 0 pending.", "ok");
      return;
    }

    snaps.forEach(s=>{
      const d = s.data();
      const reqId = s.id;
      const userUid = d.userUid || d.uid || "";
      const service = d.service || d.item || "";
      const cost = d.cost ?? d.amount ?? "";
      const phone = d.phone || d.number || "";

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><span class="tag">${reqId}</span></td>
        <td>${userUid}</td>
        <td>${service}</td>
        <td>${cost}</td>
        <td>${phone}</td>
        <td class="actions">
          <button class="btn small primary" data-act="approve" data-id="${reqId}">Approve</button>
          <button class="btn small danger" data-act="reject" data-id="${reqId}">Reject</button>
        </td>
      `;
      rows.appendChild(tr);
    });

    rows.querySelectorAll("button[data-act]").forEach(btn=>{
      btn.addEventListener("click", async ()=>{
        const act = btn.getAttribute("data-act");
        const id  = btn.getAttribute("data-id");
        if (act === "approve") await approvePurchase(id);
        if (act === "reject")  await rejectPurchase(id);
      });
    });

    setStatus(purMsg, `Loaded pending purchases: ${snaps.size}`, "ok");
  }catch(e){
    setStatus(purMsg, "Error: " + (e?.message||e), "err");
  }
}

async function approvePurchase(reqId){
  try{
    requireAdminOrThrow();
    const ref = doc(db, "purchaseRequests", reqId);
    const snap = await getDoc(ref);
    if (!snap.exists()) throw new Error("Request not found.");

    await updateDoc(ref, {
      status:"approved",
      approvedAt: serverTimestamp(),
      approvedBy: state.user.uid
    });

    setStatus(purMsg, `Approved purchase ${reqId} ✅`, "ok");
    await loadPurchases();
  }catch(e){
    setStatus(purMsg, "Approve error: " + (e?.message||e), "err");
  }
}

async function rejectPurchase(reqId){
  try{
    requireAdminOrThrow();
    await updateDoc(doc(db, "purchaseRequests", reqId), {
      status:"rejected",
      rejectedAt: serverTimestamp(),
      rejectedBy: state.user.uid
    });
    setStatus(purMsg, `Rejected purchase ${reqId} ✅`, "ok");
    await loadPurchases();
  }catch(e){
    setStatus(purMsg, "Reject error: " + (e?.message||e), "err");
  }
}

// ---------- boot ----------
initAuthPersistence();
