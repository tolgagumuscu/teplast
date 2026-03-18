/**
 * server.js — Teplast Render v7
 * Düzeltmeler: route sırası, CORS, güvenli şifre şifreleme
 */

const express = require('express');
const net     = require('net');
const tls_mod = require('tls');
const path    = require('path');
const crypto  = require('crypto');
const { simpleParser } = require('mailparser');
let XLSX; try { XLSX = require('xlsx'); } catch { XLSX = null; }
const { createClient }  = require('redis');

const app  = express();
const PORT = process.env.PORT || 3131;

// ── Şifreleme (AES-256-GCM) ───────────────────────
// ENCRYPT_SECRET env var yoksa sabit bir key kullan (daha az güvenli ama çalışır)
const ENC_KEY = crypto.createHash('sha256')
  .update(process.env.ENCRYPT_SECRET || 'teplast-default-enc-2024')
  .digest(); // 32 bytes

function encrypt(text) {
  if (!text) return text;
  try {
    const iv  = crypto.randomBytes(12);
    const c   = crypto.createCipheriv('aes-256-gcm', ENC_KEY, iv);
    const enc = Buffer.concat([c.update(text, 'utf8'), c.final()]);
    const tag = c.getAuthTag();
    return 'enc:' + Buffer.concat([iv, tag, enc]).toString('base64');
  } catch { return text; }
}

function decrypt(text) {
  if (!text || !text.startsWith('enc:')) return text;
  try {
    const buf = Buffer.from(text.slice(4), 'base64');
    const iv  = buf.slice(0, 12);
    const tag = buf.slice(12, 28);
    const enc = buf.slice(28);
    const d   = crypto.createDecipheriv('aes-256-gcm', ENC_KEY, iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
  } catch { return text; }
}

// ── HTML tablo → düz metin ───────────────────────
function htmlTableToText(html) {
  if (!html) return '';
  try {
    // Her satırı al
    const rows = [];
    const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let trMatch;
    while ((trMatch = trRegex.exec(html)) !== null) {
      const cells = [];
      const tdRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
      let tdMatch;
      while ((tdMatch = tdRegex.exec(trMatch[1])) !== null) {
        const text = tdMatch[1].replace(/<[^>]+>/g,'').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').trim();
        cells.push(text);
      }
      if (cells.some(c => c.length > 0)) rows.push(cells.join(' | '));
    }
    return rows.join('\n');
  } catch { return html.replace(/<[^>]+>/g,'').trim(); }
}

function extractEmailBody(parsed) {
  // Önce plain text dene
  if (parsed.text && parsed.text.trim().length > 50) return parsed.text;
  // HTML'den tabloları koru
  if (parsed.html) {
    const tableText = htmlTableToText(parsed.html);
    // Tablo varsa onu kullan, yoksa tag strip
    if (tableText.includes(' | ') && tableText.length > 30) {
      const bodyText = parsed.html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi,'')
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi,'')
        .replace(/<[^>]+>/g,' ').replace(/\s{2,}/g,'\n').trim();
      return bodyText.slice(0,500) + '\n\n[TABLO]\n' + tableText;
    }
    return parsed.html.replace(/<[^>]+>/g,' ').replace(/\s{2,}/g,'\n').trim();
  }
  return '';
}

// ── Excel/CSV → metin ─────────────────────────────
function excelToText(buffer, filename) {
  if (!XLSX) return `[EK: ${filename} — xlsx kütüphanesi yok]`;
  try {
    const wb = XLSX.read(buffer, { type: 'buffer' });
    const lines = [];
    for (const sheetName of wb.SheetNames.slice(0,3)) { // max 3 sheet
      const ws = wb.Sheets[sheetName];
      const csv = XLSX.utils.sheet_to_csv(ws, { FS: ' | ', blankrows: false });
      const rows = csv.split('\n').filter(r => r.replace(/[| ]/g,'').length > 0).slice(0,50); // max 50 satır
      if (rows.length > 0) {
        lines.push(`[SHEET: ${sheetName}]`);
        lines.push(...rows);
      }
    }
    return lines.join('\n') || `[EK: ${filename} — boş]`;
  } catch(e) {
    return `[EK: ${filename} — okunamadı: ${e.message}]`;
  }
}

// ── Redis ─────────────────────────────────────────
const REDIS_URL = process.env.REDIS_URL || null;
let redis = null;
let redisReady = false;

async function initRedis() {
  if (!REDIS_URL) { console.log('[DB] REDIS_URL yok → bellek modu'); return; }
  try {
    redis = createClient({ url: REDIS_URL });
    redis.on('error', e => console.error('[Redis]', e.message));
    await redis.connect();
    redisReady = true;
    console.log('[DB] Redis bağlandı ✓');
  } catch(e) {
    console.error('[DB] Redis bağlanamadı:', e.message);
  }
}

