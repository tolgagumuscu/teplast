/**
 * pop3.js — Thread-aware scan coordinator v5
 * ASLA DELE ÇAĞRISI YAPILMAZ.
 */
const POP3Client = (() => {
  function getProxyUrl() { return Storage.getProxyUrl().replace(/\/$/, ''); }
  const RPM_SAFE = 14;
  const DELAY_MS = Math.ceil(60000 / RPM_SAFE) + 100;

  const log   = (...a) => console.log(`[${ts()}] 📘 [POP3]`, ...a);
  const warn  = (...a) => console.warn(`[${ts()}] ⚠️ [POP3]`, ...a);
  const err   = (...a) => console.error(`[${ts()}] 🔴 [POP3]`, ...a);
  const ts    = () => new Date().toLocaleTimeString('tr-TR');
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  const DEFAULT_BLOCKED = [
    'oversea@g0riller.net',
    'egitim@seckindanismanlik.com.tr',
    'metin@mghlojistik.com',
  ];

  function getBlockedList() {
    try { return JSON.parse(localStorage.getItem('teplast_blocked') || '[]'); }
    catch { return []; }
  }
  function isBlocked(from) {
    const f = (from||'').toLowerCase();
    return [...DEFAULT_BLOCKED, ...getBlockedList()].some(b => f.includes(b.toLowerCase()));
  }

  // ─── Proxy bağlantı kontrolü ───────────────────────
  async function checkProxy() {
    try {
      const r = await fetch(`${getProxyUrl()}/ping`, {
        signal: AbortSignal.timeout(4000)
      });
      if (r.ok) { log('Proxy aktif ✓'); return { ok: true }; }
      return { ok: false, reason: `Proxy HTTP ${r.status}` };
    } catch(e) {
      const isRefused = e.message?.includes('fetch') || e.name === 'TypeError';
      return {
        ok: false,
        reason: isRefused ? 'connection_refused' : e.message
      };
    }
  }

  // Dışarıdan da çağrılabilir (Ayarlar → Test butonu)
  async function testProxyConnection() {
    const result = await checkProxy();
    return result;
  }

  async function fetchViaProxy(cfg, onPageProgress) {
    const limit    = cfg.mailLimit || 250;
    const PAGE     = 20;  // small pages → each request finishes within Render's 30s timeout
    let   offset   = 0;
    const allMails = [];

    while (true) {
      log(`fetch-mails: offset=${offset} pageSize=${PAGE} limit=${limit}`);
      const resp = await fetch(`${getProxyUrl()}/fetch-mails`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: cfg.host, port: cfg.port,
          user: cfg.user, pass: cfg.pass,
          tls:  cfg.tls || 'none',
          limit, offset, pageSize: PAGE
        })
      });
      if (!resp.ok) {
        const e = await resp.json().catch(() => ({}));
        throw new Error(e.message || `Proxy HTTP ${resp.status}`);
      }
      const result = await resp.json();

      // Backward-compat: old server returned a plain array
      const pageMails = Array.isArray(result) ? result : (result.mails || []);
      allMails.push(...pageMails);

      const total   = result.total ?? allMails.length;
      const hasMore = !Array.isArray(result) && result.hasMore;
      log(`Sayfa ${offset}–${offset + pageMails.length - 1} / ${total} (hasMore:${hasMore})`);

      if (typeof onPageProgress === 'function') {
        onPageProgress(allMails.length, total);
      }

      if (!hasMore) break;
      offset += PAGE;
      await sleep(300); // brief pause between pages
    }

    log(`fetch-mails tamamlandı: toplam ${allMails.length} mail`);
    return allMails;
  }

  // ─── Demo verisi ────────────────────────────────────
  function getDemoOrders() {
    return [{
      uid: 'demo-001', subject: 'Sipariş Talebi - PP Granül',
      from: 'Ahmet Yılmaz <ahmet@abc-plastik.com>',
      date: new Date(Date.now() - 86400000).toISOString(),
      rawBody: 'Merhaba,\nABC Plastik olarak 500 kg PP Granül (Kod: PP-HG-500) talep ediyoruz.\nTermin: 15.03.2025\nAhmet Yılmaz / ABC Plastik A.Ş.',
      analysis: {
        isOrder: true, source: 'demo', companyName: 'ABC Plastik A.Ş.', senderName: 'Ahmet Yılmaz',
        products: [{ name: 'PP Granül', code: 'PP-HG-500', quantity: '500 kg', note: '' }],
        terminDate: '2025-03-15', confidence: 0.97, summary: 'ABC Plastik, 500 kg PP Granül talep ediyor.'
      }
    }];
  }

  // ─── Ana tarama ─────────────────────────────────────
  async function scanMails(onProgress, onOrderFound) {
    log('=== TARAMA BAŞLADI ===');
    const cfg = Storage.getSettings();
    log('Ayarlar:', { host: cfg.host, port: cfg.port, user: cfg.user, passSet: !!cfg.pass, geminiSet: !!(cfg.geminiKey || Gemini.hasDefaultKey()), limit: cfg.mailLimit || 250 });

    if (!cfg.user || !cfg.pass) {
      throw new Error('SETUP_NEEDED:Mail ayarları eksik.\nAyarlar sayfasını doldurup kaydedin.');
    }
    if (!cfg.geminiKey && !Gemini.hasDefaultKey()) warn('Gemini key yok → sadece keyword analizi');

    onProgress(0, 1, 'Proxy kontrol ediliyor…', 'info');
    const proxyStatus = await checkProxy();

    // ── Proxy kapalı → Demo değil, net hata ─────────
    if (!proxyStatus.ok) {
      const proxyUrl = getProxyUrl();
      const isLocal  = proxyUrl.includes('localhost') || proxyUrl.includes('127.0.0.1');

      if (proxyStatus.reason === 'connection_refused') {
        throw new Error(
          `PROXY_DOWN:Proxy sunucusu çalışmıyor.\n` +
          `Adres: ${proxyUrl}\n\n` +
          (isLocal
            ? `Terminalde şunu çalıştır:\n  cd proxy\n  npm start\n\nSonra tekrar tara.`
            : `Bu IP/portta proxy aktif değil.\nAyarlar → Proxy URL'i kontrol et.`)
        );
      }
      throw new Error(`PROXY_ERROR:Proxy bağlantı hatası: ${proxyStatus.reason}`);
    }

    // ── FETCH ───────────────────────────────────────
    onProgress(0, 1, 'Sunucuya bağlanılıyor…', 'info');
    const allMails = await fetchViaProxy(cfg, (loaded, total) => {
      onProgress(0, 1, `📥 Mail indiriliyor… ${loaded}/${total || '?'}`, 'info');
    });
    const total    = allMails.length;
    log(`${total} mail alındı`);
    if (typeof setScanOverlayStats === 'function') setScanOverlayStats(total, undefined, undefined);

    const newMails = allMails.filter(m => {
      if (isBlocked(m.from)) { log(`BLOCKED: ${m.from}`); return false; }
      if (Storage.isSeenId(m.uid)) return false;
      return true;
    });
    log(`Yeni + engellenmemiş: ${newMails.length} (${total - newMails.length} atlandı)`);

    const candidates = [];
    let spamCount = 0;
    for (const m of newMails) {
      const verdict = Gemini.preFilter({ subject: m.subject, body: m.body, from: m.from });
      if (verdict === 'skip') {
        Storage.addSeenId(m.uid);
        spamCount++;
      } else {
        candidates.push({ ...m, preFilter: verdict });
      }
    }
    log(`Ön eleme: ${spamCount} spam, ${candidates.length} aday`);
    onProgress(0, candidates.length, `${spamCount} spam elendi, ${candidates.length} mail analiz edilecek`, 'info');

    const threadMap = Gemini.groupThreads(candidates);
    const threads   = [...threadMap.values()];
    log(`${candidates.length} mail → ${threads.length} thread`);
    if (typeof setScanOverlayStats === 'function') setScanOverlayStats(total, candidates.length, threads.length);

    let newOrders = 0, geminiOk = 0, keywordOk = 0, geminiErrors = 0;
    let threadIdx = 0;

    for (const threadMails of threads) {
      threadIdx++;
      const primary   = threadMails[0];
      const label     = (primary.subject || '(başlıksız)').slice(0, 45);
      const mailCount = threadMails.length;

      onProgress(threadIdx, threads.length,
        `[${threadIdx}/${threads.length}] ${mailCount > 1 ? `🔗${mailCount} mesaj: ` : ''}${label}`, 'info');

      if ((cfg.geminiKey || Gemini.hasDefaultKey()) && threadIdx > 1) await sleep(DELAY_MS);

      let analysis;
      try {
        analysis = await analyzeWithRetry(threadMails, onProgress, label);
        if (analysis.source === 'gemini') geminiOk++;
        else keywordOk++;
      } catch(e) {
        geminiErrors++;
        err(`Analiz hatası (${label}):`, e.message);
        analysis = Gemini.keywordAnalyze({ subject: primary.subject, body: primary.body, from: primary.from });
        keywordOk++;
      }

      threadMails.forEach(m => Storage.addSeenId(m.uid));
      if (!analysis.isOrder) continue;

      const productStr = fmtProducts(analysis.products);
      const earliestDate = threadMails.map(m => m.date || '').sort()[0] || new Date().toISOString();
      const order = buildOrder(
        primary.uid,
        { ...primary, date: earliestDate, rawBody: primary.body },
        analysis, productStr, threadMails.length
      );

      if (Storage.addOrder(order)) {
        newOrders++;
        const msg = `✅ ${analysis.companyName} — ${productStr.slice(0, 35)}${productStr.length > 35 ? '…' : ''}`;
        log(msg + ` [${analysis.source}, ${analysis.confidence?.toFixed(2)}]`);
        onProgress(threadIdx, threads.length, msg, 'success');
        onOrderFound && onOrderFound(order);
      }
    }

    log(`=== TAMAMLANDI === Threads:${threads.length} Yeni:${newOrders} Gemini:${geminiOk} Keyword:${keywordOk}`);
    return { total, threads: threads.length, newOrders, skipped: spamCount, geminiOk, keywordOk, geminiErrors, demoMode: false };
  }

  async function analyzeWithRetry(threadMails, onProgress, label, attempt = 1) {
    const result = await Gemini.analyzeThread(threadMails);
    // _rateLimitWait: tüm modeller doldu, kısa bekle
    if (result._rateLimitWait) {
      const wait = result._rateLimitWait;
      if (attempt <= 2) {
        warn(`Tüm modeller rate limit → ${wait}s bekleniyor (deneme ${attempt}/2)`);
        onProgress(-1, -1, `⏳ Tüm Gemini modelleri meşgul – ${wait}s bekleniyor…`, 'warn');
        await sleep(wait * 1000);
        delete result._rateLimitWait;
        return analyzeWithRetry(threadMails, onProgress, label, attempt + 1);
      }
      delete result._rateLimitWait;
      warn('Gemini tamamen erişilemez → keyword fallback');
    }
    return result;
  }

  function fmtProducts(products) {
    return (products || []).map(p =>
      [p.name, p.code ? `[${p.code}]` : '', p.quantity ? `× ${p.quantity}` : ''].filter(Boolean).join(' ')
    ).join(', ');
  }

  function buildOrder(uid, mail, analysis, productStr, threadCount = 1) {
    return {
      id:           'ord-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      mailId:       uid,
      threadCount,
      createdAt:    mail.date || new Date().toISOString(),
      updatedAt:    new Date().toISOString(),
      subject:      mail.subject,
      from:         mail.from,
      rawBody:      mail.rawBody || mail.body || '',
      companyName:  analysis.companyName  || '—',
      senderName:   analysis.senderName   || '—',
      contactEmail: analysis.contactEmail || '',
      products:     analysis.products     || [],
      productStr,
      terminDate:   analysis.terminDate   || null,
      deliveryWeek: analysis.deliveryWeek || null,
      summary:      analysis.summary      || '',
      confidence:   analysis.confidence   || 0,
      detectedBy:   analysis.source       || 'unknown',
      status:       'new',
      notes:        '',
    };
  }

  // Demo modu — sadece ayarlar eksikse veya explicit çağrıda
  async function runDemo(onOrderFound) {
    for (const item of getDemoOrders()) {
      if (Storage.isSeenId(item.uid)) continue;
      Storage.addSeenId(item.uid);
      const order = buildOrder(item.uid, item, item.analysis, fmtProducts(item.analysis.products));
      if (Storage.addOrder(order)) onOrderFound && onOrderFound(order);
    }
  }

  return { scanMails, testProxyConnection, runDemo, getBlockedList, isBlocked };
})();
