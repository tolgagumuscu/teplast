/* app.js — Teplast Sipariş Yönetimi v5
   Özellikler: Otomatik tarama, Bulk işlem, Silme, Birleştirme,
               Bildirim, Scan log kalıcılığı, Şifre sync */

let currentFilter = 'all';
let sortCol = 'createdAt';
let sortDir = -1;

// ── Bulk selection ────────────────────────────────
let _selectedIds = new Set();


/* ── ŞİRKET LOGO HARİTASI ─────────────── */
const COMPANY_LOGOS = {
  'PURPLAST':       'https://s3.eu-central-1.amazonaws.com/www.virtualtours.city/clientpictures/3151/poi/medium/prplast-as.jpg',
  'PÜRPLAST':       'https://s3.eu-central-1.amazonaws.com/www.virtualtours.city/clientpictures/3151/poi/medium/prplast-as.jpg',
  'TEMSA':          'https://cukurovateknokent.com/wp-content/uploads/2025/02/Temsa-logo-1.png',
  'MURAT TİCARET':  'https://media.licdn.com/dms/image/v2/D4E0BAQFY9RbVYsLXdA/company-logo_200_200/company-logo_200_200/0/1695929023820/murat_ticaret_kablo_san_a_s__logo?e=2147483647&v=beta&t=eAUJ34xts__bAeP3zJJXIzuUYaYGamZnOHw1wrlE-sY',
  'MURAT TICARET':  'https://media.licdn.com/dms/image/v2/D4E0BAQFY9RbVYsLXdA/company-logo_200_200/company-logo_200_200/0/1695929023820/murat_ticaret_kablo_san_a_s__logo?e=2147483647&v=beta&t=eAUJ34xts__bAeP3zJJXIzuUYaYGamZnOHw1wrlE-sY',
  'ZD PLASTİK':     'https://delegations.tim.org.tr/storage/uploads/company/43178/conversions/136Vz5Ib9GmWMBuA9HIoTrkVwhdAWGCONSR6UhFY-thumb.jpg',
  'ZD PLASTIK':     'https://delegations.tim.org.tr/storage/uploads/company/43178/conversions/136Vz5Ib9GmWMBuA9HIoTrkVwhdAWGCONSR6UhFY-thumb.jpg',
  'FREUDENBERG':    'https://cdn.worldvectorlogo.com/logos/freudenberg.svg',
  'HAPPICH':        'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRSxF6APXpmlzq8ti_21ZJ3-I4G-luniiF96w&s',
  'OKTEK':          'https://upload-isinolsun-com.mncdn.com/Company/Large/2022/1/21/297718420220121121113772.jpg',
  'VKM PLASTİK':    'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcS5X1J5x5hSwXMueXrUbx9KW10AvdMIiI18Pw&s',
  'VKM PLASTIK':    'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcS5X1J5x5hSwXMueXrUbx9KW10AvdMIiI18Pw&s',
  'NP PLASTİK':     'https://upload-isinolsun-com.mncdn.com/Company/Large/2025/9/17/1036179420250917012749319.jpg',
  'NP PLASTIK':     'https://upload-isinolsun-com.mncdn.com/Company/Large/2025/9/17/1036179420250917012749319.jpg',
  'BUR-CAN':        'https://image5.sahibinden.com/stores/logos/16/07/11/f8fbce851922fdf9a87c9d748cdc56ea96908a79.png',
  'BURCAN':         'https://image5.sahibinden.com/stores/logos/16/07/11/f8fbce851922fdf9a87c9d748cdc56ea96908a79.png',
};

function _normCompany(s) {
  return (s||'').toUpperCase()
    .replace(/[İI]/g,'I').replace(/[Ğ]/g,'G').replace(/[Ü]/g,'U')
    .replace(/[Ö]/g,'O').replace(/[Ş]/g,'S').replace(/[Ç]/g,'C')
    .replace(/[^A-Z0-9]/g,''); // boşluk, tire, nokta hepsini sil
}

function getCompanyLogo(name) {
  if (!name) return null;
  const norm = _normCompany(name);
  // Tam normalize eşleşme
  for (const [k, v] of Object.entries(COMPANY_LOGOS)) {
    if (norm === _normCompany(k)) return v;
  }
  // Kısmi: biri diğerini içeriyor mu?
  for (const [k, v] of Object.entries(COMPANY_LOGOS)) {
    const kn = _normCompany(k);
    if (norm.includes(kn) || kn.includes(norm)) return v;
  }
  return null;
}

function companyAvatarHTML(name, size = 40, extraStyle = '') {
  const logo = getCompanyLogo(name);
  const initials = esc((name||'?').slice(0,2).toUpperCase());
  if (logo) {
    return `<div class="company-avatar company-avatar--logo" style="width:${size}px;height:${size}px;${extraStyle}">
      <img src="${logo}" alt="${initials}" onerror="this.parentElement.classList.remove('company-avatar--logo');this.parentElement.innerHTML='${initials}'" loading="lazy"/>
    </div>`;
  }
  return `<div class="company-avatar" style="width:${size}px;height:${size}px;font-size:${size>36?'.78rem':'.7rem'};${extraStyle}">${initials}</div>`;
}

document.addEventListener('DOMContentLoaded', async () => {
  loadSettings();
  renderBlockedList();
  setupNav();
  setupFilters();
  setupCompanyGridClicks();
  setupKeyboard();
  setupLimitDisplay();
  renderAll();
  updateNavBadges();
  await loadLastScanInfo();
  setupAutoScan();
  requestNotifPermissionIfEnabled();
});

/* ── NAV ──────────────────────────── */
function setupNav() {
  document.querySelectorAll('.nav-link').forEach(el =>
    el.addEventListener('click', e => { e.preventDefault(); switchView(el.dataset.view); })
  );
}
function switchView(v) {
  document.querySelectorAll('.nav-link').forEach(el => el.classList.toggle('active', el.dataset.view === v));
  document.querySelectorAll('.view').forEach(s => s.classList.toggle('active', s.id === 'view-' + v));
  const labels = { dashboard:'Genel Bakış', orders:'Siparişler', companies:'Firmalar', settings:'Ayarlar', stats:'İstatistik' };
  document.getElementById('pageTitle').textContent = labels[v] || v;
  if (v === 'orders')    { clearBulkSelection(); renderOrders(); }
  if (v === 'dashboard') renderDashboard();
  if (v === 'companies') renderCompanies();
  if (v === 'settings')  renderBlockedList();
  if (v === 'stats')     renderStats();
}
function updateNavBadges() {
  const orders  = Storage.getOrders();
  const pending = orders.filter(o => o.status === 'new' || o.status === 'processing').length;
  const comps   = new Set(orders.map(o => o.companyName)).size;
  const ob = document.getElementById('navBadgeOrders');
  const cb = document.getElementById('navBadgeCompanies');
  const mb = document.getElementById('mbnBadgeOrders');
  if (ob) { ob.textContent = pending; ob.style.display = pending > 0 ? 'inline-flex' : 'none'; }
  if (cb) { cb.textContent = comps;   cb.style.display = comps   > 0 ? 'inline-flex' : 'none'; }
  if (mb) { mb.textContent = pending; mb.style.display = pending > 0 ? 'flex'         : 'none'; }
}

/* ── KEYBOARD ─────────────────────── */
function setupKeyboard() {
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeModalDirect();
  });
}

