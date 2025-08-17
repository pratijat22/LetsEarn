import React, { useEffect, useMemo, useRef, useState } from "react";
import logoUrl from '../lets-earn-logo.svg';
import { auth, googleProvider, db } from './firebase';
import { onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import { upload } from '@vercel/blob/client';
import { doc, getDoc, setDoc, updateDoc, onSnapshot, serverTimestamp, collection, query, orderBy } from 'firebase/firestore';

// Minimal single-file React app for a course paywall landing page
// Design goals: simple, cheerful, entrepreneurial theme. Clean CTA.
// Tech notes:
// - Tailwind utility classes for styling (no imports needed in this canvas)
// - Cashfree Checkout support (requires backend to mint order token). See BACKEND NOTES below.
// - Email capture
// - Admin micro-console to set price, edit course, and upload ZIP (simulated in browser)
// - After payment success, calls a placeholder endpoint to email the ZIP to the buyer
//
// 🔧 What you must configure in production
// 1) Implement three backend endpoints (Node/Express/FastAPI/Next.js) as noted in BACKEND NOTES.
// 2) Put your Cashfree credentials in backend only. Never expose keys in frontend.
// 3) Configure your email sender (Resend, AWS SES, Mailgun, Postmark, etc.).
// 4) Host the ZIP in secure storage (S3 pre-signed URL) or email as attachment.
//
// DEMO MODE
// - This canvas runs without a backend. Use the "Test checkout (no charge)" button to simulate a success flow.

// ---- Simple local model ----------------------------------------------------
const DEFAULT_COURSE = {
  title: "Entrepreneur's Pocket MBA",
  subtitle: "Zero fluff. High-leverage playbooks to make money faster.",
  bullets: [
    "100+ pages of distilled tactics",
    "Templates for validation and sales",
    "Pricing and funnel playbook",
  ],
  priceINR: 1999,
};

const LS_KEY = "ffx_course_admin_state_v1";
// Secret URL path to access Admin. Visit this exact path to open admin panel.
const ADMIN_SECRET_PATH = "/le-admin-9f1c2a7b5e";

function useAdminState() {
  const [state, setState] = useState(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      return raw ? JSON.parse(raw) : { course: DEFAULT_COURSE, zipName: null, zipDataUrl: null };
    } catch {
      return { course: DEFAULT_COURSE, zipName: null, zipDataUrl: null };
    }
  });
  useEffect(() => {
    localStorage.setItem(LS_KEY, JSON.stringify(state));
  }, [state]);
  return [state, setState];
}

// ---- Cashfree loader (optional; will no-op in this canvas) -----------------
function useCashfreeSdk() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const scriptId = "cashfree-sdk";
    if (document.getElementById(scriptId)) {
      setReady(true);
      return;
    }
    const s = document.createElement("script");
    s.id = scriptId;
    s.src = "https://sdk.cashfree.com/js/ui/2.0.0/cashfree.prod.js";
    s.async = true;
    s.onload = () => setReady(true);
    s.onerror = () => setReady(false);
    document.body.appendChild(s);
  }, []);
  return ready;
}

// ---- Helper UI components --------------------------------------------------
function Pill({ children }) {
  return (
    <span className="inline-flex items-center rounded-full border px-3 py-1 text-sm">
      {children}
    </span>
  );
}

function CheckItem({ children }) {
  return (
    <li className="flex items-start gap-2">
      <span className="mt-1 h-4 w-4 rounded-full border flex items-center justify-center text-xs">✓</span>
      <span>{children}</span>
    </li>
  );
}