const MEM = {};
async function dbGet(key)        { if (redisReady) { const v = await redis.get('teplast:'+key); return v ? JSON.parse(v) : null; } return MEM[key] ?? null; }
async function dbSet(key, value) { if (redisReady) { await redis.set('teplast:'+key, JSON.stringify(value)); } else { MEM[key] = value; } }

// ── Middleware sırası (ÖNEMLİ) ───────────────────
// 1. CORS — her şeyden önce
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.sendStatus(204); return; }
  next();
});

// 2. JSON body parser
app.use(express.json({ limit: '32mb' }));

// ─────────────────────────────────────────────────
// 3. API ROUTES — static'ten ÖNCE gelmelii
// ─────────────────────────────────────────────────

app.get('/ping', (req, res) => {
  res.json({ ok: true, version: 7, storage: redisReady ? 'redis' : 'memory' });
});

// GET /sync — tüm veriyi döndür (şifreli alanlar çözülmüş olarak)
app.get('/sync', async (req, res) => {
  try {
    const data = {};
    data.orders   = await dbGet('orders')   || [];
    data.seenIds  = await dbGet('seenIds')  || [];
    data.blocked  = await dbGet('blocked')  || [];
    data.updatedAt = await dbGet('updatedAt') || null;

    // Settings: şifreli alanları çöz
    const rawSettings = await dbGet('settings') || {};
    data.settings = { ...rawSettings };
    if (data.settings.pass)      data.settings.pass      = decrypt(data.settings.pass);
    if (data.settings.geminiKey) data.settings.geminiKey = decrypt(data.settings.geminiKey);

    res.json(data);
  } catch(e) { console.error('[sync GET]', e.message); res.status(500).json({ message: e.message }); }
});

// POST /sync — kaydet (hassas alanları şifrele)
app.post('/sync', async (req, res) => {
  try {
    const data = req.body;
    const now  = new Date().toISOString();
    if (data.orders   !== undefined) await dbSet('orders',   data.orders);
    if (data.seenIds  !== undefined) await dbSet('seenIds',  data.seenIds);
    if (data.blocked  !== undefined) await dbSet('blocked',  data.blocked);

    // Settings: hassas alanları şifrele
    if (data.settings !== undefined) {
      const s = { ...data.settings };
      if (s.pass)      s.pass      = encrypt(s.pass);
      if (s.geminiKey) s.geminiKey = encrypt(s.geminiKey);
      await dbSet('settings', s);
    }
    await dbSet('updatedAt', now);
    res.json({ ok: true, updatedAt: now });
  } catch(e) { console.error('[sync POST]', e.message); res.status(500).json({ message: e.message }); }
});

app.get('/scan-logs', async (req, res) => {
  try {
    const summary  = await dbGet('lastScanSummary') || null;
    const logs     = await dbGet('recentLogs') || [];
    res.json({ summary, recentLogs: logs });
  } catch(e) { res.status(500).json({ message: e.message }); }
});

app.post('/scan-logs', async (req, res) => {
  try {
    const { summary, entries } = req.body;
    if (summary) await dbSet('lastScanSummary', summary);
    if (Array.isArray(entries) && entries.length > 0) {
      const existing = (await dbGet('recentLogs')) || [];
      await dbSet('recentLogs', [...existing, ...entries].slice(-500));
    }
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ message: e.message }); }
});