/* ── FILTERS ──────────────────────── */
function setupFilters() {
  document.querySelectorAll('.pill').forEach(btn =>
    btn.addEventListener('click', () => {
      document.querySelectorAll('.pill').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.filter;
      document.getElementById('dateFrom').value = '';
      document.getElementById('dateTo').value   = '';
      renderAll();
    })
  );
  ['dateFrom','dateTo'].forEach(id => {
    document.getElementById(id).addEventListener('change', () => {
      currentFilter = 'custom';
      document.querySelectorAll('.pill').forEach(b => b.classList.remove('active'));
      renderAll();
    });
  });
  document.getElementById('statusFilter').addEventListener('change', renderAll);
}

function getFiltered() {
  let orders = Storage.getOrders();
  const now  = new Date();
  if (currentFilter === 'week') {
    const ago = new Date(now); ago.setDate(ago.getDate()-7);
    orders = orders.filter(o => new Date(o.createdAt) >= ago);
  } else if (currentFilter === 'month') {
    const ago = new Date(now); ago.setMonth(ago.getMonth()-1);
    orders = orders.filter(o => new Date(o.createdAt) >= ago);
  } else if (currentFilter === 'custom') {
    const from = document.getElementById('dateFrom').value;
    const to   = document.getElementById('dateTo').value;
    if (from) orders = orders.filter(o => new Date(o.createdAt) >= new Date(from));
    if (to)   orders = orders.filter(o => new Date(o.createdAt) <= new Date(to + 'T23:59:59'));
  }
  const st = document.getElementById('statusFilter').value;
  if (st && st !== 'all') orders = orders.filter(o => o.status === st);
  return orders;
}

function getSorted(orders) {
  return [...orders].sort((a,b) => {
    let va = a[sortCol]||'', vb = b[sortCol]||'';
    if (sortCol === 'createdAt' || sortCol === 'terminDate') {
      va = va ? new Date(va).getTime() : 0;
      vb = vb ? new Date(vb).getTime() : 0;
    }
    if (va < vb) return -sortDir;
    if (va > vb) return  sortDir;
    return 0;
  });
}
function setSort(col) {
  if (sortCol === col) sortDir *= -1;
  else { sortCol = col; sortDir = -1; }
  renderOrders();
}
function renderAll() { renderDashboard(); renderOrders(); renderCompanies(); updateNavBadges(); }

/* ── OVERDUE ──────────────────────── */
function isOverdue(o) {
  if (!o.terminDate || o.status === 'done' || o.status === 'cancelled') return false;
  return new Date(o.terminDate) < new Date();
}
function terminCountdown(terminDate) {
  if (!terminDate) return '';
  const diff = Math.round((new Date(terminDate) - new Date()) / 86400000);
  if (diff < 0)   return `<span class="termin-badge termin-overdue">⚠ ${Math.abs(diff)}g geçti</span>`;
  if (diff === 0) return `<span class="termin-badge termin-today">⏰ Bugün</span>`;
  if (diff <= 3)  return `<span class="termin-badge termin-soon">${diff}g kaldı</span>`;
  return `<span class="termin-badge termin-ok">${diff}g kaldı</span>`;
}

/* ── DASHBOARD ────────────────────── */
function renderDashboard() {
  const all      = Storage.getOrders();
  const filtered = getFiltered();
  const weekAgo  = new Date(); weekAgo.setDate(weekAgo.getDate()-7);
  const overdue  = all.filter(isOverdue).length;

  document.getElementById('statTotal').textContent  = filtered.length;
  document.getElementById('statNew').textContent    = filtered.filter(o => o.status==='new'||o.status==='processing').length;
  document.getElementById('statDone').textContent   = filtered.filter(o => o.status==='done').length;
  document.getElementById('statWeek').textContent   = all.filter(o => new Date(o.createdAt) >= weekAgo).length;

  const kpiOverdue = document.getElementById('kpiOverdue');
  if (kpiOverdue) {
    kpiOverdue.style.display = overdue > 0 ? 'flex' : 'none';
    document.getElementById('statOverdue').textContent = overdue;
  }
  document.getElementById('recentOrders').innerHTML = buildTable(getSorted(getFiltered()).slice(0,10), true);
}

/* ── ORDERS ───────────────────────── */
function renderOrders() {
  const q = (document.getElementById('searchInput')?.value || '').toLowerCase();
  let orders = getFiltered();
  if (q) orders = orders.filter(o =>
    [o.companyName||'', o.productStr||'', o.from||'', o.senderName||'', o.subject||''].some(s => s.toLowerCase().includes(q))
  );
  document.getElementById('ordersTable').innerHTML = buildTable(getSorted(orders), false);
  _renderBulkToolbar();
}

/* ── COMPANIES ────────────────────── */
function setupCompanyGridClicks() {
  document.getElementById('companiesGrid').addEventListener('click', e => {
    const card = e.target.closest('.company-card');
    if (card?.dataset.company) showCompanyOrders(card.dataset.company);
  });
}
function renderCompanies() {
  const el = document.getElementById('companiesGrid'); if (!el) return;
  const q  = (document.getElementById('companySearch')?.value || '').toLowerCase();
  const orders = Storage.getOrders();
  const DEFAULT_BLOCKED = ['oversea@g0riller.net','egitim@seckindanismanlik.com.tr','metin@mghlojistik.com'];
  const blocked = [...DEFAULT_BLOCKED, ...Storage.getBlockedList()].map(b => b.toLowerCase());
  const visible = orders.filter(o => !blocked.some(b => (o.from||'').toLowerCase().includes(b)));
  const groups  = {};
  for (const o of visible) {
    const k = (o.companyName||'—').trim();
    if (!groups[k]) groups[k] = { name:k, orders:[], contacts:new Set(), total:0, pending:0, done:0, overdue:0 };
    groups[k].orders.push(o); groups[k].total++;
    if (o.status==='new'||o.status==='processing') groups[k].pending++;
    if (o.status==='done') groups[k].done++;
    if (isOverdue(o)) groups[k].overdue++;
    if (o.senderName && o.senderName!=='—') groups[k].contacts.add(o.senderName);
  }
  let sorted = Object.values(groups).sort((a,b) => b.total-a.total);
  if (q) sorted = sorted.filter(g => g.name.toLowerCase().includes(q));
  if (!sorted.length) { el.innerHTML = `<div class="empty"><p>Henüz firma kaydı yok</p></div>`; return; }
  el.innerHTML = sorted.map(g => {
    const contactStr = [...g.contacts].slice(0,3).join(', ') || (g.orders[0]?.from||'').replace(/<[^>]+>/,'').trim();
    const subjects   = [...new Set(g.orders.map(o => o.subject).filter(Boolean))].slice(0,2);
    return `<div class="company-card${g.overdue>0?' company-card--overdue':''}" data-company="${esc(g.name)}">
      <div class="company-card-head">
        ${companyAvatarHTML(g.name, 40)}
        <div class="company-info">
          <div class="company-name">${esc(g.name)}${g.overdue>0?` <span class="overdue-dot">!</span>`:''}</div>
          <div class="company-contact">${esc(contactStr)}</div>
        </div>
        <div class="company-badge">${g.total}</div>
      </div>
      <div class="company-stats">
        <span class="cstat cstat-pending">⏳ ${g.pending} bekliyor</span>
        <span class="cstat cstat-done">✓ ${g.done} tamamlandı</span>
        ${g.overdue>0?`<span class="cstat cstat-overdue">⚠ ${g.overdue} gecikiyor</span>`:''}
      </div>
      <div class="company-subjects">${subjects.map(s=>`<span class="subject-tag">${esc(s.slice(0,35))}</span>`).join('')}</div>
    </div>`;
  }).join('');
}

