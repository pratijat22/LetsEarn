const crypto = require('crypto');
const { admin } = require('./_firebaseAdmin');

// Vercel Serverless Function: POST /api/cashfree-webhook
// Verifies signature and grants entitlement when payment is successful
module.exports = async (req, res) => {
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-webhook-signature, x-cf-signature');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const payload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

    // Expect payload contains data.order.order_id and data.payment.payment_status
    const event = payload?.type || payload?.event;
    const order = payload?.data?.order || payload?.order;
    const payment = payload?.data?.payment || payload?.payment;

    const status = payment?.payment_status || payment?.status;
    const orderId = order?.order_id || order?.id;

    if (!orderId) return res.status(400).json({ error: 'No order id' });

    // Verify with Cashfree Orders API (robust even if signature handling differs)
    const mode = process.env.CASHFREE_MODE || 'PROD';
    const base = mode === 'TEST' ? 'https://sandbox.cashfree.com' : 'https://api.cashfree.com';
    const appId = process.env.CASHFREE_APP_ID;
    const secret = process.env.CASHFREE_SECRET;

    const verifyResp = await fetch(`${base}/pg/orders/${orderId}`, {
      method: 'GET',
      headers: {
        'x-client-id': appId,
        'x-client-secret': secret,
        'x-api-version': '2022-09-01'
      }
    });
    const verifyData = await verifyResp.json();
    if (!verifyResp.ok) {
      console.error('Cashfree verify error', verifyData);
      return res.status(400).json({ error: 'verify_failed', detail: verifyData });
    }

    const paid = ['PAID', 'SUCCESS', 'SUCCESSFUL'].includes(String(verifyData.order_status || '').toUpperCase());
    if (!paid) return res.json({ ok: true, ignored: true });

    // Determine buyer email from verified order
    const email = (verifyData?.customer_details?.customer_email
      || verifyData?.customer?.customer_email
      || order?.customer_details?.customer_email
      || order?.customer_email
      || '').toLowerCase();
    if (!email) return res.status(400).json({ error: 'No customer email on order' });

    const db = admin.firestore();
    const entRef = db.collection('entitlements_by_email').doc(email);
    await entRef.set({ email, granted: true, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });

    return res.json({ ok: true });
  } catch (e) {
    console.error('webhook error', e);
    return res.status(500).json({ error: 'server_error' });
  }
};
