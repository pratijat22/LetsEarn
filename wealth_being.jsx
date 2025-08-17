import React, { useEffect, useMemo, useRef, useState } from "react";

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
  const [authed, setAuthed] = useState(false);
  const [pw, setPw] = useState("");
  const [draft, setDraft] = useState(state.course);
  const [zipName, setZipName] = useState(state.zipName);
  const [zipDataUrl, setZipDataUrl] = useState(state.zipDataUrl);

  useEffect(() => {
    if (open) {
      setDraft(state.course);
      setZipName(state.zipName);
      setZipDataUrl(state.zipDataUrl);
    }
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-xl">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">Admin</h2>
          <button onClick={onClose} className="rounded-xl border px-3 py-1">Close</button>
        </div>

        {!authed ? (
          <div className="mt-6 space-y-3">
            <p className="text-sm">Enter admin password.</p>
            <input
              type="password"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              className="w-full rounded-xl border px-3 py-2"
              placeholder="Password"
            />
            <div className="text-xs text-neutral-500">Demo password: <code>admin123</code></div>
            <div className="flex gap-2 pt-2">
              <button
                onClick={() => setAuthed(pw === "admin123")}
                className="rounded-xl bg-black text-white px-4 py-2"
              >
                Continue
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-6 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-sm">Course title</label>
                <input
                  className="w-full rounded-xl border px-3 py-2 mt-1"
                  value={draft.title}
                  onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                />
              </div>
              <div>
                <label className="text-sm">Price (INR)</label>
                <input
                  type="number"
                  className="w-full rounded-xl border px-3 py-2 mt-1"
                  value={draft.priceINR}
                  onChange={(e) => setDraft({ ...draft, priceINR: Number(e.target.value || 0) })}
                />
              </div>
              <div className="md:col-span-2">
                <label className="text-sm">Subtitle / short description</label>
                <textarea
                  className="w-full rounded-xl border px-3 py-2 mt-1"
                  rows={2}
                  value={draft.subtitle}
                  onChange={(e) => setDraft({ ...draft, subtitle: e.target.value })}
                />
              </div>
              <div className="md:col-span-2">
                <label className="text-sm">What user gets (one per line)</label>
                <textarea
                  className="w-full rounded-xl border px-3 py-2 mt-1"
                  rows={3}
                  value={draft.bullets.join("\n")}
                  onChange={(e) => setDraft({ ...draft, bullets: e.target.value.split(/\n+/).filter(Boolean) })}
                />
              </div>
              <div className="md:col-span-2">
                <label className="text-sm">Upload course ZIP (demo only)</label>
                <input
                  type="file"
                  accept=".zip"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (!f) { setZipName(null); setZipDataUrl(null); return; }
                    setZipName(f.name);
                    const reader = new FileReader();
                    reader.onload = () => {
                      const result = typeof reader.result === 'string' ? reader.result : null;
                      setZipDataUrl(result);
                    };
                    reader.readAsDataURL(f);
                  }}
                  className="w-full rounded-xl border px-3 py-2 mt-1"
                />
                <div className="text-xs text-neutral-500 mt-1">Selected: {zipName || "None"}</div>
              </div>
            </div>

            <div className="flex gap-2">
              <button
                className="rounded-xl bg-black text-white px-4 py-2"
                onClick={() => {
                  setState({ course: draft, zipName, zipDataUrl });
                  onClose();
                }}
              >
                Save
              </button>
              <button
                className="rounded-xl border px-4 py-2"
                onClick={() => {
                  setState({ course: DEFAULT_COURSE, zipName: null, zipDataUrl: null });
                  onClose();
                }}
              >
                Reset
              </button>
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

  const validEmail = /[^@\s]+@[^@\s]+\.[^@\s]+/.test(email);

  async function handleRealCheckout() {
    setBusy(true);
    setErr("");
    try {
      // 1) Create order on your backend
      // const res = await fetch("/api/create-order", {
      //   method: "POST",
      //   headers: { "Content-Type": "application/json" },
      //   body: JSON.stringify({ email, amount: state.course.priceINR }),
      // });
      // if (!res.ok) throw new Error("create-order failed");
      // const { orderToken, orderId } = await res.json();

      // 2) Open Cashfree Checkout UI
      // /* global Cashfree */
      // const cashfree = new Cashfree({ mode: "production" }); // or "sandbox"
      // const result = await cashfree.checkout({ paymentSessionId: orderToken });
      // if (result?.error) throw new Error(result.error?.message || "checkout error");

      // 3) Verify payment on backend
      // const v = await fetch(`/api/verify-order?orderId=${orderId}`);
      // const verify = await v.json();
      // if (!verify?.paid) throw new Error("payment not verified");

      // 4) Trigger email send with pre-signed link or attachment
      // const s = await fetch("/api/send-course-email", {
      //   method: "POST",
      //   headers: { "Content-Type": "application/json" },
      //   body: JSON.stringify({ email, orderId }),
      // });
      // if (!s.ok) throw new Error("email send failed");

      // In this canvas we cannot call real backend. Show guidance.
      alert("This is a live checkout placeholder. Connect backend as per BACKEND NOTES in code.");
    } catch (e) {
      setErr(e.message || "Checkout error");
    } finally {
      setBusy(false);
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
          <div className="h-9 w-9 rounded-2xl bg-amber-400" />
          <div className="text-lg font-semibold">FyndFox Courses</div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setAdminOpen(true)} className="ml-2 rounded-xl border px-3 py-1 text-sm">Admin</button>
        </div>
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
            <button
              disabled={!validEmail || busy}
              onClick={handleRealCheckout}
              className="rounded-2xl bg-amber-500 px-6 py-3 font-semibold text-black disabled:opacity-50"
              title={cashfreeReady ? "Open checkout" : "Checkout SDK not loaded; still fine for backend integration"}
            >
              Pay now
            </button>
            <button
              disabled={!validEmail || busy}
              onClick={simulateSuccess}
              className="rounded-2xl border px-6 py-3 font-semibold disabled:opacity-50"
            >
              Test checkout (no charge)
            </button>
          </div>

          {err && <div className="text-sm text-red-600">{err}</div>}
          {done && (
            <div className="rounded-2xl border bg-white p-4 text-sm space-y-2">
              <div>
                Payment verified. Course will be sent to <b>{email}</b>. In production your backend emails a secure link.
              </div>
              {state.zipDataUrl && (
                <div>
                  Also available now: <a className="underline" href={state.zipDataUrl} download={state.zipName || 'course.zip'}>Download ZIP</a>
                </div>
              )}
            </div>
          )}
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
// Implement the following endpoints on your server. Example Node/Express:
//
// 1) POST /api/create-order
//    - Body: { email, amount }
//    - Server calls Cashfree Orders API to create order and returns { orderId, orderToken }
//    - Docs: https://docs.cashfree.com/docs/create-order
//
// 2) GET /api/verify-order?orderId=...
//    - Server verifies payment status via Cashfree Orders API and returns { paid: true/false }
//
// 3) POST /api/send-course-email
//    - Body: { email, orderId }
//    - Server checks paid status again
//    - Generates pre-signed URL for ZIP (e.g., S3) or attaches file
//    - Sends email via Resend/SES/Mailgun and responds { sent: true }
//
// Minimal Express sketch:
//
// import express from 'express';
// import fetch from 'node-fetch';
// import { Resend } from 'resend';
// const app = express(); app.use(express.json());
// const CASHFREE_CLIENT_ID = process.env.CF_ID; // keep secret
// const CASHFREE_SECRET = process.env.CF_SECRET; // keep secret
// const resend = new Resend(process.env.RESEND_KEY);
//
// app.post('/api/create-order', async (req, res) => {
//   const { email, amount } = req.body;
//   const r = await fetch('https://api.cashfree.com/pg/orders', {
//     method: 'POST',
//     headers: {
//       'Content-Type': 'application/json',
//       'x-client-id': CASHFREE_CLIENT_ID,
//       'x-client-secret': CASHFREE_SECRET,
//       'x-api-version': '2022-09-01',
//     },
//     body: JSON.stringify({
//       order_amount: amount,
//       order_currency: 'INR',
//       customer_details: { customer_id: email, customer_email: email },
//     }),
//   });
//   const data = await r.json();
//   res.json({ orderId: data.order_id, orderToken: data.payment_session_id });
// });
//
// app.get('/api/verify-order', async (req, res) => {
//   const orderId = req.query.orderId;
//   const r = await fetch(`https://api.cashfree.com/pg/orders/${orderId}`, {
//     headers: {
//       'x-client-id': CASHFREE_CLIENT_ID,
//       'x-client-secret': CASHFREE_SECRET,
//       'x-api-version': '2022-09-01',
//     },
//   });
//   const data = await r.json();
//   res.json({ paid: data.order_status === 'PAID' });
// });
//
// app.post('/api/send-course-email', async (req, res) => {
//   const { email, orderId } = req.body;
//   // Re-verify order if needed, then send email with link
//   await resend.emails.send({
//     from: 'Aumorphic <noreply@yourdomain.com>',
//     to: email,
//     subject: 'Your course download',
//     html: `<p>Thanks for your purchase.</p><p><a href="https://signed-url-to-zip">Download your ZIP</a></p>`,
//   });
//   res.json({ sent: true });
// });
//
// app.listen(3000);

function BackendNotes() {
  return null;
}
