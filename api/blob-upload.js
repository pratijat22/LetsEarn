const { admin } = require('./_firebaseAdmin');
const { handleUpload } = require('@vercel/blob/client');

module.exports = async (req, res) => {
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // handleUpload expects the raw JSON body; in Vercel functions, req.body is already parsed
    const body = req.body;

    // We require the client to pass a Firebase ID token via clientPayload
    // validate it inside onBeforeGenerateToken using firebase-admin
    const proto = (req.headers['x-forwarded-proto'] || 'https');
    const host = req.headers.host;
    const request = new Request(`${proto}://${host}${req.url}`, {
      method: 'POST',
      headers: new Headers({ 'content-type': 'application/json' }),
      body: JSON.stringify(body || {}),
    });

    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        // clientPayload should be a Firebase ID token
        if (!clientPayload) throw new Error('Missing auth');
        const decoded = await admin.auth().verifyIdToken(String(clientPayload));
        const email = decoded.email || '';

        // Check admin list from Firestore
        const db = admin.firestore();
        const snap = await db.collection('config').doc('admins').get();
        const allowed = snap.exists ? (snap.data().allowedEmails || []) : [];
        if (!email || !allowed.includes(email)) throw new Error('Forbidden');

        return {
          // Only allow ZIP uploads from admins
          allowedContentTypes: ['application/zip', 'application/x-zip-compressed', 'multipart/form-data'],
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({ uid: decoded.uid, email, role: 'admin' }),
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        try {
          // Persist the latest course blob URL in Firestore settings/global
          const db = admin.firestore();
          await db.collection('settings').doc('global').set({
            courseBlobUrl: blob.url,
            courseBlobPath: blob.pathname,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          }, { merge: true });
        } catch (e) {
          console.error('Failed to update settings after upload', e);
          throw e;
        }
      },
    });

    return res.status(200).json(jsonResponse);
  } catch (err) {
    console.error('blob-upload error', err);
    return res.status(400).json({ error: err?.message || 'upload_failed' });
  }
};
