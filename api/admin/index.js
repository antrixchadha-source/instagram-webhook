import { checkBasicAuth, sendAuthChallenge } from "../../lib/auth.js";

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Webhook Admin</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    * { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, system-ui, sans-serif; max-width: 640px; margin: 32px auto; padding: 0 20px; color: #111; }
    h1 { font-size: 22px; margin: 0 0 6px; }
    .hint { font-size: 12px; color: #888; margin-bottom: 24px; }
    .card { border: 1px solid #e3e3e8; border-radius: 12px; padding: 6px 20px; margin-bottom: 16px; background: #fff; }
    .card h2 { font-size: 16px; margin: 12px 0 0; }
    .card .meta { font-size: 12px; color: #888; margin: 4px 0 8px; }
    .row { display: flex; align-items: center; justify-content: space-between; padding: 12px 0; border-top: 1px solid #f3f3f5; gap: 16px; }
    .row .label { font-size: 14px; }
    .row .desc { font-size: 12px; color: #888; margin-top: 2px; }
    .switch { position: relative; width: 44px; height: 26px; flex-shrink: 0; }
    .switch input { opacity: 0; width: 0; height: 0; }
    .slider { position: absolute; cursor: pointer; inset: 0; background: #d0d0d5; border-radius: 26px; transition: .2s; }
    .slider:before { position: absolute; content: ""; height: 20px; width: 20px; left: 3px; top: 3px; background: white; border-radius: 50%; transition: .2s; }
    input:checked + .slider { background: #2a82ff; }
    input:checked + .slider:before { transform: translateX(18px); }
    button { font: inherit; padding: 8px 14px; border-radius: 8px; border: 1px solid #ccd; background: #fff; cursor: pointer; }
    button.primary { background: #111; color: #fff; border-color: #111; }
    button.danger { color: #c0392b; border-color: #e8c5c0; }
    button:hover:not(:disabled) { opacity: .9; }
    button:disabled { opacity: .5; cursor: not-allowed; }
    .actions { display: flex; gap: 8px; padding: 12px 0; }
    .empty { text-align: center; color: #888; padding: 32px 0; font-size: 14px; }
    .status { font-size: 12px; color: #888; text-align: center; margin: 16px 0; min-height: 18px; }
    .status.err { color: #c0392b; }
    dialog { border: none; border-radius: 12px; padding: 0; max-width: 480px; width: calc(100% - 32px); box-shadow: 0 20px 60px rgba(0,0,0,.18); }
    dialog::backdrop { background: rgba(0,0,0,.4); }
    dialog form { padding: 20px; display: flex; flex-direction: column; gap: 12px; }
    dialog h2 { margin: 0; font-size: 18px; }
    dialog label { font-size: 13px; display: block; margin-bottom: 4px; color: #444; }
    dialog input, dialog textarea { width: 100%; padding: 8px 10px; border: 1px solid #ccd; border-radius: 6px; font: inherit; font-size: 14px; }
    dialog textarea { resize: vertical; min-height: 60px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    dialog .desc { font-size: 11px; color: #888; margin-top: 4px; }
    dialog .footer { display: flex; gap: 8px; justify-content: flex-end; margin-top: 4px; }
    .add-btn { display: block; width: 100%; padding: 12px; border: 1px dashed #c8c8d0; border-radius: 12px; background: transparent; color: #444; font-size: 14px; cursor: pointer; margin-bottom: 16px; }
    .add-btn:hover { background: #fafafb; border-color: #2a82ff; color: #2a82ff; }
  </style>
</head>
<body>
  <h1>Instagram Webhook Admin</h1>
  <p class="hint">Toggles apply on the next incoming webhook event. No redeploy needed.</p>

  <div id="accounts"></div>
  <button class="add-btn" id="add-btn">+ Add Account</button>

  <div class="status" id="status">Loading…</div>

  <dialog id="add-dialog">
    <form id="add-form">
      <h2>Add Instagram account</h2>
      <div>
        <label for="ig_user_id">IG User ID</label>
        <input id="ig_user_id" name="ig_user_id" required placeholder="17841430139279168" />
        <div class="desc">The 17-digit Instagram account ID (sent as <code>entry.id</code> in webhooks).</div>
      </div>
      <div>
        <label for="access_token">Access Token</label>
        <textarea id="access_token" name="access_token" required placeholder="IGAA..." rows="3"></textarea>
        <div class="desc">Long-lived IG access token. Must have basic + comments + messages permissions.</div>
      </div>
      <div>
        <label for="app_link">App Link</label>
        <input id="app_link" name="app_link" required placeholder="https://example.com/?ref=handle" />
        <div class="desc">Sent in the DM body.</div>
      </div>
      <div>
        <label for="brand_mention">Brand Mention (optional)</label>
        <input id="brand_mention" name="brand_mention" placeholder="@yourbrand" />
        <div class="desc">If set, the public reply mentions this handle (e.g. "It's @yourbrand 📩"). Leave blank for neutral copy.</div>
      </div>
      <div class="footer">
        <button type="button" id="add-cancel">Cancel</button>
        <button type="submit" class="primary" id="add-submit">Add</button>
      </div>
    </form>
  </dialog>

  <script>
    const $status = document.getElementById('status');
    const $accounts = document.getElementById('accounts');
    const $addBtn = document.getElementById('add-btn');
    const $dialog = document.getElementById('add-dialog');
    const $form = document.getElementById('add-form');
    const $submit = document.getElementById('add-submit');
    const $cancel = document.getElementById('add-cancel');

    function setStatus(msg, isError = false) {
      $status.textContent = msg;
      $status.classList.toggle('err', isError);
    }

    function escapeHtml(s) {
      return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    }

    function renderAccount(a) {
      const id = escapeHtml(a.id);
      const username = escapeHtml(a.username);
      const appLink = escapeHtml(a.app_link);
      const brand = a.brand_mention ? \`brand: \${escapeHtml(a.brand_mention)} · \` : '';
      return \`
        <div class="card" data-id="\${id}">
          <h2>@\${username}</h2>
          <div class="meta">\${brand}id: \${id} · token: \${escapeHtml(a.access_token_preview || 'n/a')}</div>
          <div class="row">
            <div>
              <div class="label">Paused</div>
              <div class="desc">Ignore all incoming comments. No DM, no reply.</div>
            </div>
            <label class="switch"><input type="checkbox" data-field="paused" \${a.paused ? 'checked' : ''} /><span class="slider"></span></label>
          </div>
          <div class="row">
            <div>
              <div class="label">Skip DMs</div>
              <div class="desc">Only post the public reply, don't send a private DM.</div>
            </div>
            <label class="switch"><input type="checkbox" data-field="dm_disabled" \${a.dm_disabled ? 'checked' : ''} /><span class="slider"></span></label>
          </div>
          <div class="actions">
            <button class="danger" data-action="delete">Remove account</button>
          </div>
        </div>
      \`;
    }

    async function load() {
      try {
        const res = await fetch('/api/admin/accounts');
        if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + await res.text());
        const accounts = await res.json();
        if (!accounts.length) {
          $accounts.innerHTML = '<div class="empty">No accounts yet — click + Add Account below to get started.</div>';
        } else {
          $accounts.innerHTML = accounts.map(renderAccount).join('');
        }
        bindCardEvents();
        setStatus('Synced at ' + new Date().toLocaleTimeString());
      } catch (err) {
        setStatus('Failed to load: ' + err.message, true);
      }
    }

    function bindCardEvents() {
      for (const input of $accounts.querySelectorAll('input[data-field]')) {
        input.addEventListener('change', async () => {
          const card = input.closest('.card');
          const id = card.dataset.id;
          const field = input.dataset.field;
          const value = input.checked;
          setStatus('Saving…');
          try {
            const res = await fetch(\`/api/admin/accounts?id=\${encodeURIComponent(id)}\`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ [field]: value }),
            });
            if (!res.ok) throw new Error(await res.text());
            setStatus('Saved at ' + new Date().toLocaleTimeString());
          } catch (err) {
            setStatus('Save failed: ' + err.message, true);
            input.checked = !value; // revert
          }
        });
      }
      for (const btn of $accounts.querySelectorAll('button[data-action="delete"]')) {
        btn.addEventListener('click', async () => {
          const card = btn.closest('.card');
          const id = card.dataset.id;
          if (!confirm('Remove this account from the dashboard? The IG account stays connected on the Meta side — only the local config is deleted.')) return;
          setStatus('Removing…');
          try {
            const res = await fetch(\`/api/admin/accounts?id=\${encodeURIComponent(id)}\`, { method: 'DELETE' });
            if (!res.ok) throw new Error(await res.text());
            await load();
          } catch (err) {
            setStatus('Remove failed: ' + err.message, true);
          }
        });
      }
    }

    $addBtn.addEventListener('click', () => {
      $form.reset();
      $dialog.showModal();
    });

    $cancel.addEventListener('click', () => $dialog.close());

    $form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData($form);
      const payload = {
        ig_user_id: fd.get('ig_user_id').toString().trim(),
        access_token: fd.get('access_token').toString().trim(),
        app_link: fd.get('app_link').toString().trim(),
        brand_mention: fd.get('brand_mention').toString().trim() || null,
      };
      $submit.disabled = true;
      $submit.textContent = 'Verifying…';
      setStatus('Verifying token and subscribing to webhooks…');
      try {
        const res = await fetch('/api/admin/accounts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error(await res.text());
        $dialog.close();
        await load();
        setStatus('Account added at ' + new Date().toLocaleTimeString());
      } catch (err) {
        setStatus('Add failed: ' + err.message, true);
      } finally {
        $submit.disabled = false;
        $submit.textContent = 'Add';
      }
    });

    load();
  </script>
</body>
</html>`;

export default function handler(req, res) {
  if (!checkBasicAuth(req)) return sendAuthChallenge(res);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  return res.status(200).send(HTML);
}
