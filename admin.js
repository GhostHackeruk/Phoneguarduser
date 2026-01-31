import { auth, db } from "./firebase.js";

// Firebase v12.8.0 (match your firebase.js version)
import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/12.8.0/firebase-auth.js";

import {
  doc, getDoc, setDoc, updateDoc, addDoc,
  collection, getDocs, query, where, limit,
  increment, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.8.0/firebase-firestore.js";

/* ---------------- UI helpers ---------------- */
const $ = (id) => document.getElementById(id);
const authInfo = $("authInfo");
const cardPanel = $("cardPanel");
const who = $("who");
const panelMsg = $("panelMsg");

function setMsg(el, text, type = "") {
  el.classList.remove("ok", "bad");
  if (type) el.classList.add(type);
  el.textContent = text;
}
function moneyToNumber(v) {
  const n = Number(String(v).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : NaN;
}

/* ---------------- Admin check ---------------- */
async function isAdmin(uid) {
  const ref = doc(db, "admins", uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) return false;
  const d = snap.data();
  return d?.active === true && String(d?.role || "").toLowerCase() === "admin";
}

/* ---------------- Auth persistence (fix auto logout) ---------------- */
await setPersistence(auth, browserLocalPersistence);

/* ---------------- Buttons ---------------- */
$("btnLogin").addEventListener("click", async () => {
  try {
    const email = $("email").value.trim();
    const pass = $("pass").value;
    if (!email || !pass) return setMsg(authInfo, "Email/password দাও।", "bad");

    setMsg(authInfo, "Signing in...", "");
    await signInWithEmailAndPassword(auth, email, pass);
  } catch (e) {
    setMsg(authInfo, "Login error: " + (e?.message || e), "bad");
  }
});

$("btnLogout").addEventListener("click", async () => {
  try {
    await signOut(auth);
  } catch (e) {
    setMsg(authInfo, "Logout error: " + (e?.message || e), "bad");
  }
});

$("btnRefresh").addEventListener("click", () => {
  location.reload();
});

/* ---------------- Auth state ---------------- */
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    cardPanel.classList.add("hide");
    who.textContent = "Not signed in";
    setMsg(authInfo, "Not signed in.", "");
    return;
  }

  setMsg(authInfo, `Logged in: ${user.email} • UID: ${user.uid}\nChecking admin...`, "");
  try {
    const ok = await isAdmin(user.uid);
    if (!ok) {
      cardPanel.classList.add("hide");
      who.textContent = "Not admin";
      setMsg(authInfo, `Logged in: ${user.email} • UID: ${user.uid}\n❌ Not an admin (admins/${user.uid} missing বা role/active ভুল).`, "bad");
      return;
    }

    // Admin OK
    cardPanel.classList.remove("hide");
    who.textContent = `Admin: ${user.email} • UID: ${user.uid}`;
    setMsg(authInfo, `Logged in: ${user.email} • UID: ${user.uid}\n✅ Admin verified.`, "ok");
    setMsg(panelMsg, "Ready.", "ok");
  } catch (e) {
    cardPanel.classList.add("hide");
    setMsg(authInfo, "Admin check error: " + (e?.message || e), "bad");
  }
});

/* ---------------- Utility: find user by email OR uid ---------------- */
async function resolveUserDoc(userKey) {
  const key = userKey.trim();
  if (!key) throw new Error("User UID/Email দিন।");

  // If looks like email -> query users where email == key
  if (key.includes("@")) {
    const q = query(collection(db, "users"), where("email", "==", key), limit(1));
    const snap = await getDocs(q);
    if (snap.empty) throw new Error("User not found by email: " + key);
    const docSnap = snap.docs[0];
    return { uid: docSnap.id, ref: doc(db, "users", docSnap.id), data: docSnap.data() };
  }

  // else treat as uid (doc id)
  const ref = doc(db, "users", key);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("User doc not found: users/" + key);
  return { uid: key, ref, data: snap.data() };
}

/* ---------------- Balance actions ---------------- */
$("btnCheckBal").addEventListener("click", async () => {
  try {
    const userKey = $("userKey").value;
    const u = await resolveUserDoc(userKey);
    setMsg(panelMsg, `User: ${u.uid}\nBalance: ${Number(u.data?.balance || 0)}`, "ok");
  } catch (e) {
    setMsg(panelMsg, "Error: " + (e?.message || e), "bad");
  }
});

$("btnAddBal").addEventListener("click", async () => {
  try {
    const userKey = $("userKey").value;
    const amount = moneyToNumber($("amount").value);
    if (!Number.isFinite(amount)) throw new Error("Amount ভুল।");
    const u = await resolveUserDoc(userKey);

    await updateDoc(u.ref, {
      balance: increment(amount),
      updatedAt: serverTimestamp()
    });

    await addDoc(collection(db, "notifications"), {
      uid: u.uid,
      title: "Balance Updated",
      body: `Your balance increased by ${amount}.`,
      createdAt: serverTimestamp(),
      read: false,
      type: "balance"
    });

    setMsg(panelMsg, `✅ Added ${amount} to ${u.uid}`, "ok");
  } catch (e) {
    setMsg(panelMsg, "Error: " + (e?.message || e), "bad");
  }
});

