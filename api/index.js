// api/index.js — Landing page for root URL
module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "text/html");
  return res.status(200).send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>WarrantyVault Backend</title>
      <style>
        body { font-family: system-ui, sans-serif; padding: 40px; max-width: 600px; margin: 0 auto; }
        h1 { color: #0ea5e9; }
        .endpoint { background: #f3f4f6; padding: 12px 16px; margin: 8px 0; border-radius: 6px; font-family: monospace; }
        .method { color: #dc2626; font-weight: bold; }
        a { color: #0ea5e9; text-decoration: none; }
        a:hover { text-decoration: underline; }
      </style>
    </head>
    <body>
      <h1>🔐 WarrantyVault Backend</h1>
      <p>API is running on Vercel + Neon. This is a serverless backend — no website at root.</p>
      <p><strong>Endpoints (POST only):</strong></p>
      <div class="endpoint"><span class="method">POST</span> /api/process-document — File → Gemini extraction → Neon DB</div>
      <div class="endpoint"><span class="method">POST</span> /api/delete-document — Delete file + DB row</div>
      <div class="endpoint"><span class="method">POST</span> /api/delete-account — Full account erasure</div>
      <div class="endpoint"><span class="method">POST</span> /api/draft-warranty-email — Draft claim email</div>
      <p><strong>GitHub:</strong> <a href="https://github.com/parjun5555k-del/File-storage" target="_blank">parjun5555k-del/File-storage</a></p>
      <p><em>All endpoints require Authorization: Bearer &lt;token&gt; header.</em></p>
    </body>
    </html>
  `);
};
