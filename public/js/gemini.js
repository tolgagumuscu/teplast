/**
 * gemini.js — Thread-aware Gemini analysis
 * Model cascade: 2.0-flash → 2.0-flash-lite → keyword fallback
 */
const Gemini = (() => {
  // Sadece gemini-2.5-flash — günlük kota: 20 RPD, dakika: 5 RPM
  const MODEL    = 'gemini-2.5-flash';
  const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

  // Kota durumu — 429 alındıktan sonra keyword fallback'e geç
  let quotaExhausted = false;
  let quotaResetTime = 0; // ms — bekleme bittikten sonra tekrar dene

  function getActiveModel() {
    if (quotaExhausted && Date.now() < quotaResetTime) return null;
    if (quotaExhausted) quotaExhausted = false; // süre geçti, tekrar dene
    return MODEL;
  }

  function markExhausted(waitSec) {
    quotaExhausted = true;
    quotaResetTime = Date.now() + (waitSec || 65) * 1000;
    warn(`Gemini kota doldu → keyword fallback. ${waitSec}s sonra tekrar denenecek.`);
  }

  const log  = (...a) => console.log(`[${ts()}] 🤖 [Gemini]`, ...a);
  const warn = (...a) => console.warn(`[${ts()}] ⚠️ [Gemini]`, ...a);
  const err  = (...a) => console.error(`[${ts()}] 🔴 [Gemini]`, ...a);
  const ts   = () => new Date().toLocaleTimeString('tr-TR');

  function getKey() {
    const k = Storage.getSettings().geminiKey || '';
    // Sunucu decrypt eder ama eski enc: prefix kalmış olabilir → güvenlik: boş bırak
    if (k.startsWith('enc:')) return '';
    return k;
  }

  // ─── Keyword hızlı eleme ─────────────────────────────────────
  // ── Gönderen domain engel listesi ─────────────────────────
  const BLOCK_DOMAINS = [
    // Sosyal medya & haber
    'pegasus','thy','instagram','facebook','linkedin','twitter',
    // Sektör/dernek bildirimleri
    'taysad','btso','sanayi.gov','pagder','seckindanismanlik',
    // Bankalar
    'denizbank','yapikredi','qnb','garanti','isbank','akbank','ziraatbank',
    // Bulk mail servisleri
    'euromsg','crssoft','yesilbeyazhosting',
    // Fuarlar, etkinlikler
    'meridyenfair','payeexpo','busworld','busworld',
    // Reklam veren lojistik/kargo
    'mghlojistik','sudekor',
    // KENDİ DOMAIN — kendi kendine gönderilen bildirimler, sistem mailler
    'teplast.com.tr',
  ];

  // ── Sipariş sinyalleri ─────────────────────────────────────
  const ORDER_SIGNALS = [
    'sipari','order','talep','malzeme','ürün talep',
    'purchase','p.o.','sevk bek','geciken sipariş',
    'stok talep','referans','pieces','adet','kg talep',
    'satın al','temin'
  ];

  // ── Spam/reklam sinyalleri ─────────────────────────────────
  // DİKKAT: "teslimat" sipariş sinyalinden çıkarıldı — kargo reklamları da içeriyor
  const SPAM_SIGNALS = [
    // Reklam kalıpları
    'bülten','newsletter','kampanya','indirim','promosyon','reklam',
    'kaçırmayın','fırsatları','avantajlı fiyat','özel teklif','ücrets',
    'keşfedin','hemen başvur','tıklayın','tıkla','şimdi al',
    'sizin için seçtik','size özel','sizi davet',
    // Etkinlik
    'konferans','seminer','webinar','fuar','zirve','summit','expo',
    // Seyahat/sigorta
    'uçuş','uçak bileti','otel','seyahat','sigorta',
    // Finans bildirimleri
    'kredi','hesap hareket','aidat','fatura ödeme','borç bildirim',
    'borçtan kısıtlama','d-smart','digiturk','dsmart',
    // Teknik spam
    'mailer-daemon','delivery failed','unsubscribe','abonelik',
    // Kargo tanıtım (reklam — gerçek sevk bildirimi değil)
    'daha hızlı teslimat','teslimat sürelerimiz','kargo çözüm',
    'gönderileriniz için','lojistik çözüm','nakliye teklif',
    // Domain spam
    'e-posta.denizbank','iletisim.yapikredi','email.qnb',
    'btso.org.tr','e.taysadbulten','instagram.com',
    'pegasusairlines','e-flypgs',
  ];

  /**
   * Hızlı ön eleme — Gemini'ye göndermeye değer mi?
   * returns: 'order' | 'possible' | 'skip'
   */
  function preFilter({ subject, body, from }) {
    const s = (subject + ' ' + from + ' ' + (body||'').slice(0,300)).toLowerCase();

    // Blocked domain kontrolü
    for (const d of BLOCK_DOMAINS) {
      if (s.includes(d)) return 'skip';
    }
    for (const sig of SPAM_SIGNALS) {
      if (s.includes(sig)) return 'skip';
    }
    for (const sig of ORDER_SIGNALS) {
      if (s.includes(sig)) return 'order';
    }
    return 'possible'; // belirsiz → Gemini'ye gönder
  }

  // ─── Thread birleştirme ──────────────────────────────────────
  function normalizeSubject(subj) {
    return (subj || '')
      .replace(/^(RE|FW|İLT|YNT|ANT|REPLY|FORWARD|SV|AW|VS|TR)\s*:\s*/gi, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function groupThreads(mails) {
    const threads = new Map(); // normalizedSubject → [mails]
    for (const mail of mails) {
      const key = normalizeSubject(mail.subject) || mail.uid;
      if (!threads.has(key)) threads.set(key, []);
      threads.get(key).push(mail);
    }
    return threads;
  }

  // ─── Body temizle: quoted reply'ları çıkar ───────────────────
  function extractOriginalBody(raw) {
    if (!raw) return '';
    const lines = raw.split('\n');
    const out = [];
    for (const line of lines) {
      const t = line.trim();
      if (t.startsWith('>') ||
          /^-{3,}/.test(t) || /^_{3,}/.test(t) ||
          /^From:\s/i.test(t) || /^Sent:\s/i.test(t) ||
          /^To:\s/i.test(t)   || /^Tarih:\s/i.test(t) ||
          /^Konu:\s/i.test(t) || /^Gönderen:\s/i.test(t)) break;
      out.push(line);
    }
    return out.join('\n').trim().slice(0, 3000);
  }

  // ─── Firma adı: domain + imza kombinasyonu ───────────────────
  // ─── Firma adı çıkarma ──────────────────────────────────────
  // Rol/unvan — firma adı değil
  const ROLE_WORDS = /satinalma|purchasing|muhasebe|muhendis|mühendis|sorumlu|yetkili|asistan|müdür|mudur|yönetici|direktör|ihracat|ithalat|lojistik|planlama|kalite|üretim|sevkiyat|montaj/i;
  // Adres satırı — firma adı değil
  const ADDR_WORDS = /mahalle|mah\.\s|cadde|cad\.\s|sokak|sok\.\s|bulvar|bulv\.\s|\bno\b|\bno:|sanayi bölge|organize|\bosb\b|\d{5}|seyhan|nilüfer|gebze|kocaeli|bursa|istanbul|ankara|izmir|konya|adana|tekirdağ|manisa/i;
  // Jenerik mail sağlayıcıları
  const GENERIC_DOMAINS = new Set(['gmail','yahoo','hotmail','outlook','yandex','icloud','live','msn','windowslive','mail','email','info','contact']);

  /**
   * @happich.com.tr → "HAPPICH"
   * @npplas.com.tr  → "NPPLAS"
   * @vkmplastik.com → "VKMPLASTIK"
   * Subdomain (info@mail.firm.com.tr) → "FIRM"
   */
  function domainToCompanyName(from) {
    const email = (from||'').match(/<([^>]+)>/)?.[1] || (from||'').match(/[\w.+-]+@[\w.-]+/)?.[0] || '';
    const fullDomain = email.split('@')[1] || '';
    if (!fullDomain) return null;
    // Parçalara ayır: ["happich","com","tr"] veya ["vkmplastik","com"]
    const parts = fullDomain.toLowerCase().split('.');
    // Son 1-2 parça TLD — TLD'yi soy
    // .com.tr, .org.tr, .net.tr = son 2 parça TLD
    // .com, .net, .org, .de, .fr = son 1 parça TLD
    const tld2 = ['com.tr','org.tr','net.tr','co.uk','com.de'];
    const isTld2 = tld2.includes(parts.slice(-2).join('.'));
    const tldCount = isTld2 ? 2 : 1;
    // Anlamlı parçalar (TLD ve sub-domain hariç)
    const meaningful = parts.slice(0, -tldCount);
    if (!meaningful.length) return null;
    // En anlamlı domain parçası (genellikle son anlamlı parça)
    let company = meaningful[meaningful.length - 1];
    // Jenerik mi? (mail, info, contact gibi subdomain'ler)
    if (GENERIC_DOMAINS.has(company) && meaningful.length > 1) {
      company = meaningful[meaningful.length - 2];
    }
    if (GENERIC_DOMAINS.has(company)) return null;
    // Büyüt ve döndür: "happich" → "HAPPICH", "vkmplastik" → "VKMPLASTIK"
    return company.replace(/-/g,' ').toUpperCase();
  }

  // ─── Keyword fallback (Gemini yokken veya parse hatasında) ──
  function keywordAnalyze({ subject, body, from, threadMails }) {
    const s = (subject||'').toLowerCase();
    const b = (body||'').toLowerCase().slice(0,500);

    for (const sig of ORDER_SIGNALS) {
      if (s.includes(sig) || b.includes(sig)) {
        const namePart = (from||'').replace(/<[^>]+>/,'').replace(/"/g,'').trim();
        // Domain HER ZAMAN önce gelir — adres/imza karışıklığını önler
        // happich.com.tr → HAPPICH, npplas.com.tr → NPPLAS
        const domainCompany = domainToCompanyName(from);
        // Domain yoksa kişi adından soyad çıkar (genellikle daha temiz)
        const company = domainCompany || namePart.split(/\s+/).slice(-1)[0]?.toUpperCase() || namePart || '—';

        return {
          isOrder:     true,
          source:      'keyword',
          companyName: company,
          senderName:  namePart || '—',
          products:    [],   // Ürün bilinmiyor — keyword ile çıkaramıyoruz
          terminDate:  null,
          confidence:  0.45,
          summary:     `Sipariş sinyali tespit edildi (AI analiz yapılamadı). Konu: "${subject}"`,
        };
      }
    }
    return { isOrder: false, source: 'keyword' };
  }


  // JSON onarım — kesilmiş JSON'u kurtarmaya çalış
  function _repairJSON(text) {
    // { ile başlayıp bitmiyorsa kapat
    if (!text.trim().startsWith('{')) return null;
    let t = text.trim();
    // Açık string kapat
    const quoteCount = (t.match(/(?<!\\)"/g)||[]).length;
    if (quoteCount % 2 !== 0) t += '"';
    // Açık array kapat
    const openBrackets = (t.match(/\[/g)||[]).length - (t.match(/\]/g)||[]).length;
    for(let i=0;i<openBrackets;i++) t += ']';
    // Açık obje kapat
    const openBraces = (t.match(/{/g)||[]).length - (t.match(/}/g)||[]).length;
    for(let i=0;i<openBraces;i++) t += '}';
    return t;
  }

  // Prompt + PDF/görsel eklerini Gemini parts formatına çevir
  function _buildParts(prompt, threadMails) {
    const parts = [{ text: prompt }];
    for (const m of threadMails) {
      for (const att of (m.attachments||[])) {
        if (!att.base64) continue;
        // PDF ve görselleri inline_data olarak ekle
        parts.push({
          inline_data: {
            mime_type: att.mimeType || 'application/pdf',
            data: att.base64
          }
        });
        log(`Ek Gemini'ye eklendi: ${att.filename} (${att.sizeKB}KB)`);
      }
    }
    return parts;
  }

  // ─── Ana Gemini analizi ──────────────────────────────────────
  async function analyzeThread(threadMails) {
    const key = getKey();
    const primary = threadMails[0];
    const subject = primary.subject;

    if (!key) {
      log('API key yok → keyword');
      return keywordAnalyze({ subject, body: primary.body, from: primary.from, threadMails });
    }

    // Thread context oluştur (en yeni → en eski)
    const threadContext = threadMails.map((m, i) => {
      const clean = extractOriginalBody(m.body);
      const hasImages = (m.attachments||[]).length > 0;
      const attachInfo = (m.attachmentTexts||[]).length
        ? '\n[EK BELGELER — TAM OKU]\n' + m.attachmentTexts.join('\n---\n') : '';
      const imgHint = hasImages ? '\n[GÖRSEL/PDF EK VAR — içeriğini okuyup ürünleri çıkar]' : '';
      return `--- MESAJ ${i+1}/${threadMails.length} ---
Gönderen: ${m.from}
Tarih: ${m.date}
${clean}${attachInfo}${imgHint}`;
    }).join('\n\n');

    // Domain firma adı tespiti için kritik ipucu
    const senderEmail = (primary.from||'').match(/<([^>]+)>/)?.[1] || primary.from || '';
    const senderDomain = senderEmail.match(/@([^.]+)\./)? senderEmail.match(/@([^.]+)\./)[1] : '';

    // Keyword'dan önce domain'i de prompt'a ver — AI daha doğru firma adı yazar
    const domainHint = domainToCompanyName(primary.from);
    const prompt = `Sen Teplast Boya Plastik şirketinin sipariş yönetim sistemisinin AI modülüsün.
Türkçe ve İngilizce mailleri analiz edip SADECE aşağıdaki JSON formatında yanıt veriyorsun.
BAŞKA HİÇBİR ŞEYY YAZMA — sadece JSON.

GÖREV: Aşağıdaki e-posta thread'ini analiz et.

=== FİRMA ADI KURALLARI ===
- Firma adı = müşteri şirketin adı — gönderenin KİŞİ adı veya UNVANI değil
- Mail adresi: "${primary.from}" — domain: "${domainHint || senderDomain}" → bu domain'in şirket adını yaz
- Domain ALTIN KURAL: eğer domain "happich" ise firma = "HAPPICH", "npplas" ise "NPPlas", "vkmplastik" ise "VKM Plastik"
- Adres satırları (MAH., CAD., BULV., NO:, SEYHAN, ADANA gibi) firma adı DEĞİL — kesinlikle kullanma
- "Satınalma Mühendisi", "VKM SATINALMA" → bunlar unvan/kişi adı, firma adı değil

=== ÜRÜN ÇIKARMA KURALLARI ===
- Mail içindeki her ürün satırını ayrı ayrı çıkar
- Format: "KOD ÜRÜN_ADI MİKTAR BİRİM" (ör: "81-619 T.COLOR GRİ BOYA 100 KG")
- "PC", "PCS", "ADET", "KG", "LITRE" = birim
- Ürün kodu genellikle rakam-tire-rakam formatında (ör: 81-619, 250-000356, 0049120927)
- Hiç ürün bulunamıyorsa boş array [] döndür, "(Konu:...)" YAZMA

=== EK DOSYA OKUMA (ÇOK ÖNEMLİ) ===
- PDF veya resim eki varsa: İÇERİĞİ TAM OKU. Sipariş formundaki her ürün satırını, kodu, miktarı çıkar.
- Tablo içeren resim/PDF gelirse: Her satırı ayrı ürün olarak işle (kod | ad | miktar | birim).
- [TABLO] bölümü varsa: pipe (|) ile ayrılmış sütunları ürün olarak parse et.
- Excel/CSV gelirse: Her satırı ürün olarak değerlendir (sipariş no, malzeme kodu, tanım, miktar, tarih).
- Görselde form/tablo/liste varsa kesinlikle isOrder=true ve ürünleri çıkar.

=== SİPARİŞ KRİTERLERİ ===
isOrder=true: müşteri ürün/malzeme istiyor, miktar+ürün var, "sipariş", "talep", "order", "po", "adet", "sevk"
isOrder=true: ekteki PDF/Excel/resimde sipariş formu, parça listesi, malzeme tablosu var
isOrder=true: mail body'de tablo var, ürün kodları ve miktarlar içeriyor (negatif stok = eksik = sipariş ihtiyacı)
isOrder=false: fatura, mutabakat, bülten, kampanya, bilgilendirme, cari hesap, bank bildirimi

=== THREAD (${threadMails.length} mesaj) ===
${threadContext}

SADECE JSON (başka hiçbir şey yazma, markdown yok, kod bloğu yok):
{
  "isOrder": true,
  "companyName": "Müşteri şirket adı (kişi adı veya unvan değil)",
  "senderName": "Göndericinin adı soyadı",
  "contactEmail": "gönderenin mail adresi",
  "products": [
    {"name": "ürün adı", "code": "varsa kod (ör: 81-619)", "quantity": "100 KG", "note": ""}
  ],
  "terminDate": "YYYY-MM-DD veya null",
  "deliveryWeek": "varsa hafta/ay bilgisi veya null",
  "confidence": 0.9,
  "summary": "Türkçe 1 cümle özet"
}`;

  const activeModel = getActiveModel();
  if (!activeModel) {
    warn('Gemini kota doldu → keyword fallback');
    return keywordAnalyze({ subject, body: primary.body, from: primary.from });
  }
  const url = `${API_BASE}/${activeModel}:generateContent`;
    log(`Thread analizi: "${subject}" (${threadMails.length} mesaj)`);

    let resp;
    try {
      // Önce sunucu proxy'yi dene (API key güvenli tutulur)
      const proxyUrl = Storage.getProxyUrl() + '/gemini-analyze';
      const builtParts = _buildParts(prompt, threadMails);
      const proxyResp = await fetch(proxyUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: activeModel, parts: builtParts }),
        signal: AbortSignal.timeout(30000)
      });
      if (proxyResp.status === 503) {
        // Proxy'de key yok → direkt API (LAN modu, key settings'den)
        if (!key) { err('Ne proxy key ne de settings key var → keyword'); return keywordAnalyze({ subject, body: primary.body, from: primary.from }); }
        resp = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-goog-api-key': key },
          body: JSON.stringify({
            contents: [{ parts: builtParts }],
            generationConfig: { temperature: 0.05, maxOutputTokens: 8192, responseMimeType: 'application/json' }
          }),
          signal: AbortSignal.timeout(30000)
        });
      } else {
        resp = proxyResp;
      }
    } catch(e) {
      err('Fetch hatası:', e.message, '→ keyword');
      return keywordAnalyze({ subject, body: primary.body, from: primary.from });
    }

    log(`← HTTP ${resp.status}`);

    if (!resp.ok) {
      const errBody = await resp.json().catch(()=>({}));
      const msg = errBody?.error?.message || '';
      err(`API ${resp.status}: ${msg.slice(0,100)}`);
      if (resp.status === 429) {
        const retryMatch = msg.match(/retry.{1,10}?(\d+)\s*s/i);
        const waitSec = retryMatch ? Math.ceil(parseInt(retryMatch[1])) + 5 : 65;
        markExhausted(waitSec);
        const fallback = keywordAnalyze({ subject, body: primary.body, from: primary.from });
        fallback._rateLimitWait = waitSec;
        return fallback;
      }
      return keywordAnalyze({ subject, body: primary.body, from: primary.from });
    }

    const data = await resp.json();
    const text = (data?.candidates?.[0]?.content?.parts?.[0]?.text || '').replace(/```json|```/gi,'').trim();
    log(`Yanıt (${text.length} chr): ${text.slice(0,80)}`);

    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch(e) {
      // Truncated JSON — kurtarmaya çalış
      try {
        const fixed = _repairJSON(text);
        if (fixed) parsed = JSON.parse(fixed);
      } catch {}
    }
    if (parsed) {
      parsed.source = 'gemini';
      log(`✓ isOrder:${parsed.isOrder} | firma:"${parsed.companyName}" | ürünler:${parsed.products?.length||0} | conf:${parsed.confidence}`);
      return parsed;
    }
    err('Parse hatası → keyword');
    return keywordAnalyze({ subject, body: primary.body, from: primary.from });
  }

  function hasDefaultKey() { return false; }
  return { analyzeThread, preFilter, groupThreads, normalizeSubject, keywordAnalyze, hasDefaultKey };
})();