function showCompanyOrders(name) {
  const orders = Storage.getOrders().filter(o => o.companyName === name);
  const contacts = [...new Set(orders.map(o => o.senderName).filter(s => s&&s!=='—'))].join(', ');
  document.getElementById('modalTitle').textContent = name;
  document.getElementById('modalBody').innerHTML = `
    <div style="margin-bottom:14px;display:flex;align-items:center;gap:10px">
      ${companyAvatarHTML(name, 36)}
      <div>
        <div style="font-weight:700;color:var(--navy)">${esc(name)}</div>
        <div style="font-size:.72rem;color:var(--gray-400)">${orders.length} sipariş · ${esc(contacts)}</div>
      </div>
    </div>
    ${buildTable(getSorted(orders), true)}
    <div class="modal-actions"><button class="btn-modal-cancel" onclick="closeModalDirect()">Kapat</button></div>`;
  document.getElementById('modalOverlay').classList.add('open');
}

/* ── TABLE ────────────────────────── */
function buildTable(orders, readOnly = false) {
  if (!orders.length) return `<div class="empty">
    <svg viewBox="0 0 24 24"><path d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2h5M15 21l2 2 4-4" stroke-linecap="round" stroke-linejoin="round"/></svg>
    <p>Gösterilecek sipariş yok</p></div>`;

  const colDefs = [
    { key:'createdAt', label:'Tarih' }, { key:'companyName', label:'Firma' },
    { key:'senderName', label:'Yetkili' }, { key:'productStr', label:'Ürün(ler)' },
    { key:'terminDate', label:'Termin' }, { key:'status', label:'Durum' },
  ];
  const headers = (readOnly ? '' : `<th class="th-checkbox"><input type="checkbox" id="checkAll" onclick="toggleSelectAll(this)" title="Tümünü seç"/></th>`)
    + colDefs.map(c => {
      const active = sortCol === c.key;
      const arrow  = active ? (sortDir===-1 ? ' ↓' : ' ↑') : '';
      return `<th class="th-sortable${active?' th-sorted':''}" onclick="setSort('${c.key}')">${c.label}${arrow}</th>`;
    }).join('');

  return `<table class="tbl">
    <thead><tr>${headers}</tr></thead>
    <tbody>${orders.map(o => {
      const overdue = isOverdue(o);
      const checked = _selectedIds.has(o.id) ? ' checked' : '';
      const checkTd = readOnly ? '' : `<td class="td-check" onclick="event.stopPropagation()"><input type="checkbox" data-id="${esc(o.id)}"${checked} onchange="toggleSelect(this)"/></td>`;
      return `<tr data-id="${esc(o.id)}" class="tbl-row-click${overdue?' row-overdue':''}">
        ${checkTd}
        <td class="td-date">${fmtDate(o.createdAt)}${o.threadCount>1?`<span class="thread-badge">🔗${o.threadCount}</span>`:''}</td>
        <td class="td-company">
          <div style="display:flex;align-items:center;gap:7px">
            ${(()=>{const lg=getCompanyLogo(o.companyName);return lg?`<img src="${lg}" class="tbl-company-logo" onerror="this.style.display='none'" loading="lazy"/>`:'';})()}
            <span>${esc(toTitleCase(o.companyName))}</span>
          </div>
        </td>
        <td class="td-contact">${esc(o.senderName!=='—'?o.senderName:'')}</td>
        <td class="${o.productStr&&!o.productStr.startsWith('(Konu:')?'td-product':'td-product td-subject'}" title="${esc(o.productStr||o.subject||'')}">
          ${o.productStr&&!o.productStr.startsWith('(Konu:') ? esc(o.productStr) : (o.subject ? esc(o.subject.replace(/^Re:\s*/i,'').slice(0,55))+(o.subject.length>55?'…':'') : '—')}
        </td>
        <td class="td-termin">${o.terminDate?fmtDate(o.terminDate,true):(o.deliveryWeek||'—')}${o.terminDate?terminCountdown(o.terminDate):''}</td>
        <td><span class="badge badge-${o.status}">${statusLabel(o.status)}</span></td>
      </tr>`;
    }).join('')}</tbody></table>`;
}

document.addEventListener('click', e => {
  const row = e.target.closest('.tbl-row-click');
  if (row && row.dataset.id && !e.target.closest('.td-check')) openOrderModal(row.dataset.id);
});

/* ── BULK SELECTION ───────────────── */
function toggleSelect(checkbox) {
  const id = checkbox.dataset.id;
  if (checkbox.checked) _selectedIds.add(id);
  else _selectedIds.delete(id);
  _renderBulkToolbar();
  _syncCheckAll();
}
function toggleSelectAll(masterCb) {
  const checkboxes = document.querySelectorAll('#ordersTable input[type=checkbox][data-id]');
  checkboxes.forEach(cb => {
    cb.checked = masterCb.checked;
    if (masterCb.checked) _selectedIds.add(cb.dataset.id);
    else _selectedIds.delete(cb.dataset.id);
  });
  _renderBulkToolbar();
}
function _syncCheckAll() {
  const all = document.querySelectorAll('#ordersTable input[type=checkbox][data-id]');
  const ca  = document.getElementById('checkAll');
  if (ca && all.length > 0) ca.checked = [...all].every(c => c.checked);
}
function clearBulkSelection() {
  _selectedIds.clear();
  _renderBulkToolbar();
  document.querySelectorAll('input[type=checkbox][data-id]').forEach(c => c.checked = false);
  const ca = document.getElementById('checkAll'); if (ca) ca.checked = false;
}
function _renderBulkToolbar() {
  const toolbar = document.getElementById('bulkToolbar'); if (!toolbar) return;
  const n = _selectedIds.size;
  toolbar.style.display = n > 0 ? 'flex' : 'none';
  const cnt = document.getElementById('bulkCount');
  if (cnt) cnt.textContent = `${n} sipariş seçili`;
}
function applyBulkStatus() {
  const st = document.getElementById('bulkStatus')?.value;
  if (!st) { showToast('Durum seçin', 'err'); return; }
  if (!_selectedIds.size) return;
  _selectedIds.forEach(id => Storage.updateOrder(id, { status: st }));
  showToast(`${_selectedIds.size} sipariş güncellendi`, 'ok');
  clearBulkSelection();
  renderAll();
}
function bulkDelete() {
  const n = _selectedIds.size;
  if (!n) return;
  if (!confirm(`${n} sipariş silinsin mi? Bu işlem geri alınamaz.`)) return;
  _selectedIds.forEach(id => Storage.deleteOrder(id));
  showToast(`${n} sipariş silindi`, 'ok');
  clearBulkSelection();
  renderAll();
}

