import { checkBasicAuth, sendAuthChallenge } from "../../lib/auth.js";

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Webhook Admin</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    * { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, system-ui, sans-serif; max-width: 560px; margin: 32px auto; padding: 0 20px; color: #111; }
    h1 { font-size: 22px; margin: 0 0 6px; }
    h2 { font-size: 16px; margin: 0 0 12px; color: #444; }
    .hint { font-size: 12px; color: #888; margin-bottom: 24px; }
    .account { border: 1px solid #e3e3e8; border-radius: 12px; padding: 6px 20px; margin-bottom: 16px; background: #fff; }
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
    .status { font-size: 12px; color: #888; text-align: center; margin-top: 16px; min-height: 18px; }
    .status.err { color: #c0392b; }
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

  <div class="status" id="status">Loading…</div>

  <script>
    const status = document.getElementById('status');
    const inputs = document.querySelectorAll('input[data-flag]');

    function setStatus(text, isError = false) {
      status.textContent = text;
      status.classList.toggle('err', isError);
    }

    async function load() {
      try {
        const res = await fetch('/api/admin/state');
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const flags = await res.json();
        for (const input of inputs) input.checked = !!flags[input.dataset.flag];
        setStatus('Synced at ' + new Date().toLocaleTimeString());
      } catch (err) {
        setStatus('Failed to load: ' + err.message, true);
      }
    }

    async function toggle(flag, value) {
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
        load();
      }
    }

    for (const input of inputs) {
      input.addEventListener('change', () => toggle(input.dataset.flag, input.checked));
    }

    load();
  </script>
</body>
</html>`;

export default function handler(req, res) {
  if (!checkBasicAuth(req)) return sendAuthChallenge(res);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  return res.status(200).send(HTML);
}
