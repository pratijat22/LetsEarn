const { admin } = require('./_firebaseAdmin');

// Vercel Serverless Function: POST /api/create-order
// Body: { uid, email, amountINR }
// Returns { orderId, paymentSessionId }
module.exports = async (req, res) => {
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { uid, email, amountINR } = req.body || {};
    if (!uid || !email || !amountINR) return res.status(400).json({ error: 'Missing fields' });

    const appId = process.env.CASHFREE_APP_ID;
    const secret = process.env.CASHFREE_SECRET;
    const mode = process.env.CASHFREE_MODE || 'PROD'; // PROD or TEST

    const orderId = `order_${uid}_${Date.now()}`;

    const base = mode === 'TEST' ? 'https://sandbox.cashfree.com' : 'https://api.cashfree.com';
    const resp = await fetch(`${base}/pg/orders`, {
      method: 'POST',
      headers: {
        'x-client-id': appId,
        'x-client-secret': secret,
        'x-api-version': '2022-09-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        order_id: orderId,
        order_amount: Number(amountINR),
        order_currency: 'INR',
        customer_details: {
          customer_id: uid,
          customer_email: email,
        },
        order_meta: {
          return_url: req.headers.origin ? `${req.headers.origin}/?order_id={order_id}` : undefined,
          notify_url: process.env.CASHFREE_WEBHOOK_URL,
        }
      })
    });

    const data = await resp.json();
    if (!resp.ok) {
      return res.status(400).json({ error: 'Cashfree order create failed', detail: data });
    }

    return res.json({ orderId: data.order_id || orderId, paymentSessionId: data.payment_session_id });
  } catch (e) {
    console.error('create-order error', e);
    return res.status(500).json({ error: 'server_error' });
  }
};