/* ── CSV EXPORT ───────────────────── */
function exportCSV() {
  const orders = getSorted(getFiltered());
  if (!orders.length) { showToast('Dışa aktarılacak sipariş yok', 'err'); return; }
  const header = ['Tarih','Firma','Yetkili','Mail','Ürünler','Termin','Durum','Not','Konu'];
  const rows = orders.map(o => [
    fmtDate(o.createdAt), o.companyName||'', o.senderName||'',
    (o.from||'').replace(/<[^>]+>/g,'').trim(),
    o.productStr||'', o.terminDate?fmtDate(o.terminDate,true):(o.deliveryWeek||''),
    statusLabel(o.status), o.notes||'', o.subject||'',
  ].map(v => `"${String(v).replace(/"/g,'""')}"`));
  const csv  = [header.join(','), ...rows.map(r=>r.join(','))].join('\n');
  const blob = new Blob(['\uFEFF'+csv], {type:'text/csv;charset=utf-8'});
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = `teplast-${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  showToast(`${orders.length} sipariş dışa aktarıldı`, 'ok');
}

/* ── ORDER MODAL ──────────────────── */
function openOrderModal(id) {
  const o = Storage.getOrders().find(x => x.id === id); if (!o) return;

  const chips = (o.products||[]).map(p => `
    <span class="product-chip">
      <strong>${esc(p.name)}</strong>
      ${p.quantity?`<span class="qty">${esc(p.quantity)}</span>`:''}
      ${p.code?`<span class="code">[${esc(p.code)}]</span>`:''}
      ${p.note?`<span style="color:var(--ink-4);font-size:.7rem">${esc(p.note)}</span>`:''}
    </span>`).join('') || '<span style="color:var(--ink-4);font-size:.8rem">—</span>';

  const overdueB = isOverdue(o) ? `<div class="overdue-banner">⚠ Termin tarihi geçti — lütfen durumu güncelleyin</div>` : '';

  // Birleştirilebilir siparişler (aynı firma, 30 gün içinde, farklı ID)
  const mergeables = Storage.getOrders().filter(x =>
    x.id !== id &&
    x.companyName === o.companyName &&
    Math.abs(new Date(x.createdAt) - new Date(o.createdAt)) < 30 * 86400000 &&
    x.status !== 'cancelled'
  ).slice(0,3);

  const mergeSection = mergeables.length > 0 ? `
    <div class="merge-section">
      <div class="merge-section-title">🔗 Bu firmadan benzer siparişler — birleştir?</div>
      ${mergeables.map(m => `
        <div class="merge-item">
          <span class="merge-item-info">${fmtDate(m.createdAt,true)} — ${esc((m.productStr||m.subject||'').slice(0,40))}</span>
          <button class="btn-merge" onclick="mergeOrders('${esc(id)}','${esc(m.id)}')">Birleştir</button>
        </div>`).join('')}
    </div>` : '';

  const rawBodySection = o.rawBody ? `
    <div style="margin-top:8px">
      <div style="font-size:.68rem;font-weight:700;color:var(--ink-4);text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px;display:flex;align-items:center;justify-content:space-between">
        Mail İçeriği
        <button class="btn-copy" onclick="toggleFullBody('mailBodyEl')" id="mailBodyToggle">Tamamını Gör</button>
      </div>
      <div class="mail-preview" id="mailBodyEl" style="max-height:120px;overflow:hidden">${esc(o.rawBody)}</div>
    </div>` : '';

  const _logo = getCompanyLogo(o.companyName);
  document.getElementById('modalTitle').innerHTML = (_logo
    ? `<img src="${_logo}" class="modal-company-logo" onerror="this.style.display='none'" loading="lazy"/> `
    : '') + esc(o.companyName) + ' — Sipariş';
  document.getElementById('modalBody').innerHTML = `
    ${overdueB}
    <div class="mfield"><label>Tarih</label><div class="mfield-val">${fmtDate(o.createdAt)}</div></div>
    <div class="mfield"><label>Firma</label><div class="mfield-val">${esc(o.companyName)}</div></div>
    <div class="mfield"><label>Yetkili</label><div class="mfield-val">${esc(o.senderName)}</div></div>
    <div class="mfield"><label>Mail</label>
      <div class="mfield-val" style="font-size:.76rem;display:flex;align-items:center;gap:6px">
        ${esc(o.from)}
        <button class="btn-copy" onclick="copyText('${esc((o.from||'').match(/<([^>]+)>/)?.[1]||o.from)}')" title="Kopyala">⎘</button>
      </div>
    </div>
    <div class="mfield"><label>Konu</label><div class="mfield-val" style="font-size:.76rem">
      ${esc(o.subject)}${o.threadCount>1?`<span class="thread-badge">🔗${o.threadCount} mesaj</span>`:''}
    </div></div>
    <div class="mfield"><label>Ürünler</label><div style="flex:1;padding-top:4px">${chips}</div></div>
    <div class="mfield"><label>Termin</label>
      <div style="display:flex;align-items:center;gap:8px;flex:1">
        <input type="date" id="mTermin" value="${o.terminDate||''}"/>
        ${o.terminDate?terminCountdown(o.terminDate):''}
      </div>
    </div>
    ${o.deliveryWeek?`<div class="mfield"><label>Teslimat</label><div class="mfield-val">${esc(o.deliveryWeek)}</div></div>`:''}
    <div class="mfield"><label>Durum</label>
      <select id="mStatus">${['new','processing','shipped','done','cancelled']
        .map(s=>`<option value="${s}"${o.status===s?' selected':''}>${statusLabel(s)}</option>`).join('')}</select>
    </div>
    <div class="mfield"><label>Not</label><input type="text" id="mNotes" value="${esc(o.notes||'')}" placeholder="İç not…"/></div>
    ${o.summary?`<div class="mfield"><label>AI Özeti</label><div class="mfield-val" style="font-size:.76rem;color:var(--ink-3);font-style:italic">${esc(o.summary)}</div></div>`:''}
    <div class="mfield"><label>Tespit</label><div class="mfield-val" style="font-size:.72rem;color:var(--ink-4)">${o.detectedBy||'—'} · güven ${((o.confidence||0)*100).toFixed(0)}%</div></div>
    ${rawBodySection}
    ${mergeSection}
    <div class="modal-actions">
      <button class="btn-modal-save" onclick="saveOrderModal('${esc(id)}')">Kaydet</button>
      <button class="btn-modal-cancel" onclick="closeModalDirect()">Kapat</button>
      <button class="btn-modal-cancel btn-modal-delete" onclick="deleteOrderOnly('${esc(id)}')">Sil</button>
      <button class="btn-modal-cancel" onclick="blockAndDelete('${esc(id)}')" style="margin-left:auto;color:var(--red);border-color:var(--red)">Engelle & Sil</button>
    </div>`;
  document.getElementById('modalOverlay').classList.add('open');
}

function toggleFullBody(elId) {
  const el  = document.getElementById(elId);
  const btn = document.getElementById('mailBodyToggle');
  if (!el) return;
  if (el.style.maxHeight === 'none') {
    el.style.maxHeight = '120px'; el.style.overflow = 'hidden';
    if (btn) btn.textContent = 'Tamamını Gör';
  } else {
    el.style.maxHeight = 'none'; el.style.overflow = 'auto';
    if (btn) btn.textContent = 'Küçült';
  }
}

function copyText(text) {
  navigator.clipboard.writeText(text).then(() => showToast('Kopyalandı', 'ok'));
}

function saveOrderModal(id) {
  Storage.updateOrder(id, {
    status:     document.getElementById('mStatus').value,
    terminDate: document.getElementById('mTermin').value || null,
    notes:      document.getElementById('mNotes').value,
  });
  closeModalDirect(); renderAll(); showToast('Kaydedildi', 'ok');
}

// Silme (bloklamadan)
function deleteOrderOnly(id) {
  if (!confirm('Bu sipariş silinsin mi?')) return;
  Storage.deleteOrder(id);
  closeModalDirect(); renderAll();
  showToast('Sipariş silindi', 'ok');
}

function blockAndDelete(id) {
  const o = Storage.getOrders().find(x => x.id === id); if (!o) return;
  const email = (o.from||'').match(/<([^>]+)>/)?.[1] || o.from || '';
  if (email && confirm(`"${email}" engellensin mi?`)) {
    Storage.addBlocked(email);
    Storage.deleteOrder(id);
    closeModalDirect(); renderAll(); renderBlockedList();
    showToast('Engellendi ve silindi', 'ok');
  }
}

// Sipariş birleştirme
function mergeOrders(keepId, removeId) {
  const keep   = Storage.getOrders().find(o => o.id === keepId);
  const remove = Storage.getOrders().find(o => o.id === removeId);
  if (!keep || !remove) return;

  // Ürünleri birleştir (isim bazında deduplicate)
  const allProducts = [...(keep.products||[]), ...(remove.products||[])];
  const uniqueProds = [];
  const seen = new Set();
  for (const p of allProducts) {
    const key = (p.name||'').toLowerCase();
    if (!seen.has(key)) { seen.add(key); uniqueProds.push(p); }
  }
  const productStr = uniqueProds.map(p =>
    [p.name, p.code?`[${p.code}]`:'', p.quantity?`× ${p.quantity}`:''].filter(Boolean).join(' ')
  ).join(', ');

  // Notları birleştir
  const notes = [keep.notes, remove.notes].filter(Boolean).join(' | ');

  // En erken tarihi al
  const earliestDate = new Date(keep.createdAt) < new Date(remove.createdAt) ? keep.createdAt : remove.createdAt;

  Storage.updateOrder(keepId, {
    products:    uniqueProds,
    productStr,
    notes,
    createdAt:   earliestDate,
    threadCount: (keep.threadCount||1) + (remove.threadCount||1),
  });
  Storage.deleteOrder(removeId);
  closeModalDirect();
  renderAll();
  showToast('Siparişler birleştirildi ✓', 'ok');
}

function openAddModal() {
  document.getElementById('modalTitle').textContent = 'Manuel Sipariş Ekle';
  document.getElementById('modalBody').innerHTML = `
    <div class="mfield"><label>Firma</label><input type="text" id="aCompany" placeholder="Firma adı"/></div>
    <div class="mfield"><label>Yetkili</label><input type="text" id="aSender" placeholder="Ad Soyad"/></div>
    <div class="mfield"><label>Mail</label><input type="email" id="aFrom" placeholder="email@firma.com"/></div>
    <div class="mfield"><label>Ürün</label><input type="text" id="aProduct" placeholder="Ürün / kod / miktar"/></div>
    <div class="mfield"><label>Sipariş Tarihi</label><input type="date" id="aDate" value="${new Date().toISOString().slice(0,10)}"/></div>
    <div class="mfield"><label>Termin</label><input type="date" id="aTermin"/></div>
    <div class="mfield"><label>Durum</label>
      <select id="aStatus">${['new','processing','shipped','done','cancelled'].map(s=>`<option value="${s}">${statusLabel(s)}</option>`).join('')}</select>
    </div>
    <div class="mfield"><label>Not</label><input type="text" id="aNotes" placeholder="Not…"/></div>
    <div class="modal-actions">
      <button class="btn-modal-save" onclick="saveManualOrder()">Ekle</button>
      <button class="btn-modal-cancel" onclick="closeModalDirect()">İptal</button>
    </div>`;
  document.getElementById('modalOverlay').classList.add('open');
}

function saveManualOrder() {
  const company = document.getElementById('aCompany').value.trim();
  const product = document.getElementById('aProduct').value.trim();
  if (!company && !product) { showToast('Firma veya ürün girin', 'err'); return; }
  Storage.addOrder({
    id:'manual-'+Date.now(), mailId:null, threadCount:1,
    createdAt:new Date(document.getElementById('aDate').value||Date.now()).toISOString(),
    updatedAt:new Date().toISOString(), subject:'(Manuel)',
    from:document.getElementById('aFrom').value, rawBody:'',
    companyName:company||'—', senderName:document.getElementById('aSender').value,
    productStr:product, products:[{name:product,code:null,quantity:null,note:''}],
    terminDate:document.getElementById('aTermin').value||null,
    status:document.getElementById('aStatus').value,
    notes:document.getElementById('aNotes').value,
    summary:'(Manuel)', confidence:1, detectedBy:'manual',
  });
  closeModalDirect(); renderAll(); showToast('Eklendi', 'ok');
}

function closeModal(e)  { if (e.target.id === 'modalOverlay') closeModalDirect(); }
function closeModalDirect() { document.getElementById('modalOverlay').classList.remove('open'); }

/* ── BLOCKED LIST ─────────────────── */
function renderBlockedList() {
  const el = document.getElementById('blockedList'); if (!el) return;
  const defaults = ['oversea@g0riller.net','egitim@seckindanismanlik.com.tr','metin@mghlojistik.com'];
  const custom   = Storage.getBlockedList();
  const all      = [...new Set([...defaults, ...custom])];
  if (!all.length) { el.innerHTML = '<p style="font-size:.75rem;color:var(--ink-4)">Engellenen yok</p>'; return; }
  el.innerHTML = all.map(e => `
    <div class="blocked-item">
      <span>${esc(e)}</span>
      ${custom.includes(e)
        ? `<button onclick="removeBlocked('${esc(e)}')">✕</button>`
        : `<span style="font-size:.68rem;color:var(--ink-4)">varsayılan</span>`}
    </div>`).join('');
}
function addBlocked() {
  const inp = document.getElementById('newBlockedEmail');
  const val = (inp?.value||'').trim(); if (!val) return;
  Storage.addBlocked(val); inp.value = '';
  renderBlockedList(); renderCompanies();
  showToast(`Engellendi: ${val}`, 'ok');
}
function removeBlocked(email) {
  Storage.removeBlocked(email);
  renderBlockedList(); renderCompanies(); showToast('Engel kaldırıldı');
}

/* ── CLEAR ────────────────────────── */
function clearDashboard() {
  const count = Storage.getOrders().length;
  if (!confirm(`${count} sipariş ve tüm taranan mail geçmişi silinecek. Emin misin?`)) return;
  Storage.clearAll(); renderAll(); showToast('Dashboard temizlendi', 'ok');
}

/* ── SCAN OVERLAY ─────────────────── */
let _overlayFoundCount = 0;
function showScanOverlay() {
  _overlayFoundCount = 0;
  const el = document.getElementById('scanOverlay');
  el.classList.add('visible'); el.classList.remove('minimized');
  el.style.bottom='24px'; el.style.right='24px'; el.style.top='auto'; el.style.left='auto'; el.style.transform='';
  document.getElementById('scanOverlayFound').textContent = '';
  document.getElementById('scanOverlayBar').style.width  = '0%';
  document.getElementById('scanOverlayLabel').textContent = 'Başlatılıyor…';
  document.getElementById('scanOverlayStep').textContent  = '0 / 0 thread';
  document.getElementById('scanOverlayPct').textContent   = '0%';
  document.getElementById('scanOverlaySpinner').style.display = 'block';
  ['scanStatTotal','scanStatNew','scanStatThreads'].forEach(id => { document.getElementById(id).textContent = '—'; });
  document.getElementById('scanStatFound').textContent = '0';
}
function updateScanOverlay(cur,total,msg) {
  const pct = total>0?Math.round(cur/total*100):0;
  document.getElementById('scanOverlayBar').style.width   = pct+'%';
  document.getElementById('scanOverlayLabel').textContent = msg||'…';
  document.getElementById('scanOverlayStep').textContent  = total>0?`${cur} / ${total} thread`:'…';
  document.getElementById('scanOverlayPct').textContent   = total>0?pct+'%':'…';
}
function setScanOverlayStats(total,newMails,threads) {
  if (total   !==undefined) document.getElementById('scanStatTotal').textContent   = total;
  if (newMails!==undefined) document.getElementById('scanStatNew').textContent     = newMails;
  if (threads !==undefined) document.getElementById('scanStatThreads').textContent = threads;
}
function finishScanOverlay(newOrders) {
  document.getElementById('scanOverlayBar').style.width  = '100%';
  document.getElementById('scanOverlayPct').textContent  = '100%';
  document.getElementById('scanOverlaySpinner').style.display = 'none';
  document.getElementById('scanOverlayLabel').textContent = newOrders>0?`✅ ${newOrders} yeni sipariş!`:'✅ Tamamlandı — yeni sipariş yok';
  document.getElementById('scanStatFound').textContent   = newOrders;
  if (newOrders===0) setTimeout(hideScanOverlay, 4000);
}
function hideScanOverlay() { document.getElementById('scanOverlay').classList.remove('visible'); }
function incrementOverlayFound(order) {
  _overlayFoundCount++;
  document.getElementById('scanStatFound').textContent = _overlayFoundCount;
  document.getElementById('scanOverlayFound').textContent = `📦 ${order.companyName||'Sipariş'} bulundu`;
}

// Sürükle
(function initDrag() {
  let dragging=false, startX, startY, origLeft, origTop;
  document.addEventListener('DOMContentLoaded', () => {
    const handle=document.getElementById('scanOverlayDragHandle');
    const panel =document.getElementById('scanOverlay');
    if (!handle||!panel) return;
    handle.addEventListener('mousedown', e => {
      if (e.target.closest('button')) return;
      dragging=true;
      const rect=panel.getBoundingClientRect();
      origLeft=rect.left; origTop=rect.top; startX=e.clientX; startY=e.clientY;
      panel.style.bottom='auto'; panel.style.right='auto';
      panel.style.left=origLeft+'px'; panel.style.top=origTop+'px';
      e.preventDefault();
    });
    document.addEventListener('mousemove', e => {
      if (!dragging) return;
      const dx=e.clientX-startX, dy=e.clientY-startY;
      panel.style.left=Math.max(0,Math.min(window.innerWidth-panel.offsetWidth,origLeft+dx))+'px';
      panel.style.top=Math.max(0,Math.min(window.innerHeight-panel.offsetHeight,origTop+dy))+'px';
    });
    document.addEventListener('mouseup', () => { dragging=false; });
    handle.querySelector('.scan-overlay-close')?.addEventListener('click', () => {
      panel.classList.toggle('minimized');
      const btn=handle.querySelector('.scan-overlay-close');
      btn.textContent = panel.classList.contains('minimized') ? '▲' : '—';
    });
  });
})();

/* ── SCAN LOG ─────────────────────── */
let _logBody    = null;
let _logEntries = []; // tarama sırasında biriktir

function addScanLog(msg, type='info') {
  const panel = document.getElementById('scanLogPanel'); if (!panel) return;
  panel.style.display = 'block';
  if (!_logBody) _logBody = document.getElementById('scanLogBody');
  if (!_logBody) return;
  const icons = { info:'▶', success:'✅', warn:'⚠️', error:'🔴' };
  const time  = new Date().toLocaleTimeString('tr-TR',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
  const el    = document.createElement('div');
  el.className= `scan-log-entry log-${type}`;
  el.innerHTML= `<span class="log-icon">${icons[type]||'▶'}</span><span class="log-msg">${esc(msg)}</span><span class="log-time">${time}</span>`;
  _logBody.appendChild(el);
  _logBody.scrollTop = _logBody.scrollHeight;
  while(_logBody.children.length>300) _logBody.removeChild(_logBody.firstChild);
  _logEntries.push({ logged_at: new Date().toISOString(), level: type, message: msg });
}

async function loadLastScanInfo() {
  try {
    const summary = await Storage.loadLastScanSummary();
    if (!summary) return;
    const el = document.getElementById('lastScanInfo');
    if (el) {
      const t = new Date(summary.scannedAt).toLocaleTimeString('tr-TR',{hour:'2-digit',minute:'2-digit'});
      el.textContent = `Son: ${t} | ${summary.newOrders||0} sipariş, ${summary.total||0} mail`;
    }
  } catch {}
}

/* ── OTOMATIK TARAMA ──────────────── */
let _autoTimer    = null;
let _autoInterval = 0;

function setupAutoScan() {
  const cfg = Storage.getSettings();
  _autoInterval = parseInt(cfg.autoScanInterval) || 0;
  if (_autoTimer) { clearInterval(_autoTimer); _autoTimer = null; }
  if (_autoInterval <= 0) { _updateAutoScanUI('Otomatik tarama kapalı'); return; }
  _autoTimer = setInterval(() => {
    const btn = document.getElementById('syncBtn');
    if (!btn?.disabled) startSync();
  }, _autoInterval * 60 * 1000);
  _updateAutoScanUI(`Her ${_autoInterval} dk otomatik`);
}

function _updateAutoScanUI(text) {
  const el = document.getElementById('autoScanLabel'); if (el) el.textContent = text;
}

/* ── BİLDİRİM ─────────────────────── */
function requestNotifPermissionIfEnabled() {
  const cfg = Storage.getSettings();
  if (cfg.notifications && Notification.permission === 'default') requestNotificationPermission();
}

async function requestNotificationPermission() {
  if (!('Notification' in window)) { showToast('Bu tarayıcı bildirimi desteklemiyor', 'err'); return; }
  const perm = await Notification.requestPermission();
  if (perm === 'granted') showToast('Bildirim izni verildi ✓', 'ok');
  else showToast('Bildirim izni reddedildi', 'err');
  const btn = document.getElementById('notifPermBtn');
  if (btn) _updateNotifBtn(btn);
}

function _updateNotifBtn(btn) {
  if (!('Notification' in window)) { btn.textContent = 'Desteklenmiyor'; btn.disabled=true; return; }
  if (Notification.permission === 'granted') { btn.textContent = '✓ İzin Verildi'; btn.style.color='var(--green)'; btn.disabled=true; }
  else { btn.textContent = 'İzin Ver'; btn.disabled=false; }
}

function _sendNotification(title, body) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    new Notification(title, { body, icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='6' fill='%232563EB'/%3E%3Ctext x='16' y='22' text-anchor='middle' font-family='system-ui' font-weight='800' font-size='18' fill='white'%3ET%3C/text%3E%3C/svg%3E" });
  } catch {}
}

function _playBeep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain= ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.4);
  } catch {}
}

/* ── ANA TARAMA ───────────────────── */
async function startSync() {
  const btn    = document.getElementById('syncBtn');
  const icon   = document.getElementById('syncIcon');
  const status = document.getElementById('scanStatus');
  const counter= document.getElementById('scanCounter');
  const pWrap  = document.getElementById('pbarWrap');
  const pBar   = document.getElementById('pbar');

  _logBody = document.getElementById('scanLogBody');
  if (_logBody) _logBody.innerHTML = '';
  _logEntries = [];
  document.getElementById('scanLogPanel').style.display = 'block';
  showScanOverlay();

  btn.disabled = true;
  icon.style.animation = 'spin .9s linear infinite';
  pWrap.style.display  = 'block';
  counter.style.display= 'block';
  addScanLog('Tarama başlatıldı…', 'info');

  try {
    const result = await POP3Client.scanMails(
      (cur, total, msg, type='info') => {
        if (cur>=0 && total>0) {
          pBar.style.width = Math.round(cur/total*100)+'%';
          counter.textContent = `${cur} / ${total} thread`;
          updateScanOverlay(cur, total, msg);
        }
        status.textContent = msg.length>55 ? msg.slice(0,55)+'…' : msg;
        addScanLog(msg, type);
      },
      (order) => {
        incrementOverlayFound(order);
        renderDashboard();
        if (document.getElementById('view-orders')?.classList.contains('active')) renderOrders();
        if (document.getElementById('view-companies')?.classList.contains('active')) renderCompanies();
        updateNavBadges();
      }
    );

    const now = new Date();
    document.getElementById('lastSync').textContent = `Son: ${now.toLocaleTimeString('tr-TR',{hour:'2-digit',minute:'2-digit'})}`;
    pBar.style.width='100%'; status.textContent='';

    const summary = {
      scannedAt:  now.toISOString(),
      total:      result.total,
      threads:    result.threads,
      newOrders:  result.newOrders,
      skipped:    result.skipped,
      geminiOk:   result.geminiOk||0,
      keywordOk:  result.keywordOk||0,
    };

    // Scan log sunucuya kaydet (arka planda)
    Storage.saveScanResult(summary, _logEntries.slice(-100));
    _updateLastScanUI(summary);

    // Bildirim
    const cfg = Storage.getSettings();
    if (result.newOrders > 0) {
      if (cfg.notifications) {
        _sendNotification('Teplast — Yeni Sipariş', `${result.newOrders} yeni sipariş bulundu`);
        _playBeep();
      }
      addScanLog(`✅ Tamamlandı: ${result.newOrders} yeni sipariş`, 'success');
    } else {
      addScanLog('✅ Tamamlandı — yeni sipariş yok', 'success');
    }

    finishScanOverlay(result.newOrders);
    showToast(result.newOrders>0?`${result.newOrders} yeni sipariş!`:'Yeni sipariş yok.', result.newOrders>0?'ok':'');
    renderAll();
  } catch(e) {
    status.textContent='';
    const rawMsg = e.message||'';
    if (rawMsg.startsWith('PROXY_DOWN:')) {
      addScanLog('Proxy kapalı: '+rawMsg.split('\n')[0].slice('PROXY_DOWN:'.length), 'error');
      showProxyError(rawMsg.slice('PROXY_DOWN:'.length));
    } else if (rawMsg.startsWith('PROXY_ERROR:')) {
      addScanLog(rawMsg.slice('PROXY_ERROR:'.length), 'error');
      showToast(rawMsg.slice('PROXY_ERROR:'.length), 'err');
    } else if (rawMsg.startsWith('SETUP_NEEDED:')) {
      addScanLog(rawMsg.split('\n')[0].slice('SETUP_NEEDED:'.length), 'warn');
      showToast(rawMsg.split('\n')[0].slice('SETUP_NEEDED:'.length), 'err');
      switchView('settings');
    } else {
      addScanLog('Hata: '+rawMsg, 'error');
      showToast('Hata: '+rawMsg, 'err');
    }
    hideScanOverlay();
  } finally {
    btn.disabled=false;
    icon.style.animation='';
    setTimeout(()=>{ pWrap.style.display='none'; counter.style.display='none'; pBar.style.width='0%'; }, 3000);
  }
}

function _updateLastScanUI(summary) {
  const el = document.getElementById('lastScanInfo'); if (!el) return;
  const t  = new Date(summary.scannedAt).toLocaleTimeString('tr-TR',{hour:'2-digit',minute:'2-digit'});
  el.textContent = `Son: ${t} | ${summary.newOrders||0} sipariş, ${summary.total||0} mail`;
}

/* ── SETTINGS ─────────────────────── */
function setupLimitDisplay() {
  const inp = document.getElementById('cfgMailLimit');
  const disp= document.getElementById('cfgMailLimitDisplay');
  if (inp&&disp) inp.addEventListener('input', () => { disp.textContent=(inp.value||250)+' mail'; });
}

function loadSettings() {
  const c = Storage.getSettings();
  if (c.host)             document.getElementById('cfgHost').value        = c.host;
  if (c.port)             document.getElementById('cfgPort').value        = c.port;
  if (c.user)             document.getElementById('cfgUser').value        = c.user;
  if (c.tls)              document.getElementById('cfgTLS').value         = c.tls;
  if (c.geminiKey)        document.getElementById('cfgGemini').value      = c.geminiKey;
  if (c.mailLimit)        document.getElementById('cfgMailLimit').value   = c.mailLimit;
  if (c.autoScanInterval) document.getElementById('cfgAutoScan').value    = c.autoScanInterval;
  if (c.notifications)    document.getElementById('cfgNotifications').checked = true;

  const disp = document.getElementById('cfgMailLimitDisplay');
  if (disp) disp.textContent = (c.mailLimit||250)+' mail';

  // Bildirim butonu durumu
  const btn = document.getElementById('notifPermBtn');
  if (btn) _updateNotifBtn(btn);
}

function saveSettings() {
  const existing = Storage.getSettings();
  const pass     = document.getElementById('cfgPass').value || existing.pass || '';
  Storage.saveSettings({
    host:             document.getElementById('cfgHost').value.trim(),
    port:             parseInt(document.getElementById('cfgPort').value)||110,
    user:             document.getElementById('cfgUser').value.trim(),
    pass,
    tls:              document.getElementById('cfgTLS').value,
    geminiKey:        document.getElementById('cfgGemini').value.trim(),
    mailLimit:        parseInt(document.getElementById('cfgMailLimit').value)||250,
    autoScanInterval: parseInt(document.getElementById('cfgAutoScan').value)||0,
    notifications:    document.getElementById('cfgNotifications').checked,
    proxyUrl:         existing.proxyUrl, // makineye özgü, değiştirme
  });
  setupAutoScan(); // Otomatik tarama ayarını yenile
  showToast('Ayarlar kaydedildi', 'ok');
}

/* ── PROXY ERROR MODAL ──────────────*/
function showProxyError(detail) {
  const lines = detail.split('\n');
  document.getElementById('modalTitle').textContent = '⚠️ Proxy Bağlantı Hatası';
  document.getElementById('modalBody').innerHTML = `
    <div class="proxy-error-box">
      <p class="proxy-error-title">${esc(lines[0])}</p>
      ${lines.slice(1).join('\n').trim()?`<pre class="proxy-error-steps">${esc(lines.slice(1).join('\n').trim())}</pre>`:''}
    </div>
    <div class="proxy-error-hint"><strong>Proxy nedir?</strong> Uygulama mail sunucusuna doğrudan bağlanamaz — küçük bir ara sunucu (proxy) gereklidir. Bu proxy bilgisayarınızda çalışır, mail silmez, sadece okur.</div>
    <div class="modal-actions">
      <button class="btn-modal-save" onclick="closeModalDirect();switchView('settings')">Ayarlara Git</button>
      <button class="btn-modal-cancel" onclick="closeModalDirect()">Kapat</button>
    </div>`;
  document.getElementById('modalOverlay').classList.add('open');
}

async function testProxy() {
  const btn = document.getElementById('proxyTestBtn');
  const out = document.getElementById('proxyTestResult');
  if (!btn||!out) return;
  btn.disabled=true; btn.textContent='Test ediliyor…'; out.textContent=''; out.className='proxy-test-result';
  try {
    const result = await POP3Client.testProxyConnection();
    if (result.ok) { out.textContent='✅ Proxy çalışıyor'; out.className='proxy-test-result proxy-test-ok'; }
    else {
      out.textContent = result.reason==='connection_refused'
        ? '🔴 Proxy kapalı — terminalde `npm start` çalıştır'
        : '🔴 Bağlantı hatası: '+result.reason;
      out.className='proxy-test-result proxy-test-err';
    }
  } catch(e) { out.textContent='🔴 '+e.message; out.className='proxy-test-result proxy-test-err'; }
  btn.disabled=false; btn.textContent='Bağlantıyı Test Et';
}

/* ── SYNC DURUM ───────────────────── */
function showSyncStatus(state) {
  const dot  = document.getElementById('syncDotCircle');
  const label= document.getElementById('syncDotLabel');
  if (!dot||!label) return;
  const states = {
    synced:  { color:'#4caf50', text:'Senkronize ✓' },
    offline: { color:'#f44336', text:'Sunucu bağlantısı yok' },
    syncing: { color:'#ff9800', text:'Senkronize ediliyor…' },
  };
  const s = states[state]||states.offline;
  dot.style.background = s.color;
  label.textContent    = s.text;
}

Storage.ready.then(()=>showSyncStatus('synced')).catch(()=>showSyncStatus('offline'));

/* ── TOAST ────────────────────────── */
function showToast(msg, type='') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className   = 'toast show '+type;
  setTimeout(()=>t.classList.remove('show'), 3800);
}

/* ── HELPERS ──────────────────────── */
function fmtDate(iso, dateOnly=false) {
  if (!iso) return '—';
  const d = new Date(iso); if (isNaN(d)) return iso;
  return dateOnly ? d.toLocaleDateString('tr-TR') : d.toLocaleDateString('tr-TR')+' '+d.toLocaleTimeString('tr-TR',{hour:'2-digit',minute:'2-digit'});
}
function statusLabel(s) {
  return {new:'Yeni',processing:'İşlemde',shipped:'Sevk Edildi',done:'Tamamlandı',cancelled:'İptal'}[s]||s;
}
function toTitleCase(str) {
  if (!str||str==='—') return str;
  const s=str.trim();
  if (s===s.toUpperCase()&&s.length>3&&/[A-ZÇĞİÖŞÜ]{3}/.test(s))
    return s.split(' ').map(w=>w.length>0?w[0].toUpperCase()+w.slice(1).toLowerCase():w).join(' ');
  return s;
}
function esc(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

/* ── MOBİL AKTİF SEKME ────────────── */
function setMobileActive(el) {
  document.querySelectorAll('.mbn-link').forEach(l => l.classList.remove('active'));
  el.classList.add('active');
}

/* ── ÜRÜN İSTATİSTİKLERİ ─────────── */
function renderStats() {
  const el = document.getElementById('statsContent'); if (!el) return;
  const all = Storage.getOrders();
  if (!all.length) {
    el.innerHTML = `<div class="empty"><svg viewBox="0 0 24 24"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg><p>Henüz veri yok</p></div>`;
    return;
  }

  // Ürün bazlı sayım
  const prodMap = {};
  for (const o of all) {
    for (const p of (o.products||[])) {
      const name = (p.name||'').trim(); if (!name || name.length < 2) continue;
      if (!prodMap[name]) prodMap[name] = { name, count:0, firms:new Set(), totalQty:0, qtyUnit:'' };
      prodMap[name].count++;
      if (o.companyName) prodMap[name].firms.add(o.companyName);
      const qNum = parseFloat((p.quantity||'0').replace(/[^0-9.,]/g,'').replace(',','.'));
      if (!isNaN(qNum) && qNum > 0) {
        prodMap[name].totalQty += qNum;
        const unitMatch = (p.quantity||'').match(/[A-ZA-ZÇĞİÖŞÜa-zçğışöşü]+/);
        if (unitMatch) prodMap[name].qtyUnit = unitMatch[0];
      }
    }
  }

  // Firma bazlı sipariş sayısı
  const firmMap = {};
  for (const o of all) {
    const f = (o.companyName||'—').trim();
    if (!firmMap[f]) firmMap[f] = { name:f, total:0, done:0, pending:0 };
    firmMap[f].total++;
    if (o.status==='done') firmMap[f].done++;
    if (o.status==='new'||o.status==='processing') firmMap[f].pending++;
  }

  // Durum dağılımı
  const statuses = { new:0, processing:0, shipped:0, done:0, cancelled:0 };
  for (const o of all) if (o.status in statuses) statuses[o.status]++;

  // Aylık trend (son 6 ay)
  const monthlyMap = {};
  for (const o of all) {
    const d = new Date(o.createdAt);
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    monthlyMap[key] = (monthlyMap[key]||0) + 1;
  }
  const months = Object.keys(monthlyMap).sort().slice(-6);
  const maxMonth = Math.max(...months.map(m=>monthlyMap[m]),1);

  const topProds  = Object.values(prodMap).sort((a,b)=>b.count-a.count).slice(0,10);
  const topFirms  = Object.values(firmMap).sort((a,b)=>b.total-a.total).slice(0,8);

  const statusColors = { new:'var(--blue)', processing:'var(--amber)', shipped:'var(--violet)', done:'var(--green)', cancelled:'var(--red)' };
  const statusTot = Object.values(statuses).reduce((s,v)=>s+v,0)||1;

  el.innerHTML = `
    <div class="stats-grid">

      <!-- Durum Dağılımı -->
      <div class="stats-card stats-card--full">
        <div class="stats-card-title">📊 Durum Dağılımı</div>
        <div class="status-bar">
          ${Object.entries(statuses).filter(([,v])=>v>0).map(([k,v])=>`
            <div class="status-bar-seg" style="width:${Math.round(v/statusTot*100)}%;background:${statusColors[k]}" title="${statusLabel(k)}: ${v}">
              ${Math.round(v/statusTot*100)}%
            </div>`).join('')}
        </div>
        <div class="status-legend">
          ${Object.entries(statuses).map(([k,v])=>`
            <span class="stat-leg"><span class="stat-leg-dot" style="background:${statusColors[k]}"></span>${statusLabel(k)}: <strong>${v}</strong></span>`).join('')}
        </div>
      </div>

      <!-- Aylık Trend -->
      <div class="stats-card">
        <div class="stats-card-title">📅 Aylık Sipariş Trendi</div>
        <div class="bar-chart">
          ${months.map(m=>{
            const v=monthlyMap[m]; const h=Math.round(v/maxMonth*100);
            const [yr,mo]=m.split('-');
            const lbl=['Oca','Şub','Mar','Nis','May','Haz','Tem','Ağu','Eyl','Eki','Kas','Ara'][parseInt(mo)-1];
            return `<div class="bar-col">
              <div class="bar-val">${v}</div>
              <div class="bar-fill" style="height:${h}%"></div>
              <div class="bar-lbl">${lbl} ${yr.slice(2)}</div>
            </div>`;
          }).join('')}
        </div>
      </div>

      <!-- Top Ürünler -->
      <div class="stats-card">
        <div class="stats-card-title">📦 En Çok Sipariş Edilen Ürünler</div>
        ${topProds.length ? topProds.map((p,i)=>{
          const maxC = topProds[0].count||1;
          return `<div class="stat-row">
            <div class="stat-rank">${i+1}</div>
            <div class="stat-name" title="${esc(p.name)}">${esc(p.name.slice(0,32))}${p.name.length>32?'…':''}</div>
            <div class="stat-bar-wrap"><div class="stat-bar-fill" style="width:${Math.round(p.count/maxC*100)}%"></div></div>
            <div class="stat-num">${p.count} sipariş</div>
          </div>`;
        }).join('') : '<p class="stat-empty">Ürün verisi yok</p>'}
      </div>

      <!-- Top Firmalar -->
      <div class="stats-card">
        <div class="stats-card-title">🏢 Firmalar</div>
        ${topFirms.map((f,i)=>{
          const logo = getCompanyLogo(f.name);
          const maxT = topFirms[0].total||1;
          return `<div class="stat-row">
            <div class="stat-rank">${i+1}</div>
            ${logo ? `<img src="${logo}" class="stat-logo" onerror="this.style.display='none'" loading="lazy"/>` : `<div class="stat-initials">${esc(f.name.slice(0,2).toUpperCase())}</div>`}
            <div class="stat-name">${esc(toTitleCase(f.name))}</div>
            <div class="stat-bar-wrap"><div class="stat-bar-fill stat-bar-firm" style="width:${Math.round(f.total/maxT*100)}%"></div></div>
            <div class="stat-num">${f.total}</div>
          </div>`;
        }).join('')}
      </div>

    </div>`;
}