$("btnSetBal").addEventListener("click", async () => {
  try {
    const userKey = $("userKey").value;
    const amount = moneyToNumber($("amount").value);
    if (!Number.isFinite(amount)) throw new Error("Amount ভুল।");
    const u = await resolveUserDoc(userKey);

    await updateDoc(u.ref, {
      balance: amount,
      updatedAt: serverTimestamp()
    });

    await addDoc(collection(db, "notifications"), {
      uid: u.uid,
      title: "Balance Updated",
      body: `Your balance set to ${amount}.`,
      createdAt: serverTimestamp(),
      read: false,
      type: "balance"
    });

    setMsg(panelMsg, `✅ Set balance ${amount} for ${u.uid}`, "ok");
  } catch (e) {
    setMsg(panelMsg, "Error: " + (e?.message || e), "bad");
  }
});

/* ---------------- Payment settings ---------------- */
$("btnLoadPay").addEventListener("click", async () => {
  try {
    const ref = doc(db, "settings", "payment");
    const snap = await getDoc(ref);
    const d = snap.exists() ? snap.data() : {};
    $("bkash").value = d?.bkash || "";
    $("nagad").value = d?.nagad || "";
    $("rocket").value = d?.rocket || "";
    setMsg(panelMsg, "Loaded payment numbers.", "ok");
  } catch (e) {
    setMsg(panelMsg, "Error: " + (e?.message || e), "bad");
  }
});

$("btnSavePay").addEventListener("click", async () => {
  try {
    const ref = doc(db, "settings", "payment");
    await setDoc(ref, {
      bkash: $("bkash").value.trim(),
      nagad: $("nagad").value.trim(),
      rocket: $("rocket").value.trim(),
      updatedAt: serverTimestamp()
    }, { merge: true });

    setMsg(panelMsg, "✅ Saved payment numbers.", "ok");
  } catch (e) {
    setMsg(panelMsg, "Error: " + (e?.message || e), "bad");
  }
});

/* ---------------- Notifications ---------------- */
$("btnSendNotif").addEventListener("click", async () => {
  try {
    const toUid = $("notifTo").value.trim(); // empty => broadcast
    const title = $("notifTitle").value.trim() || "Notification";
    const body = $("notifBody").value.trim() || "";
    if (!body) throw new Error("Message লিখো।");

    await addDoc(collection(db, "notifications"), {
      uid: toUid || null,
      broadcast: !toUid,
      title,
      body,
      createdAt: serverTimestamp(),
      read: false,
      type: "manual"
    });

    $("notifBody").value = "";
    setMsg(panelMsg, "✅ Notification sent.", "ok");
  } catch (e) {
    setMsg(panelMsg, "Error: " + (e?.message || e), "bad");
  }
});

/* ---------------- User list ---------------- */
$("btnLoadUsers").addEventListener("click", async () => {
  try {
    const tbody = $("usersTbody");
    tbody.innerHTML = `<tr><td colspan="3" class="small">Loading...</td></tr>`;

    // no orderBy to avoid composite indexes
    const qUsers = query(collection(db, "users"), limit(50));
    const snap = await getDocs(qUsers);

    if (snap.empty) {
      tbody.innerHTML = `<tr><td colspan="3" class="small">No users found.</td></tr>`;
      return;
    }

    tbody.innerHTML = "";
    snap.forEach((d) => {
      const u = d.data() || {};
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${d.id}</td>
        <td>${u.email || "-"}</td>
        <td>${Number(u.balance || 0)}</td>
      `;
      tbody.appendChild(tr);
    });

    setMsg(panelMsg, "✅ Users loaded.", "ok");
  } catch (e) {
    setMsg(panelMsg, "Error: " + (e?.message || e), "bad");
  }
});

/* ---------------- Pending deposit requests ---------------- */
/*
Expected depositRequests doc fields:
- uid (string) user uid
- amount (number)
- method (string) bkash/nagad/rocket
- txid (string)
- status (string) pending/approved/rejected
*/
$("btnLoadDeposits").addEventListener("click", async () => {
  try {
    const tbody = $("depTbody");
    tbody.innerHTML = `<tr><td colspan="6" class="small">Loading...</td></tr>`;

    const qDep = query(collection(db, "depositRequests"), where("status", "==", "pending"), limit(50));
    const snap = await getDocs(qDep);

    if (snap.empty) {
      tbody.innerHTML = `<tr><td colspan="6" class="small">No pending deposits.</td></tr>`;
      return;
    }

    tbody.innerHTML = "";
    snap.forEach((d) => {
      const r = d.data() || {};
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${d.id}</td>
        <td>${r.uid || "-"}</td>
        <td>${Number(r.amount || 0)}</td>
        <td>${r.method || "-"}</td>
        <td>${r.txid || "-"}</td>
        <td>
          <button data-id="${d.id}" data-uid="${r.uid || ""}" data-amt="${Number(r.amount || 0)}" class="primary">APPROVE</button>
          <button data-rej="${d.id}" class="danger" style="margin-top:6px">REJECT</button>
        </td>
      `;
      tbody.appendChild(tr);
    });

    // handlers
    tbody.querySelectorAll("button[data-id]").forEach((btn) => {
      btn.addEventListener("click", () => approveDeposit(btn.dataset.id, btn.dataset.uid, Number(btn.dataset.amt)));
    });
    tbody.querySelectorAll("button[data-rej]").forEach((btn) => {
      btn.addEventListener("click", () => rejectRequest("depositRequests", btn.dataset.rej));
    });

    setMsg(panelMsg, "✅ Pending deposits loaded.", "ok");
  } catch (e) {
    setMsg(panelMsg, "Error: " + (e?.message || e), "bad");
  }
});

