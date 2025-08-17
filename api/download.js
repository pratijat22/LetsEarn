const { admin } = require('./_firebaseAdmin');
const { head } = require('@vercel/blob');

module.exports = async (req, res) => {
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // Check entitlement by email from query
    const urlObj = new URL(req.url, `https://${req.headers.host}`);
    const email = (urlObj.searchParams.get('email') || '').toLowerCase();
    if (!email) return res.status(400).json({ error: 'Missing email' });
    const db = admin.firestore();
    const ent = await db.collection('entitlements_by_email').doc(email).get();
    if (!ent.exists) return res.status(403).json({ error: 'No entitlement for this email' });

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
