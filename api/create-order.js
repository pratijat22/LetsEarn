// Vercel Serverless Function: POST /api/create-order
// Ensure fetch exists in Node <18 (fallback to node-fetch)
const fetchFn = (typeof fetch !== 'undefined')
  ? fetch
  : ((...args) => import('node-fetch').then(({ default: f }) => f(...args)));
// Body: { uid, email, amountINR }
// Returns { orderId, paymentSessionId }
export default async function handler(req, res) {
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { uid, email, amountINR, phone } = req.body || {};
    if (!uid || !email || !amountINR) return res.status(400).json({ error: 'Missing fields' });
    const phoneDigits = String(phone || '').replace(/\D/g, '');
    if (!phoneDigits) return res.status(400).json({ error: 'Missing phone' });
    const amt = Number(String(amountINR).replace(/[^0-9.]/g, ''));
    if (!Number.isFinite(amt) || amt <= 0) return res.status(400).json({ error: 'invalid_amount' });

    const appId = process.env.CASHFREE_APP_ID;
    const secret = process.env.CASHFREE_SECRET;
    const mode = process.env.CASHFREE_MODE || 'PROD'; // PROD or TEST
    if (!appId || !secret) {
      console.error('Missing Cashfree envs');
      return res.status(500).json({ error: 'cashfree_env_missing' });
    }

    // Sanitize customer_id to allowed set: alphanumeric, underscore, hyphen
    const customerId = String(uid || '').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64);

    // Cashfree order_id must be alphanumeric with limited symbols and length constraints.
    // Avoid embedding email; generate a compact unique id instead.
    const orderId = `order_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const base = mode === 'TEST' ? 'https://sandbox.cashfree.com' : 'https://api.cashfree.com';
    const resp = await fetchFn(`${base}/pg/orders`, {
      method: 'POST',
      headers: {
        'x-client-id': appId,
        'x-client-secret': secret,
        'x-api-version': '2022-09-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        order_id: orderId,
        order_amount: amt,
        order_currency: 'INR',
        customer_details: {
          customer_id: customerId,
          customer_email: email,
          customer_phone: phoneDigits,
        },
        order_meta: {
          return_url: req.headers.origin ? `${req.headers.origin}/?order_id={order_id}` : undefined,
          notify_url: process.env.CASHFREE_WEBHOOK_URL,
        }
      })
    });

    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      return res.status(400).json({ error: 'Cashfree order create failed', detail: data });
    }

    return res.json({ orderId: data.order_id || orderId, paymentSessionId: data.payment_session_id });
  } catch (e) {
    console.error('create-order error', e);
    return res.status(500).json({ error: 'server_error' });
  }
};

export const config = { runtime: 'nodejs' };
