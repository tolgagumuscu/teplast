/**
 * storage.js — Sunucu destekli merkezi depolama v2
 *
 * Özellikler:
 *   - Tüm veriler proxy/teplast.db (SQLite) içinde tutulur
 *   - Şifre sync'lenmeden önce XOR+base64 ile obfuscate edilir
 *   - proxyUrl makineye özgüdür, sync'lenmez
 *   - Her 30 saniyede bir otomatik kontrol
 *   - Scan log sunucuya kaydedilir
 */
const Storage = (() => {
  const K = {
    ORDERS:   'teplast_orders',
    SETTINGS: 'teplast_settings',
    SEEN_IDS: 'teplast_seen_ids',
    BLOCKED:  'teplast_blocked',
  };

  const log  = (...a) => console.log('[Storage]', ...a);
  const warn = (...a) => console.warn('[Storage]', ...a);

  // Render'da aynı origin; LAN modunda proxy IP:port ayrı olabilir
  // Önce localStorage'da kayıtlı proxyUrl'e bak, yoksa sayfanın kendi origin'i
  const _savedProxy = (() => { try { const s=JSON.parse(localStorage.getItem('teplast_settings')||'{}'); return s.proxyUrl||null; } catch { return null; } })();
  const PROXY_URL = _savedProxy || (
    window.location.protocol === 'file:'
      ? 'http://localhost:3131'
      : window.location.origin
  );

  let _lastSyncTime = null;
  let _syncPending  = false;
  let _syncTimer    = null;

  // ── localStorage ────────────────────────────────
  function _lsGet(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  }
  function _lsSet(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
  }

  // Şifreleme sunucu tarafında (AES-256-GCM) yapılıyor.
  // Client sadece düz metin gönderir, sunucu Redis'e şifreli kaydeder.
  // getSettings() sunucudan çözülmüş hali alır.
  function _obfuscate(str) { return str; }   // artık no-op
  function _deobfuscate(str) { return str; } // artık no-op

  // ── Sunucu iletişimi ─────────────────────────────
  async function _fetch(path, opts) {
    return fetch(`${PROXY_URL}${path}`, opts);
  }

  async function _fetchFromServer() {
    const res = await _fetch('/sync', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async function _pushToServer(data) {
    if (_syncPending) return;
    _syncPending = true;
    try {
      const res = await _fetch('/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        const r = await res.json();
        _lastSyncTime = r.updatedAt;
      } else warn('Push hatası:', res.status);
    } catch (e) {
      warn('Bağlantı hatası:', e.message);
    } finally {
      _syncPending = false;
    }
  }

  // proxyUrl'yi dışla, şifreyi obfuscate et
  function _pushAll() {
    const raw = _lsGet(K.SETTINGS, {});
    const settingsToSync = { ...raw };
    delete settingsToSync.proxyUrl; // makineye özgü
    if (settingsToSync.pass) settingsToSync.pass = _obfuscate(settingsToSync.pass);

    _pushToServer({
      orders:   _lsGet(K.ORDERS,   []),
      settings: settingsToSync,
      seenIds:  _lsGet(K.SEEN_IDS, []),
      blocked:  _lsGet(K.BLOCKED,  []),
    });
  }

  // Sunucudan gelen veriyi localStorage'a uygula
  function _applyServerData(data) {
    if (!data) return;
    if (Array.isArray(data.orders))
      _lsSet(K.ORDERS, data.orders);
    if (data.settings && typeof data.settings === 'object') {
      const merged = { ..._lsGet(K.SETTINGS, {}), ...data.settings };
      // proxyUrl: sunucudaki değeri almayız, yerel kalır
      merged.proxyUrl = _lsGet(K.SETTINGS, {}).proxyUrl || undefined;
      // Şifreyi decode et
      // pass sunucudan zaten çözülmüş gelir
      _lsSet(K.SETTINGS, merged);
    }
    if (Array.isArray(data.seenIds))  _lsSet(K.SEEN_IDS, data.seenIds);
    if (Array.isArray(data.blocked))  _lsSet(K.BLOCKED,  data.blocked);
    if (data.updatedAt) _lastSyncTime = data.updatedAt;
  }

  // ── Otomatik poll (30s) ──────────────────────────
  async function _poll() {
    try {
      const data = await _fetchFromServer();
      if (data.updatedAt && data.updatedAt !== _lastSyncTime) {
        _applyServerData(data);
        if (typeof renderAll       === 'function') renderAll();
        if (typeof updateNavBadges === 'function') updateNavBadges();
        if (typeof showSyncStatus  === 'function') showSyncStatus('synced');
      }
    } catch (e) {
      warn('Poll hatası:', e.message);
      if (typeof showSyncStatus === 'function') showSyncStatus('offline');
    }
  }

  function startPolling(ms = 30000) {
    if (_syncTimer) clearInterval(_syncTimer);
    _syncTimer = setInterval(_poll, ms);
  }

  // ── Scan log kaydetme ────────────────────────────
  async function saveScanResult(summary, entries) {
    try {
      await _fetch('/scan-logs', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ summary, entries }),
      });
    } catch (e) { warn('Scan log kaydedilemedi:', e.message); }
  }

  async function loadLastScanSummary() {
    try {
      const res = await _fetch('/scan-logs', { cache: 'no-store' });
      if (!res.ok) return null;
      const data = await res.json();
      return data.summary || null;
    } catch { return null; }
  }

  // ── İlk yükleme ──────────────────────────────────
  async function init() {
    log('Başlatılıyor… Proxy:', PROXY_URL);
    try {
      const data = await _fetchFromServer();
      _applyServerData(data);
      log('Sunucudan yüklendi ✓');
    } catch (e) {
      warn('Sunucuya ulaşılamadı, localStorage kullanılıyor:', e.message);
    }
    startPolling(30000);
  }

  // ── Public API ───────────────────────────────────
  function getSettings() {
    const s = { ..._lsGet(K.SETTINGS, {}) };
    if (s.pass) s.pass = _deobfuscate(s.pass); // her zaman decode'lu döner
    return s;
  }
  function saveSettings(cfg) {
    _lsSet(K.SETTINGS, cfg);
    _pushAll();
  }

  function getOrders()        { return _lsGet(K.ORDERS, []); }
  function saveOrders(orders) { _lsSet(K.ORDERS, orders); _pushAll(); }
  function addOrder(order) {
    const orders = getOrders();
    if (order.mailId && orders.find(o => o.mailId === order.mailId)) return false;
    orders.unshift(order);
    saveOrders(orders);
    return true;
  }
  function updateOrder(id, patch) {
    const orders = getOrders();
    const i = orders.findIndex(o => o.id === id);
    if (i === -1) return false;
    orders[i] = { ...orders[i], ...patch, updatedAt: new Date().toISOString() };
    saveOrders(orders);
    return true;
  }
  function deleteOrder(id) { saveOrders(getOrders().filter(o => o.id !== id)); }

  function getSeenIds() { return new Set(_lsGet(K.SEEN_IDS, [])); }
  function addSeenId(uid) {
    const s = getSeenIds(); s.add(String(uid));
    _lsSet(K.SEEN_IDS, [...s]);
    _pushAll();
  }
  function isSeenId(uid) { return getSeenIds().has(String(uid)); }

  function getBlockedList()          { return _lsGet(K.BLOCKED, []); }
  function saveBlockedList(list)     { _lsSet(K.BLOCKED, list); _pushAll(); }
  function addBlocked(email) {
    const list = getBlockedList();
    if (!list.includes(email)) { list.push(email); saveBlockedList(list); }
  }
  function removeBlocked(email) { saveBlockedList(getBlockedList().filter(e => e !== email)); }

  function clearAll() {
    localStorage.removeItem(K.ORDERS);
    localStorage.removeItem(K.SEEN_IDS);
    _pushAll();
  }

  const _initPromise = init();

  return {
    ready:       _initPromise,
    getSettings, saveSettings,
    getOrders,   saveOrders,  addOrder, updateOrder, deleteOrder,
    getSeenIds,  addSeenId,   isSeenId,
    getBlockedList, saveBlockedList, addBlocked, removeBlocked,
    clearAll, K,
    getProxyUrl:       () => PROXY_URL,
    forcePush:         _pushAll,
    saveScanResult,
    loadLastScanSummary,
  };
})();