// /gemini-analyze — Gemini API key sunucuda kalır, client görmez
app.post('/gemini-analyze', async (req, res) => {
  try {
    // Önce env var, yoksa Redis'teki settings'den çöz
    let apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      const s = await dbGet('settings') || {};
      if (s.geminiKey) apiKey = decrypt(s.geminiKey);
    }
    if (!apiKey) { res.status(503).json({ error: 'GEMINI_API_KEY yok' }); return; }

    const { model, parts, prompt } = req.body;
    const m = model || 'gemini-2.0-flash';
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`;
    const apiResp = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{ parts: parts || [{ text: prompt }] }],
        generationConfig: { temperature: 0.05, maxOutputTokens: 8192, responseMimeType: 'application/json' }
      })
    });
    const data = await apiResp.json();
    res.status(apiResp.status).json(data);
  } catch(e) { console.error('[Gemini]', e.message); res.status(500).json({ error: e.message }); }
});

// /mailbox-stat — kaç mail var gerçekten? STAT komutu, indirme yok
app.post('/mailbox-stat', async (req, res) => {
  try {
    const cfg = req.body;
    if (cfg.pass && cfg.pass.startsWith('enc:')) cfg.pass = decrypt(cfg.pass);
    const pop = new POP3(cfg);
    await pop.connect();
    await pop.login();
    // STAT: "+OK messageCount totalSize"
    const stat = await pop._cmd('STAT');
    const ids  = await pop.list();
    pop.quit();
    const parts = stat.match(/\+OK (\d+) (\d+)/);
    res.json({
      stat,
      messageCount: parts ? parseInt(parts[1]) : ids.length,
      totalSizeBytes: parts ? parseInt(parts[2]) : 0,
      listCount: ids.length,
      maxId: ids.length ? Math.max(...ids) : 0,
      minId: ids.length ? Math.min(...ids) : 0,
    });
  } catch(e) {
    res.status(500).json({ message: e.message });
  }
});

app.get('/gemini-key-status', async (req, res) => {
  let hasKey = !!process.env.GEMINI_API_KEY;
  if (!hasKey) {
    const s = await dbGet('settings').catch(() => ({})) || {};
    hasKey = !!(s.geminiKey && decrypt(s.geminiKey));
  }
  res.json({ hasKey });
});

app.post('/fetch-mails', async (req, res) => {
  try {
    const cfg      = req.body;
    if (cfg.pass && cfg.pass.startsWith('enc:')) cfg.pass = decrypt(cfg.pass);
    const limit    = Math.min(parseInt(cfg.limit)    || 250, 1000);
    const offset   = Math.max(parseInt(cfg.offset)   || 0,   0);
    const pageSize = Math.min(parseInt(cfg.pageSize) || 20,  40); // max 40/page → ~20s worst case
    console.log(`[POP3] fetch-mails limit=${limit} offset=${offset} pageSize=${pageSize}`);
    const result = await fetchMails(cfg, limit, offset, pageSize);
    res.json(result);
  } catch(e) {
    console.error('[POP3] hata:', e.message);
    res.status(500).json({ message: e.message });
  }
});

// ─────────────────────────────────────────────────
// 4. STATIC FILES — API route'lardan SONRA
// ─────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders(res, filePath) {
    // MIME type'ları açıkça set et (bazı proxy'ler bozuyor)
    if (filePath.endsWith('.css'))  res.setHeader('Content-Type', 'text/css; charset=utf-8');
    if (filePath.endsWith('.js'))   res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    if (filePath.endsWith('.html')) res.setHeader('Content-Type', 'text/html; charset=utf-8');
  }
}));

// 5. SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── POP3 ──────────────────────────────────────────
const SOCK_TIMEOUT = 20000;

class POP3 {
  constructor(cfg) { this.cfg=cfg; this.socket=null; this.buffer=''; this.lineQueue=[]; this.lineWaiters=[]; }
  connect() {
    return new Promise((resolve, reject) => {
      const { host, port, tls: tlsMode } = this.cfg;
      const p = parseInt(port) || 110;
      const onConn = sock => {
        this.socket=sock; sock.setTimeout(SOCK_TIMEOUT); sock.setEncoding('utf8');
        sock.on('data', c => { this.buffer+=c; this._flush(); });
        sock.on('timeout', () => sock.destroy(new Error('timeout')));
        sock.on('error', e => console.error('[POP3 sock]', e.message));
      };
      if (tlsMode === 'tls') {
        const s = tls_mod.connect({ host, port: p, rejectUnauthorized: false }, () => onConn(s));
        s.on('error', e => reject(e));
      } else {
        const s = net.connect({ host, port: p }, () => onConn(s));
        s.on('error', e => reject(e));
      }
      this._waitLine(10000)
        .then(l => l.startsWith('+OK') ? resolve() : reject(new Error('Sunucu reddetti: '+l)))
        .catch(e => reject(new Error('Greeting timeout: '+e.message)));
    });
  }
  _flush() {
    while (true) {
      const nl=this.buffer.indexOf('\n'); if(nl===-1)break;
      const line=this.buffer.slice(0,nl+1).replace(/\r\n|\n|\r/,'');
      this.buffer=this.buffer.slice(nl+1);
      if(this.lineWaiters.length>0) this.lineWaiters.shift()(null,line);
      else this.lineQueue.push(line);
    }
  }
  _waitLine(timeout=12000) {
    return new Promise((resolve,reject) => {
      if(this.lineQueue.length>0){resolve(this.lineQueue.shift());return;}
      const t=setTimeout(()=>{const i=this.lineWaiters.indexOf(cb);if(i>-1)this.lineWaiters.splice(i,1);reject(new Error(`${timeout/1000}s timeout`));},timeout);
      const cb=(e,l)=>{clearTimeout(t);e?reject(e):resolve(l);};
      this.lineWaiters.push(cb);
    });
  }
  async _cmd(cmd,timeout=12000){this.socket.write(cmd+'\r\n');return this._waitLine(timeout);}
  async _multiLine(){const lines=[];while(true){const l=await this._waitLine();if(l==='.')break;lines.push(l.startsWith('..')?l.slice(1):l);}return lines.join('\n');}
  async login(){
    let r=await this._cmd(`USER ${this.cfg.user}`); if(!r.startsWith('+OK'))throw new Error('USER failed: '+r);
    r=await this._cmd(`PASS ${this.cfg.pass}`);     if(!r.startsWith('+OK'))throw new Error('Şifre hatalı');
    console.log('[POP3] Login OK');
  }
  async list(){const r=await this._cmd('LIST');if(!r.startsWith('+OK'))throw new Error('LIST failed');const d=await this._multiLine();return d.split('\n').filter(Boolean).map(l=>parseInt(l.split(' ')[0])).filter(n=>!isNaN(n));}
  async uidl(id){const r=await this._cmd(`UIDL ${id}`);const m=r.match(/\+OK \d+ (.+)/);return m?m[1].trim():String(id);}
  async retr(id){const r=await this._cmd(`RETR ${id}`,25000);if(!r.startsWith('+OK'))throw new Error('RETR failed');return this._multiLine();}
  quit(){try{if(this.socket&&!this.socket.destroyed){this.socket.write('QUIT\r\n');this.socket.destroy();}}catch{}}
}

async function fetchMails(cfg, limit=250, offset=0, pageSize=20) {
  const pop=new POP3(cfg); const mails=[];
  try {
    await pop.connect(); await pop.login();
    const ids=await pop.list();
    if(!ids.length){pop.quit();return {mails:[],total:0,offset,pageSize,hasMore:false};}
    const newestFirst = ids.slice(-limit).reverse();
    const total       = newestFirst.length;
    const toFetch     = newestFirst.slice(offset, offset + pageSize);
    const hasMore     = (offset + pageSize) < total;
    console.log(`[POP3] toplam:${ids.length} limit:${limit} total:${total} page:[${offset}..${offset+toFetch.length-1}] hasMore:${hasMore}`);
    for(const id of toFetch){
      try{
        const uid=await pop.uidl(id);
        const raw=await pop.retr(id);
        const parsed=await simpleParser(raw);
        const attTexts=[]; const binaryAtts=[];
        if(parsed.attachments){
          for(const a of parsed.attachments){
            if(a.contentType?.includes('text')){attTexts.push(a.content.toString('utf8').slice(0,2000));continue;}
            const isInline=a.contentDisposition==='inline'||!!a.contentId;
            const isGeneric=/^image\d+(\.\w+)?(\.\w+)?$/i.test(a.filename||'');
            if(isInline||isGeneric)continue;
            const isPDF=/\.pdf$/i.test(a.filename||'')||a.contentType?.includes('pdf');
            const isImg=/\.(png|jpg|jpeg|gif|webp)$/i.test(a.filename||'');
            const isOffice=/\.(xls|xlsx|xlsm|csv)$/i.test(a.filename||'');
            const isWord=/\.(doc|docx)$/i.test(a.filename||'');
            if(isWord){attTexts.push(`[EK: ${a.filename} — Word belgesi, sipariş olabilir]`);continue;}
            if(isOffice){
              // Excel/CSV içeriğini oku ve metne çevir
              const excelText = excelToText(a.content, a.filename||'excel');
              attTexts.push(excelText);
              console.log(`[EK] Excel okundu: ${a.filename} (${excelText.length} chr)`);
              continue;
            }
            if(isPDF||isImg){
              const sizeKB=Math.round((a.content?.length||0)/1024);
              if(sizeKB>4096||binaryAtts.length>=5)continue;
              let mime='application/pdf';
              if(isImg){if(/\.png$/i.test(a.filename))mime='image/png';else if(/\.(jpg|jpeg)$/i.test(a.filename))mime='image/jpeg';else if(/\.gif$/i.test(a.filename))mime='image/gif';else if(/\.webp$/i.test(a.filename))mime='image/webp';}
              binaryAtts.push({mimeType:mime,filename:a.filename||'attachment',sizeKB,base64:a.content.toString('base64')});
            }
          }
        }
        mails.push({uid,subject:parsed.subject||'',from:parsed.from?.text||'',date:parsed.date?.toISOString()||new Date().toISOString(),body:extractEmailBody(parsed),attachmentTexts:attTexts,attachments:binaryAtts});
      }catch(e){console.warn(`[POP3] #${id} atlandı: ${e.message}`);}
    }
    pop.quit(); console.log(`[POP3] Bitti: ${mails.length} mail okundu (offset=${offset})`);
    return { mails, total, offset, pageSize, hasMore };
  }catch(e){pop.quit();throw e;}
}

// ── Başlat ────────────────────────────────────────
initRedis().then(() => {
  app.listen(PORT, () => console.log(`✅ Teplast v7 | port:${PORT} | storage:${redisReady?'Redis':'Memory'}`));
});
