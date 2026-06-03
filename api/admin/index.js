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
    h2 { font-size: 16px; margin: 12px 0; color: #444; }
    h3 { font-size: 13px; font-weight: 600; color: #666; text-transform: uppercase; letter-spacing: .04em; margin: 32px 0 12px; }
    .hint { font-size: 12px; color: #888; margin-bottom: 24px; }
    .account { border: 1px solid #e3e3e8; border-radius: 12px; padding: 6px 20px; margin-bottom: 16px; background: #fff; }
    .account .meta { font-size: 12px; color: #888; margin: -4px 0 8px; }
    .toggle { display: flex; align-items: center; justify-content: space-between; padding: 14px 0; border-bottom: 1px solid #f3f3f5; gap: 16px; }
    .toggle:last-child { border-bottom: none; }
    .toggle .label { font-size: 14px; font-weight: 500; }
    .toggle .desc { font-size: 12px; color: #888; margin-top: 2px; }
    .switch { position: relative; width: 44px; height: 26px; flex-shrink: 0; }
    .switch input { opacity: 0; width: 0; height: 0; }
    .slider { position: absolute; cursor: pointer; inset: 0; background: #d0d0d5; border-radius: 26px; transition: .2s; }
    .slider:before { position: absolute; content: ""; height: 20px; width: 20px; left: 3px; top: 3px; background: white; border-radius: 50%; transition: .2s; }
    input:checked + .slider { background: #2a82ff; }
    input:checked + .slider:before { transform: translateX(18px); }
    input:disabled + .slider { opacity: .5; cursor: not-allowed; }
    button { font: inherit; padding: 8px 14px; border-radius: 8px; border: 1px solid #ccd; background: #fff; cursor: pointer; }
    button.primary { background: #111; color: #fff; border-color: #111; }
    button.danger { color: #c0392b; border-color: #e8c5c0; }
    button:hover:not(:disabled) { opacity: .9; }
    button:disabled { opacity: .5; cursor: not-allowed; }
    .actions { display: flex; gap: 8px; padding: 12px 0; }
    .empty { text-align: center; color: #999; padding: 24px 0; font-size: 13px; font-style: italic; }
    .status { font-size: 12px; color: #888; text-align: center; margin: 16px 0; min-height: 18px; }
    .status.err { color: #c0392b; }
    .add-btn { display: block; width: 100%; padding: 12px; border: 1px dashed #c8c8d0; border-radius: 12px; background: transparent; color: #444; font-size: 14px; cursor: pointer; margin-bottom: 16px; }
    .add-btn:hover { background: #fafafb; border-color: #2a82ff; color: #2a82ff; }
    dialog { border: none; border-radius: 12px; padding: 0; max-width: 480px; width: calc(100% - 32px); box-shadow: 0 20px 60px rgba(0,0,0,.18); }
    dialog::backdrop { background: rgba(0,0,0,.4); }
    dialog form { padding: 20px; display: flex; flex-direction: column; gap: 12px; }
    dialog h2 { margin: 0; font-size: 18px; }
    dialog label { font-size: 13px; display: block; margin-bottom: 4px; color: #444; }
    dialog input, dialog textarea { width: 100%; padding: 8px 10px; border: 1px solid #ccd; border-radius: 6px; font: inherit; font-size: 14px; }
    dialog textarea { resize: vertical; min-height: 60px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    dialog .desc { font-size: 11px; color: #888; margin-top: 4px; }
    dialog .footer { display: flex; gap: 8px; justify-content: flex-end; margin-top: 4px; }
  </style>
</head>
<body>
  <h1>Instagram Webhook Admin</h1>
  <p class="hint">Toggles apply on the next incoming webhook event. No redeploy needed.</p>

  <div class="account">
    <h2>riddhiii.travels</h2>
    <div class="toggle">
      <div>
        <div class="label">Paused</div>
        <div class="desc">Ignore all incoming comments. No DM, no reply.</div>
      </div>
      <label class="switch"><input type="checkbox" data-flag="riddhi_paused" /><span class="slider"></span></label>
    </div>
    <div class="toggle">
      <div>
        <div class="label">Skip DMs</div>
        <div class="desc">Only post the public reply, don't send a private DM.</div>
      </div>
      <label class="switch"><input type="checkbox" data-flag="riddhi_dm_disabled" /><span class="slider"></span></label>
    </div>
  </div>

  <div class="account">
    <h2>hersheytravels2</h2>
    <div class="toggle">
      <div>
        <div class="label">Paused</div>
        <div class="desc">Ignore all incoming comments. No DM, no reply.</div>
      </div>
      <label class="switch"><input type="checkbox" data-flag="hershey_paused" /><span class="slider"></span></label>
    </div>
    <div class="toggle">
      <div>
        <div class="label">Skip DMs</div>
        <div class="desc">Only post the public reply, don't send a private DM.</div>
      </div>
      <label class="switch"><input type="checkbox" data-flag="hershey_dm_disabled" /><span class="slider"></span></label>
    </div>
  </div>

  <h3>More accounts</h3>
  <div id="extra-accounts"><div class="empty">No additional accounts yet.</div></div>
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
        <div class="desc">If set, the public reply mentions this handle. Leave blank for neutral copy.</div>
      </div>
      <div class="footer">
        <button type="button" id="add-cancel">Cancel</button>
        <button type="submit" class="primary" id="add-submit">Add</button>
      </div>
    </form>
  </dialog>

  <dialog id="links-dialog">
    <div style="padding:20px;display:flex;flex-direction:column;gap:12px;">
      <h2 style="margin:0;font-size:18px;">Per-post link overrides</h2>
      <div class="desc" id="links-subtitle" style="font-size:12px;color:#888;"></div>
      <div id="links-body" style="max-height:60vh;overflow:auto;display:flex;flex-direction:column;gap:8px;"></div>
      <div class="footer" style="display:flex;justify-content:flex-end;">
        <button type="button" id="links-close" class="primary">Done</button>
      </div>
    </div>
  </dialog>

  <script>
    const $status = document.getElementById('status');
    const $extra = document.getElementById('extra-accounts');
    const flagInputs = document.querySelectorAll('input[data-flag]');
    const $addBtn = document.getElementById('add-btn');
    const $dialog = document.getElementById('add-dialog');
    const $form = document.getElementById('add-form');
    const $submit = document.getElementById('add-submit');
    const $cancel = document.getElementById('add-cancel');

    function setStatus(text, isError = false) {
      $status.textContent = text;
      $status.classList.toggle('err', isError);
    }

    function escapeHtml(s) {
      return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    }

    function renderExtraAccount(a) {
      const id = escapeHtml(a.id);
      const username = escapeHtml(a.username);
      const brand = a.brand_mention ? \`brand: \${escapeHtml(a.brand_mention)} · \` : '';
      return \`
        <div class="account" data-id="\${id}">
          <h2>@\${username}</h2>
          <div class="meta">\${brand}id: \${id} · token: \${escapeHtml(a.access_token_preview || 'n/a')}</div>
          <div class="toggle">
            <div>
              <div class="label">Paused</div>
              <div class="desc">Ignore all incoming comments. No DM, no reply.</div>
            </div>
            <label class="switch"><input type="checkbox" data-extra="paused" \${a.paused ? 'checked' : ''} /><span class="slider"></span></label>
          </div>
          <div class="toggle">
            <div>
              <div class="label">Skip DMs</div>
              <div class="desc">Only post the public reply, don't send a private DM.</div>
            </div>
            <label class="switch"><input type="checkbox" data-extra="dm_disabled" \${a.dm_disabled ? 'checked' : ''} /><span class="slider"></span></label>
          </div>
          <div class="actions">
            <button data-action="post-links">Post links</button>
            <button class="danger" data-action="delete">Remove account</button>
          </div>
        </div>
      \`;
    }

    async function loadFlags() {
      const res = await fetch('/api/admin/state');
      if (!res.ok) throw new Error('flags HTTP ' + res.status);
      const flags = await res.json();
      for (const input of flagInputs) input.checked = !!flags[input.dataset.flag];
    }

    async function loadAccounts() {
      const res = await fetch('/api/admin/accounts');
      if (!res.ok) throw new Error('accounts HTTP ' + res.status);
      const accounts = await res.json();
      if (!accounts.length) {
        $extra.innerHTML = '<div class="empty">No additional accounts yet.</div>';
      } else {
        $extra.innerHTML = accounts.map(renderExtraAccount).join('');
      }
      bindExtraEvents();
    }

    async function load() {
      try {
        await Promise.all([loadFlags(), loadAccounts()]);
        setStatus('Synced at ' + new Date().toLocaleTimeString());
      } catch (err) {
        setStatus('Failed to load: ' + err.message, true);
      }
    }

    async function toggleFlag(flag, value) {
      setStatus('Saving…');
      try {
        const res = await fetch('/api/admin/toggle', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: flag, value }),
        });
        if (!res.ok) throw new Error(await res.text());
        setStatus('Saved at ' + new Date().toLocaleTimeString());
      } catch (err) {
        setStatus('Save failed: ' + err.message, true);
        loadFlags();
      }
    }

    function bindExtraEvents() {
      for (const input of $extra.querySelectorAll('input[data-extra]')) {
        input.addEventListener('change', async () => {
          const card = input.closest('.account');
          const id = card.dataset.id;
          const field = input.dataset.extra;
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
            input.checked = !value;
          }
        });
      }
      for (const btn of $extra.querySelectorAll('button[data-action="delete"]')) {
        btn.addEventListener('click', async () => {
          const card = btn.closest('.account');
          const id = card.dataset.id;
          if (!confirm('Remove this account from the dashboard? The IG account stays connected on the Meta side — only this local config is deleted.')) return;
          setStatus('Removing…');
          try {
            const res = await fetch(\`/api/admin/accounts?id=\${encodeURIComponent(id)}\`, { method: 'DELETE' });
            if (!res.ok) throw new Error(await res.text());
            await loadAccounts();
          } catch (err) {
            setStatus('Remove failed: ' + err.message, true);
          }
        });
      }
      for (const btn of $extra.querySelectorAll('button[data-action="post-links"]')) {
        btn.addEventListener('click', () => openPostLinks(btn.closest('.account').dataset.id));
      }
    }

    const $linksDialog = document.getElementById('links-dialog');
    const $linksBody = document.getElementById('links-body');
    const $linksSubtitle = document.getElementById('links-subtitle');
    document.getElementById('links-close').addEventListener('click', () => $linksDialog.close());

    async function openPostLinks(accountId) {
      $linksBody.innerHTML = '<div class="empty">Loading recent posts…</div>';
      $linksSubtitle.textContent = '';
      $linksDialog.showModal();
      try {
        const res = await fetch(\`/api/admin/post-links?account_id=\${encodeURIComponent(accountId)}\`);
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        $linksSubtitle.textContent = \`@\${data.account.username} · default link: \${data.account.app_link}\${data.media_error ? ' · Media fetch failed: ' + data.media_error : ''}\`;
        if (!data.media.length) {
          $linksBody.innerHTML = '<div class="empty">No recent media returned by the Graph API.</div>';
          return;
        }
        // Un-linked posts first, then linked. Within each group, Graph already
        // gives us newest first.
        const unlinked = data.media.filter((m) => !data.links[m.id]);
        const linked = data.media.filter((m) => data.links[m.id]);
        const ordered = [...unlinked, ...linked];
        $linksBody.innerHTML = ordered.map((m) => {
          const isLinked = !!data.links[m.id];
          const currentLink = data.links[m.id] || '';
          const caption = (m.caption || '').replace(/\\s+/g, ' ').trim();
          const shortCap = caption.length > 80 ? caption.slice(0, 80) + '…' : caption;
          const thumb = m.thumbnail_url || m.media_url || '';
          return \`
            <div data-media-id="\${escapeHtml(m.id)}" style="display:flex;gap:12px;padding:10px;border:1px solid \${isLinked ? '#cde8ff' : '#e3e3e8'};border-radius:8px;background:\${isLinked ? '#f5fbff' : '#fff'};">
              <div style="flex-shrink:0;width:56px;height:56px;border-radius:6px;background:#f0f0f3 center/cover no-repeat;\${thumb ? \`background-image:url('\${escapeHtml(thumb)}');\` : ''}"></div>
              <div style="flex:1;min-width:0;">
                <div style="font-size:11px;color:#888;display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
                  <span>\${escapeHtml(m.media_type || '')}</span>
                  \${isLinked ? '<span style="color:#2a82ff;font-weight:600;">· Linked ✓</span>' : ''}
                  <span>·</span>
                  <a href="\${escapeHtml(m.permalink || '#')}" target="_blank" rel="noopener" style="color:#2a82ff;">view on IG</a>
                </div>
                <div style="font-size:12px;margin:4px 0 6px;color:#444;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">\${escapeHtml(shortCap || '(no caption)')}</div>
                <div style="display:flex;gap:6px;align-items:center;">
                  <input type="url" placeholder="(uses account default)" value="\${escapeHtml(currentLink)}" data-post-link style="flex:1;padding:5px 8px;border:1px solid #ccd;border-radius:5px;font-size:12px;min-width:0;" />
                  <button data-clear type="button" \${currentLink ? '' : 'disabled'} style="font-size:12px;padding:5px 8px;">Clear</button>
                </div>
              </div>
            </div>
          \`;
        }).join('');
        bindPostLinkEvents(accountId);
      } catch (err) {
        $linksBody.innerHTML = '<div class="empty" style="color:#c0392b;">Failed: ' + escapeHtml(err.message) + '</div>';
      }
    }

    function bindPostLinkEvents(accountId) {
      for (const input of $linksBody.querySelectorAll('input[data-post-link]')) {
        let original = input.value;
        const card = input.closest('[data-media-id]');
        const mediaId = card.dataset.mediaId;
        const clearBtn = card.querySelector('button[data-clear]');
        async function save() {
          const value = input.value.trim();
          if (value === original) return;
          if (!value) return; // empty doesn't save; use Clear to delete
          setStatus('Saving…');
          try {
            const res = await fetch('/api/admin/post-links', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ account_id: accountId, media_id: mediaId, link: value }),
            });
            if (!res.ok) throw new Error(await res.text());
            original = value;
            clearBtn.disabled = false;
            setStatus('Saved at ' + new Date().toLocaleTimeString());
          } catch (err) {
            setStatus('Save failed: ' + err.message, true);
            input.value = original;
          }
        }
        input.addEventListener('blur', save);
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
        clearBtn.addEventListener('click', async () => {
          if (!original) return;
          setStatus('Removing…');
          try {
            const res = await fetch(\`/api/admin/post-links?account_id=\${encodeURIComponent(accountId)}&media_id=\${encodeURIComponent(mediaId)}\`, { method: 'DELETE' });
            if (!res.ok) throw new Error(await res.text());
            input.value = '';
            original = '';
            clearBtn.disabled = true;
            setStatus('Removed at ' + new Date().toLocaleTimeString());
          } catch (err) {
            setStatus('Remove failed: ' + err.message, true);
          }
        });
      }
    }

    for (const input of flagInputs) {
      input.addEventListener('change', () => toggleFlag(input.dataset.flag, input.checked));
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
        await loadAccounts();
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
