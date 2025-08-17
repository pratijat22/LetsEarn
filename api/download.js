const { admin } = require('./_firebaseAdmin');
const { head } = require('@vercel/blob');

module.exports = async (req, res) => {
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // Verify Firebase ID token
    const authz = req.headers.authorization || '';
    const token = authz.startsWith('Bearer ') ? authz.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Missing token' });
    const decoded = await admin.auth().verifyIdToken(String(token));

    // Check entitlement
    const db = admin.firestore();
    const ent = await db.collection('entitlements').doc(decoded.uid).get();
    if (!ent.exists) return res.status(403).json({ error: 'No entitlement' });

    // Read current blob URL from settings
    const settings = await db.collection('settings').doc('global').get();
    const url = settings.exists ? (settings.data().courseBlobUrl || '') : '';
    if (!url) return res.status(404).json({ error: 'No course uploaded yet' });

    // Option 1: redirect to the blob URL (works for public/private with signed URLs)
    // Optionally, validate blob exists first
    try { await head(url); } catch {}

    res.writeHead(302, { Location: url });
    return res.end();
  } catch (e) {
    console.error('download error', e);
    return res.status(500).json({ error: 'server_error' });
  }
};
