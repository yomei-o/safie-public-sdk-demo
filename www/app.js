// Safie OAuth2.0 Public client (PKCE) sample — browser side.
//
// Flow (all handled by the Safie SDK, see https://safie.link/sdk/js/api/v1/latest/doc/):
//   1. Safie.Auth.authorize({clientId, redirectUri, scope})
//        -> generates code_verifier/code_challenge, stores them, navigates to the
//           Safie login page (GET https://openapi.safie.link/v2/auth/authorize).
//   2. Safie redirects back to redirectUri with ?code=...&state=...
//   3. Safie.Auth.initialize({clientId})
//        -> exchanges the code for tokens (POST /v2/auth/token with code_verifier),
//           strips code/state from the URL, and restores a saved session on reload.
//   4. Safie.Devices.* calls use the stored access token. With enableTokenRefresh
//        the SDK refreshes the access token with the refresh token automatically.
//
// The SDK talks to the API from an iframe on https://safie.link, which is why the
// page itself never has to deal with CORS or with the token endpoint.

(() => {
  'use strict';

  const STORAGE_KEY = 'safie-oauth-sample-config';
  // Redirect back to this very page (directory form, without query/hash), so the
  // same code works at http://localhost:8080/ and under a sub-path such as
  // https://<user>.github.io/<repo>/www/. Register exactly this URL in Safie Developers.
  const REDIRECT_URI = location.href.split(/[?#]/)[0].replace(/index\.html$/, '');

  const $ = (id) => document.getElementById(id);
  const ui = {
    redirectUri: $('redirect-uri'),
    clientId: $('client-id'),
    scope: $('scope'),
    save: $('btn-save'),
    login: $('btn-login'),
    logout: $('btn-logout'),
    status: $('status-text'),
    devices: $('devices'),
    deviceCount: $('device-count'),
    deviceRows: $('device-rows'),
    reload: $('btn-reload'),
    thumbs: $('btn-thumbs'),
    playerSection: $('player-section'),
    playerDevice: $('player-device'),
    playerEl: $('player'),
    playerStatus: $('player-status'),
    stop: $('btn-stop'),
    pause: $('btn-pause'),
    webrtc: $('chk-webrtc'),
    muted: $('chk-muted'),
  };

  let devices = [];
  let player = null; // Safie.Player.StreamingPlayer, created on first play

  // ---- config -------------------------------------------------------------

  function loadConfig() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (_) { /* storage unavailable or corrupt */ }
    return { clientId: defaultClientId(), scope: 'safie-api openid' };
  }

  // Each Redirect URI needs its own Client in Safie Developers, so the default
  // Client ID depends on where the page is served from.
  function defaultClientId() {
    if (location.hostname === 'yomei-o.github.io') return 'aqgp10u8rx94';
    if (location.hostname === 'localhost') return 'p557a696h2md';
    return '';
  }

  function saveConfig(cfg) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg)); } catch (_) { /* ignore */ }
  }

  function readForm() {
    return { clientId: ui.clientId.value.trim(), scope: ui.scope.value.trim() };
  }

  // ---- status -------------------------------------------------------------

  function setStatus(lines) {
    ui.status.textContent = Array.isArray(lines) ? lines.join('\n') : String(lines);
  }

  function describeError(err) {
    if (!err) return 'unknown error';
    // SDK errors are ErrorDetail objects: { type, message, ... }
    if (typeof err === 'object' && 'type' in err) {
      return (err.type + ': ' + (err.message || '')).trim();
    }
    return err.message || String(err);
  }

  function decodeJwtPayload(jwt) {
    try {
      const b64 = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch (_) { return null; }
  }

  // ---- auth ---------------------------------------------------------------

  async function login() {
    const cfg = readForm();
    if (!cfg.clientId) { setStatus('Client ID を入力してください'); return; }
    saveConfig(cfg);
    setStatus('Safie のログイン画面へ移動します…');
    try {
      await Safie.Auth.authorize({
        clientId: cfg.clientId,
        redirectUri: REDIRECT_URI,
        scope: cfg.scope,
        rememberMe: true,          // keep the session after the tab is closed
        enableTokenRefresh: true,  // SDK refreshes the access token automatically
      });
      // authorize() navigates away; nothing runs after this on success.
    } catch (err) {
      setStatus(['authorize に失敗しました', describeError(err)]);
    }
  }

  async function logout() {
    try { await Safie.Auth.removeToken(); } catch (_) { /* ignore */ }
    location.replace(REDIRECT_URI);
  }

  // Returns true when a session is available.
  async function initialize(cfg) {
    if (!cfg.clientId) {
      setStatus('Client ID を設定して「保存」→「Safie でログイン」を押してください');
      ui.login.disabled = true;
      return false;
    }
    ui.login.disabled = false;

    // If Safie bounced us back with an OAuth error (bad scope, missing PKCE, ...)
    // the query string carries error / error_description. Show them.
    const q = new URLSearchParams(location.search);
    if (q.has('error')) {
      setStatus(['認可エラー', q.get('error') + ': ' + (q.get('error_description') || '')]);
      history.replaceState(null, '', REDIRECT_URI);
      return false;
    }

    setStatus('認証情報を初期化中…');
    try {
      const result = await Safie.Auth.initialize({ clientId: cfg.clientId });
      const lines = ['ログイン済み (tokenType: ' + result.tokenType + ')'];
      if (result.idToken) {
        const p = decodeJwtPayload(result.idToken);
        if (p) {
          lines.push('sub: ' + p.sub);
          if (p.email) lines.push('email: ' + p.email);
          lines.push('id_token exp: ' + new Date(p.exp * 1000).toLocaleString());
        }
      }
      setStatus(lines);
      ui.logout.disabled = false;
      return true;
    } catch (err) {
      if (err && err.type === 'authorization_required') {
        setStatus('未ログインです。「Safie でログイン」を押してください');
      } else {
        setStatus(['initialize に失敗しました', describeError(err)]);
      }
      return false;
    }
  }

  // ---- devices ------------------------------------------------------------

  async function fetchAllDevices() {
    const all = [];
    let offset = 0;
    for (;;) {
      const r = await Safie.Devices.queryDevices({ limit: 100, offset: offset });
      all.push(...r.list);
      if (!r.hasNext || r.count === 0) break;
      offset += r.count;
    }
    return all;
  }

  function renderDevices() {
    ui.deviceRows.replaceChildren();
    for (const d of devices) {
      const tr = document.createElement('tr');
      const cells = [
        '',
        d.setting && d.setting.name,
        d.deviceId,
        d.model && d.model.description,
        d.serial,
        d.status && d.status.videoStreaming ? '●' : '-',
        d.status && d.status.serverConnecting ? '●' : '-',
        null, // play button
      ];
      cells.forEach((v, i) => {
        const td = document.createElement('td');
        if (i === 0) {
          const img = document.createElement('img');
          img.alt = '';
          img.dataset.deviceId = d.deviceId;
          td.appendChild(img);
        } else if (i === cells.length - 1) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.textContent = '再生';
          btn.addEventListener('click', () => playDevice(d));
          td.appendChild(btn);
        } else {
          td.textContent = v == null ? '' : String(v);
        }
        tr.appendChild(td);
      });
      ui.deviceRows.appendChild(tr);
    }
    ui.deviceCount.textContent = '(' + devices.length + ')';
    ui.devices.hidden = false;
  }

  async function loadDevices() {
    setStatus('デバイス一覧を取得中…');
    try {
      devices = await fetchAllDevices();
      renderDevices();
      setStatus('デバイス一覧を取得しました: ' + devices.length + ' 台');
    } catch (err) {
      setStatus(['デバイス一覧の取得に失敗しました', describeError(err)]);
    }
  }

  // Thumbnails are fetched one device at a time; a device that is not streaming
  // returns an error (400) and is simply skipped.
  async function loadThumbnails() {
    const imgs = ui.deviceRows.querySelectorAll('img[data-device-id]');
    let ok = 0, ng = 0;
    for (const img of imgs) {
      try {
        const blob = await Safie.Devices.queryThumbnail({ deviceId: img.dataset.deviceId });
        if (img.src) URL.revokeObjectURL(img.src);
        img.src = URL.createObjectURL(blob);
        ok++;
      } catch (err) {
        img.title = describeError(err);
        ng++;
      }
    }
    setStatus('サムネイル: 成功 ' + ok + ' / 失敗 ' + ng);
  }

  // ---- live video ---------------------------------------------------------
  //
  // Safie.Player.StreamingPlayer renders into a host element and streams the
  // device's video (HLS by default, WebRTC for low latency). play() without a
  // timestamp means LIVE; play(unixMillis) plays back recorded video.
  // Requires scope safie-api (or api:device:live:view + api:device:timeline:view)
  // and the "ストリーミング SDK" device option (not needed on the trial plan).

  function setPlayerStatus(text) {
    ui.playerStatus.textContent = text;
  }

  function destroyPlayer() {
    if (!player) return;
    try { player.dispose(); } catch (_) { /* ignore */ }
    player = null;
    ui.playerEl.replaceChildren();
  }

  function createPlayer(deviceId) {
    const p = new Safie.Player.StreamingPlayer(ui.playerEl, {
      deviceId: deviceId,
      muted: ui.muted.checked,
      liveBroadcastMode: ui.webrtc.checked ? 'webrtc' : 'hls',
    });
    p.on('statusChange', (ev) => {
      let line = 'status: ' + ev.status;
      if (ev.context && ev.context.streamingMode) line += ' (' + ev.context.streamingMode + ')';
      if (ev.context && ev.context.error) line += '\n' + describeError(ev.context.error);
      setPlayerStatus(line);
    });
    p.on('playTimeChange', (ts) => {
      ui.playerDevice.title = new Date(ts).toLocaleString();
    });
    return p;
  }

  function playDevice(d) {
    ui.playerSection.hidden = false;
    ui.playerDevice.textContent = '- ' + ((d.setting && d.setting.name) || d.deviceId);
    try {
      if (!player) {
        player = createPlayer(d.deviceId);
      } else if (player.deviceId !== d.deviceId) {
        player.deviceId = d.deviceId; // setter stops the current stream
      }
      player.muted = ui.muted.checked;
      player.play(); // no timestamp -> LIVE
      setPlayerStatus('status: loading');
      ui.playerSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      setPlayerStatus('再生に失敗しました\n' + describeError(err));
    }
  }

  function stopPlayer() {
    if (player) player.stop();
  }

  function togglePause() {
    if (!player) return;
    if (player.status === 'paused') player.unpause();
    else player.pause();
  }

  // ---- wiring -------------------------------------------------------------

  async function main() {
    ui.redirectUri.textContent = REDIRECT_URI;

    const cfg = loadConfig();
    ui.clientId.value = cfg.clientId;
    ui.scope.value = cfg.scope;

    ui.save.addEventListener('click', () => {
      saveConfig(readForm());
      ui.login.disabled = !readForm().clientId;
      setStatus('設定を保存しました');
    });
    ui.login.addEventListener('click', login);
    ui.logout.addEventListener('click', logout);
    ui.reload.addEventListener('click', loadDevices);
    ui.thumbs.addEventListener('click', loadThumbnails);
    ui.stop.addEventListener('click', stopPlayer);
    ui.pause.addEventListener('click', togglePause);
    ui.muted.addEventListener('change', () => { if (player) player.muted = ui.muted.checked; });
    // liveBroadcastMode is fixed at construction: drop the player so the next
    // 再生 click rebuilds it with the new mode.
    ui.webrtc.addEventListener('change', destroyPlayer);

    if (typeof Safie === 'undefined') {
      setStatus('Safie SDK の読み込みに失敗しました (https://safie.link/sdk/js/api/v1/latest/ に到達できません)');
      return;
    }
    if (!window.isSecureContext) {
      setStatus('このページは secure context ではありません。SDK は Web Crypto を使うため http://localhost か https で開いてください');
      return;
    }

    if (await initialize(cfg)) {
      await loadDevices();
    }
  }

  main();
})();
