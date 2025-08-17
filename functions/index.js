const functions = require("firebase-functions");
const admin = require("firebase-admin");
const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const { v4: uuidv4 } = require("uuid");

admin.initializeApp();
const db = admin.firestore();
const bucket = admin.storage().bucket();

const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: "10mb" }));

// Config
function getConfig() {
  const cfg = functions.config() || {};
  return {
    cashfree: {
      appId: cfg.cashfree?.app_id || "",
      secret: cfg.cashfree?.secret || "",
      webhookSecret: cfg.cashfree?.webhook_secret || "",
    },
    admin: {
      emails: (cfg.admin?.emails || "").split(",").map((s) => s.trim()).filter(Boolean),
    },
  };
}

async function verifyAdmin(req, res, next) {
  try {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
    if (!token) return res.status(401).json({ error: "missing token" });
    const decoded = await admin.auth().verifyIdToken(token);
    const email = decoded.email || "";
    const { admin: adminCfg } = getConfig();
    if (!adminCfg.emails.length) {
      return res.status(403).json({ error: "admin not configured" });
    }
    if (!adminCfg.emails.includes(email)) {
      return res.status(403).json({ error: "not an admin" });
    }
    req.user = { uid: decoded.uid, email };
    next();
  } catch (e) {
    console.error("verifyAdmin error", e);
    res.status(401).json({ error: "auth failed" });
  }
}

// Admin: signed URL to upload course zip
app.post("/admin/upload-url", verifyAdmin, async (req, res) => {
  try {
    const objectPath = "courses/current.zip";
    const file = bucket.file(objectPath);
    const expires = Date.now() + 10 * 60 * 1000; // 10 min
    const [url] = await file.getSignedUrl({
      version: "v4",
      action: "write",
      expires,
      contentType: "application/zip",
    });
    res.json({ putUrl: url, objectPath });
  } catch (e) {
    console.error("upload-url", e);
    res.status(500).json({ error: "failed" });
  }
});

// Payments: create Cashfree order
app.post("/payments/create-order", async (req, res) => {
  try {
    const { email, amount, returnUrl } = req.body || {};
    if (!email || !amount) return res.status(400).json({ error: "missing fields" });
    const { cashfree } = getConfig();
    if (!cashfree.appId || !cashfree.secret) return res.status(500).json({ error: "cashfree not configured" });

    const orderId = `le_${Date.now()}_${Math.floor(Math.random()*1e6)}`;
    const payload = {
      order_id: orderId,
      order_amount: amount,
      order_currency: "INR",
      customer_details: {
        customer_id: email,
        customer_email: email,
      },
      order_meta: returnUrl ? { return_url: `${returnUrl}?order_id=${orderId}&order_status={order_status}` } : undefined,
    };

    const resp = await fetch("https://api.cashfree.com/pg/orders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-version": "2022-09-01",
        "x-client-id": cashfree.appId,
        "x-client-secret": cashfree.secret,
      },
      body: JSON.stringify(payload),
    });
    const data = await resp.json();
    if (!resp.ok) {
      console.error("cashfree create order error", data);
      return res.status(500).json({ error: "cashfree error", details: data });
    }

    await db.collection("orders").doc(orderId).set({
      email,
      orderId,
      amount,
      status: "created",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      provider: "cashfree",
    });

    res.json({ orderId, orderToken: data.order_token, paymentLink: data.payment_link });
  } catch (e) {
    console.error("create-order", e);
    res.status(500).json({ error: "failed" });
  }
});

// Payments webhook
app.post("/payments/webhook", async (req, res) => {
  try {
    const { cashfree } = getConfig();
    const signature = req.headers["x-webhook-signature"] || req.headers["x-cf-signature"];
    if (!signature) return res.status(400).send("missing signature");

    const expected = crypto
      .createHmac("sha256", cashfree.webhookSecret || "")
      .update(Buffer.from(req.rawBody || JSON.stringify(req.body)))
      .digest("hex");
    if (expected !== signature) {
      console.warn("webhook signature mismatch");
      return res.status(401).send("invalid signature");
    }

    const evt = req.body || {};
    const orderId = evt?.data?.order?.order_id || evt?.order_id || evt?.order?.order_id;
    const paymentStatus = evt?.data?.payment?.payment_status || evt?.data?.order?.status || evt?.payment_status;

    if (!orderId) {
      console.warn("webhook missing orderId", evt);
      return res.status(200).send("ok");
    }

    if (["SUCCESS", "PAID", "PAYMENT_SUCCESS", "COMPLETED"].includes((paymentStatus || "").toUpperCase())) {
      const orderRef = db.collection("orders").doc(orderId);
      await orderRef.set({ status: "paid", updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });

      // generate one-time token
      const token = uuidv4();
      await db.collection("downloadTokens").doc(token).set({
        orderId,
        email: (await orderRef.get()).data()?.email || "",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        expiresAt: Date.now() + 60 * 60 * 1000, // 1 hour
        used: false,
      });
    }

    res.status(200).send("ok");
  } catch (e) {
    console.error("webhook", e);
    res.status(200).send("ok");
  }
});

// Poll order status
app.get("/payments/order-status", async (req, res) => {
  try {
    const orderId = req.query.orderId;
    if (!orderId) return res.status(400).json({ error: "missing orderId" });
    const doc = await db.collection("orders").doc(String(orderId)).get();
    const data = doc.data();
    if (!data) return res.json({ status: "not_found" });

    let downloadToken = null;
    if (data.status === "paid") {
      // find existing token
      const snap = await db.collection("downloadTokens").where("orderId", "==", String(orderId)).orderBy("createdAt", "desc").limit(1).get();
      if (!snap.empty) downloadToken = snap.docs[0].id;
    }

    res.json({ status: data.status, downloadToken });
  } catch (e) {
    console.error("order-status", e);
    res.status(500).json({ error: "failed" });
  }
});

// Download using one-time token
app.get("/download", async (req, res) => {
  try {
    const token = req.query.token;
    if (!token) return res.status(400).send("missing token");
    const tokRef = db.collection("downloadTokens").doc(String(token));
    const tokSnap = await tokRef.get();
    const tok = tokSnap.data();
    if (!tok || tok.used) return res.status(403).send("invalid token");
    if (tok.expiresAt && Date.now() > tok.expiresAt) return res.status(403).send("expired token");

    const file = bucket.file("courses/current.zip");
    const [url] = await file.getSignedUrl({ version: "v4", action: "read", expires: Date.now() + 15 * 60 * 1000 });

    await tokRef.set({ used: true, usedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });

    res.json({ url });
  } catch (e) {
    console.error("download", e);
    res.status(500).send("failed");
  }
});

exports.api = functions.https.onRequest(app);
