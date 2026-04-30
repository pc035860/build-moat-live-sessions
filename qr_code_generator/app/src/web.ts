// Single-file frontend bundled into the server. Served at `/`.
// Kept as a string literal so there's no static-file plumbing — `c.html()`
// returns it directly, same as any other Hono route.
export const indexHtml = `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>QR Code Generator</title>
<style>
  :root {
    --bg: #0f172a;
    --panel: #1e293b;
    --panel-2: #334155;
    --text: #e2e8f0;
    --muted: #94a3b8;
    --accent: #38bdf8;
    --accent-hover: #0ea5e9;
    --error: #f87171;
    --success: #34d399;
    --border: #475569;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    background: var(--bg);
    color: var(--text);
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 2rem 1rem;
  }
  .container {
    width: 100%;
    max-width: 520px;
  }
  h1 {
    font-size: 1.5rem;
    margin: 0 0 1.5rem;
    font-weight: 600;
  }
  h1 .accent { color: var(--accent); }
  .card {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 1.5rem;
    margin-bottom: 1rem;
  }
  label {
    display: block;
    font-size: 0.85rem;
    color: var(--muted);
    margin-bottom: 0.4rem;
  }
  input[type="url"], input[type="datetime-local"] {
    width: 100%;
    padding: 0.6rem 0.75rem;
    background: var(--panel-2);
    border: 1px solid var(--border);
    border-radius: 8px;
    color: var(--text);
    font-size: 0.95rem;
    font-family: inherit;
  }
  input:focus {
    outline: none;
    border-color: var(--accent);
  }
  .field { margin-bottom: 1rem; }
  .row { display: flex; gap: 0.5rem; align-items: center; }
  button {
    padding: 0.6rem 1rem;
    background: var(--accent);
    color: var(--bg);
    border: none;
    border-radius: 8px;
    font-size: 0.95rem;
    font-weight: 600;
    cursor: pointer;
    font-family: inherit;
  }
  button:hover:not(:disabled) { background: var(--accent-hover); }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
  button.secondary {
    background: var(--panel-2);
    color: var(--text);
    border: 1px solid var(--border);
  }
  button.secondary:hover:not(:disabled) { background: var(--border); }
  .submit-btn { width: 100%; padding: 0.75rem; }
  #result { display: none; }
  #result.visible { display: block; }
  .qr-wrap {
    display: flex;
    justify-content: center;
    background: white;
    padding: 1rem;
    border-radius: 8px;
    margin-bottom: 1rem;
  }
  .qr-wrap img { display: block; width: 240px; height: 240px; }
  .field-readonly {
    background: var(--panel-2);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 0.5rem 0.75rem;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.85rem;
    word-break: break-all;
    flex: 1;
    min-width: 0;
  }
  #status {
    font-size: 0.85rem;
    margin-top: 0.5rem;
    min-height: 1.2em;
  }
  #status.error { color: var(--error); }
  #status.success { color: var(--success); }
  .meta { font-size: 0.8rem; color: var(--muted); margin-top: 0.5rem; }
  a { color: var(--accent); }
</style>
</head>
<body>
  <div class="container">
    <h1><span class="accent">QR</span> Code Generator</h1>

    <form id="form" class="card" autocomplete="off">
      <div class="field">
        <label for="url">URL</label>
        <input id="url" type="url" placeholder="https://example.com" required />
      </div>
      <div class="field">
        <label for="expires_at">Expires At <span style="opacity:0.6">(optional)</span></label>
        <input id="expires_at" type="datetime-local" />
      </div>
      <button type="submit" class="submit-btn" id="submit">Generate</button>
      <div id="status"></div>
    </form>

    <div class="card" id="result">
      <div class="qr-wrap"><img id="qr" alt="QR code" /></div>

      <div class="field">
        <label>Short URL</label>
        <div class="row">
          <div class="field-readonly" id="short_url"></div>
          <button type="button" class="secondary" id="copy">Copy</button>
        </div>
      </div>

      <div class="field" style="margin-bottom: 0">
        <label>Original URL</label>
        <div class="field-readonly" id="original_url"></div>
        <div class="meta" id="meta"></div>
      </div>
    </div>
  </div>

<script>
(() => {
  const form = document.getElementById("form");
  const submit = document.getElementById("submit");
  const statusEl = document.getElementById("status");
  const result = document.getElementById("result");
  const qr = document.getElementById("qr");
  const shortUrlEl = document.getElementById("short_url");
  const originalUrlEl = document.getElementById("original_url");
  const metaEl = document.getElementById("meta");
  const copyBtn = document.getElementById("copy");

  function setStatus(msg, kind) {
    statusEl.textContent = msg;
    statusEl.className = kind || "";
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const url = document.getElementById("url").value.trim();
    const localDt = document.getElementById("expires_at").value;
    if (!url) return;

    const body = { url };
    if (localDt) {
      // <input type="datetime-local"> gives us a naive local string.
      // Convert to UTC ISO so the API gets the same thing curl would send.
      body.expires_at = new Date(localDt).toISOString();
    }

    submit.disabled = true;
    setStatus("Generating…");
    try {
      const res = await fetch("/api/qr/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || data.message || "Request failed (" + res.status + ")");
      }
      qr.src = data.qr_code_url;
      shortUrlEl.textContent = data.short_url;
      originalUrlEl.textContent = data.original_url;
      const expiresAt = data.expires_at
        ? "Expires: " + new Date(data.expires_at).toLocaleString()
        : "No expiration";
      metaEl.textContent = "Token: " + data.token + " · " + expiresAt;
      result.classList.add("visible");
      setStatus("Done.", "success");
    } catch (err) {
      setStatus(err.message || String(err), "error");
    } finally {
      submit.disabled = false;
    }
  });

  copyBtn.addEventListener("click", async () => {
    const text = shortUrlEl.textContent || "";
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      const orig = copyBtn.textContent;
      copyBtn.textContent = "Copied!";
      setTimeout(() => { copyBtn.textContent = orig; }, 1200);
    } catch {
      setStatus("Copy failed — select and copy manually.", "error");
    }
  });
})();
</script>
</body>
</html>`;