async function approveDeposit(reqId, uid, amount) {
  try {
    if (!reqId || !uid) throw new Error("Request data missing.");
    if (!Number.isFinite(amount)) throw new Error("Amount invalid.");

    // update request
    await updateDoc(doc(db, "depositRequests", reqId), {
      status: "approved",
      approvedAt: serverTimestamp(),
      approvedBy: auth.currentUser?.uid || null
    });

    // add to user balance
    await updateDoc(doc(db, "users", uid), {
      balance: increment(amount),
      updatedAt: serverTimestamp()
    });

    // notify user
    await addDoc(collection(db, "notifications"), {
      uid,
      title: "Deposit Approved",
      body: `Your deposit of ${amount} has been approved.`,
      createdAt: serverTimestamp(),
      read: false,
      type: "deposit"
    });

    setMsg(panelMsg, `✅ Deposit approved: ${reqId} (+${amount} to ${uid})`, "ok");
  } catch (e) {
    setMsg(panelMsg, "Error: " + (e?.message || e), "bad");
  }
}

/* ---------------- Pending purchase requests ---------------- */
/*
Expected purchaseRequests doc fields:
- uid (string) user uid
- service (string)
- cost (number)
- phone (string)
- status (string) pending/approved/rejected
*/
$("btnLoadPurchases").addEventListener("click", async () => {
  try {
    const tbody = $("purTbody");
    tbody.innerHTML = `<tr><td colspan="6" class="small">Loading...</td></tr>`;

    const qPur = query(collection(db, "purchaseRequests"), where("status", "==", "pending"), limit(50));
    const snap = await getDocs(qPur);

    if (snap.empty) {
      tbody.innerHTML = `<tr><td colspan="6" class="small">No pending purchases.</td></tr>`;
      return;
    }

    tbody.innerHTML = "";
    snap.forEach((d) => {
      const r = d.data() || {};
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${d.id}</td>
        <td>${r.uid || "-"}</td>
        <td>${r.service || "-"}</td>
        <td>${Number(r.cost || 0)}</td>
        <td>${r.phone || "-"}</td>
        <td>
          <button data-id="${d.id}" data-uid="${r.uid || ""}" class="primary">APPROVE</button>
          <button data-rej="${d.id}" class="danger" style="margin-top:6px">REJECT</button>
        </td>
      `;
      tbody.appendChild(tr);
    });

    tbody.querySelectorAll("button[data-id]").forEach((btn) => {
      btn.addEventListener("click", () => approvePurchase(btn.dataset.id, btn.dataset.uid));
    });
    tbody.querySelectorAll("button[data-rej]").forEach((btn) => {
      btn.addEventListener("click", () => rejectRequest("purchaseRequests", btn.dataset.rej));
    });

    setMsg(panelMsg, "✅ Pending purchases loaded.", "ok");
  } catch (e) {
    setMsg(panelMsg, "Error: " + (e?.message || e), "bad");
  }
});

async function approvePurchase(reqId, uid) {
  try {
    if (!reqId || !uid) throw new Error("Request data missing.");

    await updateDoc(doc(db, "purchaseRequests", reqId), {
      status: "approved",
      approvedAt: serverTimestamp(),
      approvedBy: auth.currentUser?.uid || null
    });

    // optional: mark user entitlement flag (you can change this)
    await setDoc(doc(db, "users", uid), {
      lastPurchaseApprovedAt: serverTimestamp()
    }, { merge: true });

    await addDoc(collection(db, "notifications"), {
      uid,
      title: "Purchase Approved",
      body: "Your purchase request has been approved. You can proceed.",
      createdAt: serverTimestamp(),
      read: false,
      type: "purchase"
    });

    setMsg(panelMsg, `✅ Purchase approved: ${reqId} (${uid})`, "ok");
  } catch (e) {
    setMsg(panelMsg, "Error: " + (e?.message || e), "bad");
  }
}

/* ---------------- Reject (common) ---------------- */
async function rejectRequest(colName, reqId) {
  try {
    await updateDoc(doc(db, colName, reqId), {
      status: "rejected",
      rejectedAt: serverTimestamp(),
      rejectedBy: auth.currentUser?.uid || null
    });
    setMsg(panelMsg, `❌ Rejected: ${colName}/${reqId}`, "ok");
  } catch (e) {
    setMsg(panelMsg, "Error: " + (e?.message || e), "bad");
  }
                                                                                                 }