// ---- Admin Panel -----------------------------------------------------------
function AdminPanel({ open, onClose, state, setState }) {
  const [draft, setDraft] = useState(state.course);
  const [user, setUser] = useState(null);
  const [admins, setAdmins] = useState([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [selectedFile, setSelectedFile] = useState(null);
  const [paymentLink, setPaymentLink] = useState("");
  const [requests, setRequests] = useState([]);

  useEffect(() => onAuthStateChanged(auth, setUser), []);

  useEffect(() => {
    if (!open) return;
    setDraft(state.course);
    // load admins
    (async () => {
      const snap = await getDoc(doc(db, 'config', 'admins'));
      const list = snap.exists() ? (snap.data().allowedEmails || []) : [];
      setAdmins(list);
    })();
    // load settings
    (async () => {
      const s = await getDoc(doc(db, 'settings', 'global'));
      setPaymentLink(s.exists() ? (s.data().paymentLink || "") : "");
    })();
  }, [open]);

  useEffect(() => {
    const email = user?.email || "";
    setIsAdmin(email && admins.includes(email));
  }, [user, admins]);

  useEffect(() => {
    if (!isAdmin || !open) return;
    const q = query(collection(db, 'requests'));
    const unsub = onSnapshot(q, (snap) => {
      const items = [];
      snap.forEach((d) => items.push({ id: d.id, ...d.data() }));
      items.sort((a,b) => (a.createdAt?.seconds||0) - (b.createdAt?.seconds||0));
      setRequests(items);
    });
    return () => unsub();
  }, [isAdmin, open]);

  if (!open) return null;

  async function claimAdmin() {
    if (!user) return;
    await setDoc(doc(db, 'config', 'admins'), { allowedEmails: [user.email] }, { merge: false });
    setAdmins([user.email]);
  }

  async function saveSettings() {
    if (!isAdmin) return;
    await setDoc(doc(db, 'settings', 'global'), { paymentLink }, { merge: true });
  }

  async function startUpload() {
    if (!isAdmin || !selectedFile) return;
    try {
      setUploadPct(1);
      const idToken = (await auth.currentUser.getIdToken());
      const blob = await upload(`courses/${selectedFile.name}`, selectedFile, {
        access: 'private',
        contentType: selectedFile.type || 'application/zip',
        handleUploadUrl: `${backendBase}/api/blob-upload`,
        clientPayload: idToken, // validated server-side
        multipart: true,
        onUploadProgress: ({ percentage }) => setUploadPct(Math.max(1, Math.round(percentage))),
      });
      alert('Upload complete');
    } catch (e) {
      alert(`Upload failed: ${e?.message || e}`);
    }
  }

  async function approve(uid, email) {
    if (!isAdmin) return;
    await setDoc(doc(db, 'entitlements', uid), { email, granted: true, updatedAt: serverTimestamp() }, { merge: true });
    await updateDoc(doc(db, 'requests', uid), { status: 'approved', updatedAt: serverTimestamp() });
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="w-full max-w-3xl rounded-2xl bg-white p-6 shadow-xl">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">Admin</h2>
          <div className="flex items-center gap-2">
            {user ? (
              <>
                <span className="text-xs text-neutral-600">{user.email}</span>
                <button onClick={() => signOut(auth)} className="rounded-xl border px-3 py-1">Sign out</button>
              </>
            ) : (
              <button onClick={() => signInWithPopup(auth, googleProvider)} className="rounded-xl border px-3 py-1">Sign in with Google</button>
            )}
            <button onClick={onClose} className="rounded-xl border px-3 py-1">Close</button>
          </div>
        </div>

        {!user ? (
          <div className="mt-6 text-sm text-neutral-700">Sign in to continue.</div>
        ) : !admins.length ? (
          <div className="mt-6 space-y-3">
            <div className="text-sm">No admins configured yet. Claim admin with your email:</div>
            <div className="text-xs">You will be recorded as the first admin: <b>{user.email}</b></div>
            <button onClick={claimAdmin} className="rounded-xl bg-black text-white px-4 py-2">Claim Admin</button>
          </div>
        ) : !isAdmin ? (
          <div className="mt-6 text-sm text-red-600">You are signed in as {user.email}, but you are not in the admin list.</div>
        ) : (
          <div className="mt-6 space-y-8">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-sm">Course title</label>
                <input className="w-full rounded-xl border px-3 py-2 mt-1" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
              </div>
              <div>
                <label className="text-sm">Price (INR)</label>
                <input type="number" className="w-full rounded-xl border px-3 py-2 mt-1" value={draft.priceINR} onChange={(e) => setDraft({ ...draft, priceINR: Number(e.target.value || 0) })} />
              </div>
              <div className="md:col-span-2">
                <label className="text-sm">Subtitle / short description</label>
                <textarea className="w-full rounded-xl border px-3 py-2 mt-1" rows={2} value={draft.subtitle} onChange={(e) => setDraft({ ...draft, subtitle: e.target.value })} />
              </div>
              <div className="md:col-span-2">
                <label className="text-sm">What user gets (one per line)</label>
                <textarea className="w-full rounded-xl border px-3 py-2 mt-1" rows={3} value={draft.bullets.join("\n")} onChange={(e) => setDraft({ ...draft, bullets: e.target.value.split(/\n+/).filter(Boolean) })} />
              </div>
            </div>

            <div className="flex gap-2">
              <button className="rounded-xl bg-black text-white px-4 py-2" onClick={() => { setState({ course: draft }); alert('Saved UI content'); }}>Save</button>
              <button className="rounded-xl border px-4 py-2" onClick={() => { setState({ course: DEFAULT_COURSE }); }}>Reset</button>
            </div>

            <div className="border rounded-xl p-4">
              <div className="font-semibold mb-2">Payment settings</div>
              <label className="text-sm">Cashfree Payment Link URL</label>
              <input className="w-full rounded-xl border px-3 py-2 mt-1" placeholder="https://payments.cashfree.com/forms/your-link" value={paymentLink} onChange={(e) => setPaymentLink(e.target.value)} />
              <div className="mt-2"><button onClick={saveSettings} className="rounded-xl border px-3 py-2">Save settings</button></div>
            </div>

            <div className="border rounded-xl p-4">
              <div className="font-semibold mb-2">Upload course ZIP</div>
              <input type="file" accept=".zip" onChange={(e) => setSelectedFile(e.target.files?.[0] || null)} />
              <div className="mt-2 flex items-center gap-3">
                <button onClick={startUpload} className="rounded-xl bg-black text-white px-4 py-2" disabled={!selectedFile}>Upload</button>
                {uploadPct > 0 && <span className="text-sm">{uploadPct}%</span>}
              </div>
              <div className="text-xs text-neutral-500 mt-1">Uploads are restricted to admins by Storage rules.</div>
            </div>

            <div className="border rounded-xl p-4">
              <div className="font-semibold mb-2">Purchase requests</div>
              <div className="text-xs text-neutral-600 mb-2">Approve to grant download entitlement.</div>
              <div className="space-y-2 max-h-60 overflow-auto">
                {requests.length === 0 && <div className="text-sm">No requests yet.</div>}
                {requests.map(r => (
                  <div key={r.id} className="flex items-center justify-between rounded-lg border p-2 text-sm">
                    <div>
                      <div className="font-medium">{r.email}</div>
                      <div className="text-xs text-neutral-500">uid: {r.id} • status: {r.status || 'pending'}</div>
                    </div>
                    <div className="flex gap-2">
                      <button className="rounded-xl border px-3 py-1" onClick={() => approve(r.id, r.email)}>Approve</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---- Main App --------------------------------------------------------------
export default function App() {
  const cashfreeReady = useCashfreeSdk();
  const [state, setState] = useAdminState();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState("");
  const [adminOpen, setAdminOpen] = useState(false);
  const [adminMode, setAdminMode] = useState(false);
  const [user, setUser] = useState(null);
  const [entitled, setEntitled] = useState(false);
  const [paymentLink, setPaymentLink] = useState("");

  const validEmail = /[^@\s]+@[^@\s]+\.[^@\s]+/.test(email);
  const backendBase = import.meta.env.VITE_BACKEND_URL || '';

  // Enable admin mode only when visiting the secret path.
  useEffect(() => {
    try {
      if (window.location?.pathname === ADMIN_SECRET_PATH) {
        setAdminMode(true);
        setAdminOpen(true);
      }
    } catch {}
  }, []);

  useEffect(() => onAuthStateChanged(auth, setUser), []);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'settings', 'global'), (snap) => {
      const p = snap.exists() ? (snap.data().paymentLink || "") : "";
      setPaymentLink(p);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!user) { setEntitled(false); return; }
    const unsub = onSnapshot(doc(db, 'entitlements', user.uid), (snap) => {
      setEntitled(snap.exists());
    });
    return () => unsub();
  }, [user]);

  async function handleRealCheckout() {
    setBusy(true);
    setErr("");
    try {
      // Require sign in so order ties to user
      if (!user) await signInWithPopup(auth, googleProvider);
      const amount = state.course.priceINR || 0;
      const resp = await fetch(`${backendBase}/api/create-order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid: auth.currentUser.uid, email: email || auth.currentUser.email, amountINR: amount }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data?.error || 'Create order failed');

      // Use Cashfree Checkout JS if available; else fallback to returning to hosted page
      if (window.Cashfree) {
        const cashfree = new window.Cashfree({ mode: 'production' });
        const result = await cashfree.checkout({ paymentSessionId: data.paymentSessionId });
        if (result?.error) throw new Error(result.error?.message || 'Checkout error');
      } else {
        // No SDK: open hosted page flow
        window.open(`https://www.cashfree.com/pg/view/pay/${data.paymentSessionId}`, '_blank');
      }
    } catch (e) {
      setErr(e.message || "Checkout error");
    } finally {
      setBusy(false);
    }
  }

  async function requestAccess() {
    if (!user) {
      await signInWithPopup(auth, googleProvider);
    }
    await setDoc(doc(db, 'requests', auth.currentUser.uid), {
      uid: auth.currentUser.uid,
      email: auth.currentUser.email,
      status: 'pending',
      createdAt: serverTimestamp(),
    }, { merge: true });
    alert('Request sent. You will get access once approved.');
  }

  async function downloadCourse() {
    try {
      if (!user) await signInWithPopup(auth, googleProvider);
      const idToken = await auth.currentUser.getIdToken();
      const resp = await fetch(`${backendBase}/api/download`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${idToken}` },
        redirect: 'follow'
      });
      // If server responds with redirect, browser may not auto-follow via fetch
      // In that case, derive final URL and navigate window to it
      if (resp.redirected) {
        window.location.href = resp.url;
      } else if (resp.status === 302) {
        const loc = resp.headers.get('Location');
        if (loc) window.location.href = loc; else throw new Error('No download URL');
      } else if (resp.ok) {
        // Some platforms may return OK+JSON with a url
        const data = await resp.json().catch(() => null);
        if (data?.url) window.location.href = data.url; else throw new Error('Unexpected download response');
      } else {
        const errText = await resp.text().catch(() => 'Download failed');
        throw new Error(errText);
      }
    } catch (e) {
      setErr(e?.message || 'Download not available yet.');
    }
  }

  function simulateSuccess() {
    setBusy(true);
    setErr("");
    setTimeout(() => {
      setBusy(false);
      setDone(true);
    }, 800);
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-amber-50 to-white text-neutral-900">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
        <div className="flex items-center gap-2">
          <img src={logoUrl} alt="Let's Earn logo" className="h-12 w-12" />
        </div>
        {/* Admin button removed; use secret URL to access admin */}
      </header>

      <main className="mx-auto grid max-w-6xl grid-cols-1 gap-8 px-4 pb-24 pt-6 md:grid-cols-2">
        <section className="flex flex-col justify-center gap-6">
          <div>
            <h1 className="text-3xl md:text-5xl font-bold leading-tight">
              {state.course.title}
            </h1>
            <p className="mt-3 text-lg text-neutral-700">{state.course.subtitle}</p>
          </div>

          <ul className="space-y-2 text-base">
            {state.course.bullets.map((b, i) => (
              <CheckItem key={i}>{b}</CheckItem>
            ))}
          </ul>

          <div className="flex items-end gap-4 pt-2">
            <div>
              <div className="text-4xl font-extrabold">₹{state.course.priceINR}</div>
              <div className="text-xs text-neutral-500">One-time payment • ZIP delivered by email</div>
            </div>
          </div>

          <div className="mt-2 grid gap-3 md:grid-cols-[1fr_auto]">
            <input
              className="w-full rounded-2xl border px-4 py-3"
              type="email"
              placeholder="Enter your email to receive the course"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <div className="flex gap-2">
              <button
                disabled={!validEmail || busy}
                onClick={handleRealCheckout}
                className="rounded-2xl bg-amber-500 px-6 py-3 font-semibold text-black disabled:opacity-50"
                title="Open payment link"
              >
                Pay now
              </button>
              {!user ? (
                <button onClick={() => signInWithPopup(auth, googleProvider)} className="rounded-2xl border px-6 py-3">Sign in</button>
              ) : (
                <button onClick={() => signOut(auth)} className="rounded-2xl border px-6 py-3">Sign out</button>
              )}
            </div>
 
          </div>

          {err && <div className="text-sm text-red-600">{err}</div>}
          <div className="rounded-2xl border bg-white p-4 text-sm space-y-2">
            {!entitled ? (
              <div className="space-y-2">
                <div>After paying, click below to request access. An admin will approve quickly.</div>
                <div className="flex gap-2">
                  <button onClick={requestAccess} className="rounded-xl border px-4 py-2">I paid — Request access</button>
                </div>
                <div className="text-xs text-neutral-500">Note: You must be signed in with Google using the email you provided during checkout.</div>
              </div>
            ) : (
              <div className="space-y-2">
                <div>Access granted. You can download your course now.</div>
                <button onClick={downloadCourse} className="rounded-xl bg-black text-white px-4 py-2">Download ZIP</button>
              </div>
            )}
          </div>
        </section>

        <aside className="relative">
          <div className="absolute inset-0 -z-10 animate-pulse rounded-3xl bg-amber-200/40 blur-3xl" />

          <div className="rounded-3xl border bg-white p-6 shadow-sm">
            <div className="rounded-2xl bg-gradient-to-br from-amber-300 to-orange-200 p-6">
              <div className="text-sm">Featured course</div>
              <div className="mt-1 text-2xl font-bold">{state.course.title}</div>
              <div className="mt-1 text-sm">ZIP package • Lifetime access</div>
            </div>

            <div className="mt-6 grid gap-3 text-sm">
              <div className="rounded-xl border p-3">
                <div className="font-semibold">Fast wins</div>
                <div className="text-neutral-600">Actionable steps to get to revenue faster.</div>
              </div>
              <div className="rounded-xl border p-3">
                <div className="font-semibold">Founder-tested</div>
                <div className="text-neutral-600">No fluff. Just what works in India.</div>
              </div>
              <div className="rounded-xl border p-3">
                <div className="font-semibold">Keep the ZIP</div>
                <div className="text-neutral-600">Download, revisit, and use the templates anytime.</div>
              </div>
            </div>

            <div className="mt-6 rounded-xl bg-amber-50 p-4 text-xs text-neutral-600">
              <b>Note:</b> This demo uses a simulated checkout. Connect your backend to enable real payments and automated emails.
            </div>
          </div>
        </aside>
      </main>

      <footer className="mx-auto max-w-6xl px-4 pb-10 text-xs text-neutral-500">
        © {new Date().getFullYear()} Aumorphic. All rights reserved.
      </footer>

      <AdminPanel open={adminOpen} onClose={() => setAdminOpen(false)} state={state} setState={setState} />

      {false && <BackendNotes />}
    </div>
  );
}

// ---- BACKEND NOTES ---------------------------------------------------------
function BackendNotes() {
  return (
    <div className="fixed bottom-2 right-2 w-[360px] rounded-xl border bg-white p-3 text-xs shadow">
      <div className="font-semibold">Backend TODO</div>
      <ol className="list-decimal pl-4 space-y-1">
        <li>Create order endpoint: POST /api/create-order → returns {{ orderToken, orderId }}</li>
        <li>Verify endpoint: GET /api/verify-order?orderId=...</li>
        <li>Email send endpoint: POST /api/send-course-email</li>
      </ol>
    </div>
  );
}
