'use strict';

const STORAGE_KEY = 'kck:v6';
const SESSION_KEY = 'kck:v6:user';
const USERS = {
  'Yusuf': { password: '2807', role: 'admin' },
  'Ömer': { password: '123', role: 'viewer' },
  'Taha': { password: '1313', role: 'viewer' }
};
const USER_NAMES = Object.keys(USERS);
const ASSETS = ['TL', 'USD', 'EUR'];
const ACCOUNT_TYPES = {
  wallet: 'Kasa / Cüzdan',
  current: 'Cari',
  debt: 'Borç',
  investment: 'Yatırım'
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const uid = (prefix = 'id') => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const nowISO = () => new Date().toISOString();
const today = () => new Date().toISOString().slice(0, 10);
const esc = (value = '') => String(value).replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
const num = (v) => Number(v || 0);
const money = (v) => new Intl.NumberFormat('tr-TR', { style:'currency', currency:'TRY', maximumFractionDigits:2 }).format(num(v));
const qty = (v, digits = 4) => new Intl.NumberFormat('tr-TR', { maximumFractionDigits:digits }).format(num(v));
const dateTR = (d) => d ? new Date(`${String(d).slice(0,10)}T12:00:00`).toLocaleDateString('tr-TR') : '-';
const monthTR = (ym) => {
  if (!ym) return '-';
  const [y,m] = ym.split('-').map(Number);
  return new Intl.DateTimeFormat('tr-TR',{month:'long',year:'numeric'}).format(new Date(y,m-1,1));
};
const typeLabel = (t) => ACCOUNT_TYPES[t] || t;
const isAdmin = () => currentUser === 'Yusuf';

let state = loadState();
let currentUser = sessionStorage.getItem(SESSION_KEY) || null;
let selectedLoginUser = 'Yusuf';
let route = { page: 'dashboard', id: null };

function defaultState(){
  const createdAt = nowISO();
  return {
    version: 6,
    accounts: [
      { id:'acc_main', name:'Genel Kasa', type:'wallet', bankName:'Enpara', iban:'', createdAt },
      { id:'acc_yusuf', name:'Yusuf Cari', type:'current', owner:'Yusuf', bankName:'', iban:'', createdAt },
      { id:'acc_taha', name:'Taha Cari', type:'current', owner:'Taha', bankName:'', iban:'', createdAt },
      { id:'acc_omer', name:'Ömer Cari', type:'current', owner:'Ömer', bankName:'', iban:'', createdAt }
    ],
    transactions: [],
    prices: { 'FX:USD':0, 'FX:EUR':0, 'GOLD:GRAM':0 },
    priceNames: { 'FX:USD':'USD/TL', 'FX:EUR':'EUR/TL', 'GOLD:GRAM':'Gram Altın' },
    debtPlans: [],
    paymentClaims: [],
    notifications: [],
    settings: { debtDueDay:5 }
  };
}

function loadState(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== 6) return defaultState();
    return { ...defaultState(), ...parsed };
  }catch(e){ return defaultState(); }
}
function saveState(render = true){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  if (render) renderApp();
}
function resetState(){
  if (!isAdmin()) return;
  if (!confirm('Tüm yerel veriler silinecek. Devam edilsin mi?')) return;
  state = defaultState();
  saveState();
  toast('Sistem sıfırlandı.','good');
}

function accountById(id){ return state.accounts.find(a => a.id === id); }
function accountName(id){ return accountById(id)?.name || '-'; }
function realAccounts(){ return state.accounts.filter(a => a.type !== 'debt'); }
function debtAccounts(){ return state.accounts.filter(a => a.type === 'debt'); }
function currentAccountForUser(name){ return state.accounts.find(a => a.type === 'current' && a.owner === name); }

function sortedTransactions(ignoreId = null){
  return state.transactions
    .filter(t => t.id !== ignoreId)
    .slice()
    .sort((a,b) => (a.date || '').localeCompare(b.date || '') || (a.createdAt || '').localeCompare(b.createdAt || ''));
}

function getBalances(accountId, ignoreTxId = null){
  const b = { TL:0, USD:0, EUR:0 };
  for (const t of sortedTransactions(ignoreTxId)){
    switch(t.type){
      case 'external_in':
        if (t.accountId === accountId && ASSETS.includes(t.asset)) b[t.asset] += num(t.amount);
        break;
      case 'external_out':
        if (t.accountId === accountId && ASSETS.includes(t.asset)) b[t.asset] -= num(t.amount);
        break;
      case 'transfer':
        if (t.fromAccountId === accountId) b[t.asset] -= num(t.amount);
        if (t.toAccountId === accountId) b[t.asset] += num(t.amount);
        break;
      case 'fx_buy':
        if (t.accountId === accountId){ b.TL -= num(t.quantity) * num(t.rate); b[t.asset] += num(t.quantity); }
        break;
      case 'fx_sell':
        if (t.accountId === accountId){ b[t.asset] -= num(t.quantity); b.TL += num(t.quantity) * num(t.rate); }
        break;
      case 'trade_buy':
        if (t.accountId === accountId) b.TL -= num(t.quantity) * num(t.price);
        break;
      case 'trade_sell':
        if (t.accountId === accountId) b.TL += num(t.quantity) * num(t.price);
        break;
      case 'adjustment':
        if (t.accountId === accountId && ASSETS.includes(t.asset)) b[t.asset] += num(t.amount);
        break;
      case 'debt_payment':
        if (t.fromAccountId === accountId) b.TL -= num(t.amount);
        break;
    }
  }
  Object.keys(b).forEach(k => { if (Math.abs(b[k]) < 1e-9) b[k] = 0; });
  return b;
}

function instrumentKey(type, symbol){ return `${type}:${String(symbol || '').trim().toUpperCase()}`; }
function getPositions(accountId, ignoreTxId = null){
  const positions = new Map();
  for (const t of sortedTransactions(ignoreTxId)){
    if (t.accountId !== accountId || !['trade_buy','trade_sell'].includes(t.type)) continue;
    const key = instrumentKey(t.instrumentType, t.symbol);
    const p = positions.get(key) || { key, type:t.instrumentType, symbol:String(t.symbol).toUpperCase(), name:t.instrumentName || t.symbol, quantity:0, totalCost:0, realized:0, lastPrice:0 };
    if (t.type === 'trade_buy'){
      p.totalCost += num(t.quantity) * num(t.price);
      p.quantity += num(t.quantity);
    } else {
      const avg = p.quantity > 0 ? p.totalCost / p.quantity : 0;
      const sellQty = num(t.quantity);
      p.realized += Number.isFinite(num(t.realizedProfit)) ? num(t.realizedProfit) : sellQty * (num(t.price) - avg);
      p.totalCost -= sellQty * avg;
      p.quantity -= sellQty;
      if (p.quantity < 1e-9){ p.quantity = 0; p.totalCost = 0; }
    }
    p.lastPrice = num(t.price);
    positions.set(key,p);
  }
  return [...positions.values()].map(p => {
    const avgCost = p.quantity > 0 ? p.totalCost / p.quantity : 0;
    const currentPrice = num(state.prices[p.key]) || p.lastPrice || 0;
    const marketValue = p.quantity * currentPrice;
    const unrealized = marketValue - p.totalCost;
    return { ...p, avgCost, currentPrice, marketValue, unrealized };
  });
}
function getGoldPosition(accountId){ return getPositions(accountId).find(p => p.type === 'GOLD' && p.symbol === 'GRAM') || {quantity:0,avgCost:0,currentPrice:num(state.prices['GOLD:GRAM']),marketValue:0,unrealized:0}; }
function realizedPL(accountId){ return getPositions(accountId).reduce((s,p) => s + num(p.realized), 0); }

function currentAssetRate(asset){
  if (asset === 'TL') return 1;
  return num(state.prices[`FX:${asset}`]);
}
function accountEstimatedValue(accountId){
  const a = accountById(accountId);
  if (!a || a.type === 'debt') return 0;
  const b = getBalances(accountId);
  const positions = getPositions(accountId);
  return b.TL + b.USD*currentAssetRate('USD') + b.EUR*currentAssetRate('EUR') + positions.reduce((s,p)=>s+p.marketValue,0);
}
function totalEstimatedValue(){ return realAccounts().reduce((s,a)=>s+accountEstimatedValue(a.id),0); }

function debtApprovedTotal(debtId){
  const linkedTransfers = state.transactions
    .filter(t => t.type === 'transfer' && t.toAccountId === debtId && t.purpose === 'debt_payment')
    .reduce((s,t)=>s+num(t.amount),0);
  const direct = state.transactions
    .filter(t => t.type === 'debt_payment' && t.debtAccountId === debtId)
    .reduce((s,t)=>s+num(t.amount),0);
  const legacyClaims = state.paymentClaims
    .filter(c => c.debtAccountId === debtId && c.status === 'approved' && !c.linkedTransferTxId)
    .reduce((s,c)=>s+num(c.amount),0);
  return linkedTransfers + direct + legacyClaims;
}
function debtRemaining(debtId){
  const d = accountById(debtId); if (!d) return 0;
  return Math.max(0, num(d.totalDebt) - debtApprovedTotal(debtId));
}

function validateEnough(accountId, asset, amount, ignoreTxId = null){
  const b = getBalances(accountId, ignoreTxId);
  return num(b[asset]) + 1e-9 >= num(amount);
}
function validatePositionEnough(accountId, type, symbol, quantity, ignoreTxId = null){
  const p = getPositions(accountId, ignoreTxId).find(x => x.key === instrumentKey(type,symbol));
  return num(p?.quantity) + 1e-9 >= num(quantity);
}

function getAccountMovements(account){
  const rows = [];
  for (const t of state.transactions){
    let include = false, label = '', counterparty = '', signed = 0, asset = t.asset || 'TL', automatic = false;
    if (t.type === 'external_in' && t.accountId === account.id){ include=true; label='Para Girişi'; counterparty=t.counterparty || 'Dışarıdan'; signed=num(t.amount); }
    if (t.type === 'external_out' && t.accountId === account.id){ include=true; label='Para Çıkışı'; counterparty=t.counterparty || 'Dışarıya'; signed=-num(t.amount); }
    if (t.type === 'transfer' && t.fromAccountId === account.id){ include=true; label=t.purpose==='debt_payment'?'Borç Hesabına Transfer':'Transfer Çıkışı'; counterparty=accountName(t.toAccountId); signed=-num(t.amount); }
    if (t.type === 'transfer' && t.toAccountId === account.id){ include=true; label=t.purpose==='debt_payment'?'Borç Ödemesi Transferi':'Transfer Girişi'; counterparty=accountName(t.fromAccountId); signed=num(t.amount); }
    if (t.type === 'fx_buy' && t.accountId === account.id){ include=true; label=`${t.asset} Alımı`; counterparty='Hesap içi dönüşüm'; signed=num(t.quantity); asset=t.asset; }
    if (t.type === 'fx_sell' && t.accountId === account.id){ include=true; label=`${t.asset} Satımı`; counterparty='Hesap içi dönüşüm'; signed=-num(t.quantity); asset=t.asset; }
    if (t.type === 'trade_buy' && t.accountId === account.id){ include=true; label=`${instrumentLabel(t.instrumentType)} Alımı`; counterparty=t.instrumentName || t.symbol; signed=-num(t.quantity)*num(t.price); asset='TL'; }
    if (t.type === 'trade_sell' && t.accountId === account.id){ include=true; label=`${instrumentLabel(t.instrumentType)} Satımı`; counterparty=t.instrumentName || t.symbol; signed=num(t.quantity)*num(t.price); asset='TL'; }
    if (t.type === 'adjustment' && t.accountId === account.id){ include=true; label='Bakiye Düzeltme'; counterparty='Yönetici işlemi'; signed=num(t.amount); asset=t.asset; }
    if (t.type === 'debt_payment' && t.fromAccountId === account.id){ include=true; label='Borç Ödemesi'; counterparty=accountName(t.debtAccountId); signed=-num(t.amount); asset='TL'; }
    if (include) rows.push({ id:t.id, date:t.date, label,counterparty, signed, asset, channel:t.channel, bankName:t.bankName, note:t.note, automatic, createdAt:t.createdAt, tx:t });
  }
  if (account.type === 'current' && account.owner){
    for (const t of state.transactions){
      if (!['external_in','external_out'].includes(t.type) || t.counterparty !== account.owner || t.accountId === account.id) continue;
      const source = accountById(t.accountId);
      if (!source) continue;
      const isIn = t.type === 'external_in';
      rows.push({
        id:`mirror_${t.id}`, date:t.date,
        label: isIn ? 'Para Çıkışı' : 'Para Girişi',
        counterparty: source.name,
        signed: isIn ? -num(t.amount) : num(t.amount),
        asset:t.asset, channel:t.channel, bankName:t.bankName,
        note:t.note || (isIn ? `${source.name} hesabına gönderildi` : `${source.name} hesabından alındı`),
        automatic:true, createdAt:t.createdAt, tx:t
      });
    }
  }
  return rows.sort((a,b) => (b.date||'').localeCompare(a.date||'') || (b.createdAt||'').localeCompare(a.createdAt||''));
}

function instrumentLabel(type){ return type === 'STOCK' ? 'Hisse' : type === 'FUND' ? 'Fon' : 'Altın'; }
function accountIcon(type){ return type === 'wallet' ? '▣' : type === 'current' ? '↔' : type === 'debt' ? '◷' : '◆'; }

function renderLogin(){
  const root = $('#loginRoot');
  root.innerHTML = `
  <main class="auth-screen">
    <section class="auth-card">
      <div class="auth-logo">KC</div>
      <div class="eyebrow">ÖZEL FİNANS PANELİ</div>
      <h1>Kutsal Cumartesi Kasa</h1>
      <p class="lead">Kasa, cari, borç ve yatırım hesaplarını tek panelden yönetin.</p>
      <div class="field-label" style="margin-bottom:9px">Kullanıcı</div>
      <div class="auth-users">
        ${USER_NAMES.map((u,i)=>`<button type="button" class="auth-user ${i===0?'active':''}" data-user="${esc(u)}">
          <span class="auth-avatar">${esc(u[0])}</span><span><strong>${esc(u)}</strong><small>${u==='Yusuf'?'Yönetici':'Görüntüleme + ödeme bildirimi'}</small></span><span class="auth-check">✓</span>
        </button>`).join('')}
      </div>
      <div class="field"><label>Şifre</label><div class="password-wrap"><input id="loginPassword" class="input" type="password" placeholder="Şifrenizi girin" autocomplete="current-password"><button id="togglePass" class="password-toggle" type="button">Göster</button></div></div>
      <button id="loginButton" class="auth-submit" type="button">Giriş Yap</button>
      <div id="loginError" class="auth-error"></div>
      <div class="auth-foot">Yetkinize göre işlem menüleri otomatik olarak açılır.</div>
    </section>
  </main>`;
  $$('.auth-user',root).forEach(btn => btn.addEventListener('click',()=>{
    selectedLoginUser = btn.dataset.user;
    $$('.auth-user',root).forEach(b=>b.classList.toggle('active',b===btn));
    $('#loginPassword')?.focus();
  }));
  $('#togglePass').addEventListener('click',()=>{
    const inp = $('#loginPassword'); inp.type = inp.type === 'password' ? 'text' : 'password'; $('#togglePass').textContent = inp.type === 'password' ? 'Göster' : 'Gizle';
  });
  $('#loginButton').addEventListener('click',doLogin);
  $('#loginPassword').addEventListener('keydown',e=>{ if(e.key==='Enter') doLogin(); });
}
function doLogin(){
  const pass = $('#loginPassword')?.value || '';
  if (!USERS[selectedLoginUser] || USERS[selectedLoginUser].password !== pass){ $('#loginError').textContent='Kullanıcı veya şifre hatalı.'; return; }
  currentUser = selectedLoginUser; sessionStorage.setItem(SESSION_KEY,currentUser); $('#loginRoot').classList.add('hidden'); $('#appRoot').classList.remove('hidden'); renderApp();
}
function logout(){ sessionStorage.removeItem(SESSION_KEY); currentUser=null; route={page:'dashboard',id:null}; $('#appRoot').classList.add('hidden'); $('#loginRoot').classList.remove('hidden'); renderLogin(); }

function setRoute(page,id=null){ route={page,id}; renderApp(); }
function renderApp(){
  if (!currentUser){ renderLogin(); return; }
  $('#loginRoot').classList.add('hidden'); $('#appRoot').classList.remove('hidden');
  const pending = state.paymentClaims.filter(c=>c.status==='pending').length;
  const navAccounts = debtAccounts();
  $('#appRoot').innerHTML = `
  <div class="app-shell">
    <aside class="sidebar">
      <div class="brand"><div class="brand-mark">KC</div><div class="brand-copy"><strong>Kutsal Cumartesi</strong><small>KASA</small></div></div>
      <nav>
        ${navButton('dashboard','⌂','Ana Sayfa')}
        ${navButton('accounts','▦','Hesaplar')}
        ${navButton('debts','◷','Borçlar')}
        ${navButton('notifications','●','Bildirimler',isAdmin()?pending:unreadForUser(currentUser))}
        ${navButton('statement','▤','Ekstre / PDF')}
        ${isAdmin()?navButton('settings','⚙','Ayarlar'):''}
        <div class="nav-section">Borç Hesapları</div>
        ${navAccounts.map(a=>`<button class="nav-item nav-account ${a.type} ${route.page==='account'&&route.id===a.id?'active':''}" data-go="account" data-id="${a.id}"><span class="dot"></span><span>${esc(a.name)}</span></button>`).join('')}
      </nav>
      <div class="sidebar-bottom"><div class="user-mini"><div class="avatar">${esc(currentUser[0])}</div><div><strong>${esc(currentUser)}</strong><small>${isAdmin()?'Tam Yetki':'Görüntüleme Yetkisi'}</small></div></div></div>
    </aside>
    <section class="main">
      <header class="topbar">
        <div><h1>${pageTitle()}</h1><div class="sub">${pageSubtitle()}</div></div>
        <div class="top-actions"><span class="role-pill">${isAdmin()?'Yönetici':'Görüntüleme'}</span>${isAdmin()?'<button class="btn primary" data-action="new-account">+ Yeni Hesap</button>':''}<button class="btn ghost" data-action="logout">Çıkış</button></div>
      </header>
      <div id="pageContent">${renderPage()}</div>
    </section>
    <nav class="mobile-bar">
      ${mobileNav('dashboard','⌂','Ana')}${mobileNav('accounts','▦','Hesap')}${mobileNav('debts','◷','Borç')}${mobileNav('notifications','●','Bildirim')}${mobileNav('statement','▤','Ekstre')}
    </nav>
  </div>`;
  bindAppEvents();
}
function navButton(page,icon,label,badge=0){ return `<button class="nav-item ${route.page===page?'active':''}" data-go="${page}"><span class="nav-icon">${icon}</span><span>${label}</span>${badge?`<span class="badge">${badge}</span>`:''}</button>`; }
function mobileNav(page,icon,label){ return `<button class="mobile-nav ${route.page===page?'active':''}" data-go="${page}"><span>${icon}</span>${label}</button>`; }
function pageTitle(){
  if (route.page==='account') return accountById(route.id)?.name || 'Hesap';
  return ({dashboard:'Ana Sayfa',accounts:'Hesaplar',debts:'Borçlar',notifications:'Bildirimler',statement:'Ekstre / PDF',settings:'Ayarlar'})[route.page] || 'Kutsal Cumartesi Kasa';
}
function pageSubtitle(){
  if (route.page==='account') return `${typeLabel(accountById(route.id)?.type)} detayları ve hareketleri`;
  return ({dashboard:'Tüm hesapların güncel özeti',accounts:'Kasa, cari, borç ve yatırım hesapları',debts:'Aylık ödeme ve onay sistemi',notifications:'Ödeme bildirimleri ve onaylar',statement:'Tüm hesapların tek raporu',settings:'Fiyatlar ve sistem ayarları'})[route.page] || '';
}
function renderPage(){
  if (route.page==='dashboard') return renderDashboard();
  if (route.page==='accounts') return renderAccounts();
  if (route.page==='account') return renderAccountPage(route.id);
  if (route.page==='debts') return renderDebts();
  if (route.page==='notifications') return renderNotifications();
  if (route.page==='statement') return renderStatement();
  if (route.page==='settings') return renderSettings();
  return renderDashboard();
}
function bindAppEvents(){
  $$('[data-go]').forEach(el=>el.addEventListener('click',()=>setRoute(el.dataset.go,el.dataset.id||null)));
  $('[data-action="logout"]')?.addEventListener('click',logout);
  $('[data-action="new-account"]')?.addEventListener('click',openNewAccountModal);
  $$('[data-quick]').forEach(el=>el.addEventListener('click',()=>handleQuick(el.dataset.quick)));
  $$('[data-open-account]').forEach(el=>el.addEventListener('click',()=>setRoute('account',el.dataset.openAccount)));
  $$('[data-debt-plan]').forEach(el=>el.addEventListener('click',()=>openDebtPlanModal(el.dataset.debtPlan)));
  $$('[data-mark-paid]').forEach(el=>el.addEventListener('click',()=>openPaymentClaimModal(el.dataset.markPaid)));
  $$('[data-approve-claim]').forEach(el=>el.addEventListener('click',()=>approveClaim(el.dataset.approveClaim)));
  $$('[data-reject-claim]').forEach(el=>el.addEventListener('click',()=>rejectClaim(el.dataset.rejectClaim)));
  $$('[data-copy]').forEach(el=>el.addEventListener('click',()=>copyText(el.dataset.copy)));
  $$('[data-delete-tx]').forEach(el=>el.addEventListener('click',()=>deleteTransaction(el.dataset.deleteTx)));
  $$('[data-price-edit]').forEach(el=>el.addEventListener('click',()=>openPriceModal(el.dataset.priceEdit)));
  $('#printStatement')?.addEventListener('click',()=>window.print());
  $('#statementAccount')?.addEventListener('change',renderStatementFilterOnly);
  $('#statementStart')?.addEventListener('change',renderStatementFilterOnly);
  $('#statementEnd')?.addEventListener('change',renderStatementFilterOnly);
  $('#saveDueDay')?.addEventListener('click',saveDueDay);
  $('#resetSystem')?.addEventListener('click',resetState);
}

function renderDashboard(){
  const debtTotal = debtAccounts().reduce((s,d)=>s+debtRemaining(d.id),0);
  const pending = state.paymentClaims.filter(c=>c.status==='pending').length;
  const main = accountById('acc_main');
  const mainBalance = main ? getBalances(main.id) : {TL:0,USD:0,EUR:0};
  return `<div class="page-grid simple-dashboard">
    <div class="welcome-card">
      <div><span class="eyebrow">KUTSAL CUMARTESİ KASA</span><h2>${isAdmin()?'Finans yönetimi':'Hesap özeti'}</h2><p>Hesaplar, borçlar ve yatırımlar tek yerde. İşlem yapmak için ilgili hesabı açın.</p></div>
      ${isAdmin()?`<div class="welcome-actions"><button class="btn primary" data-quick="external">+ Para İşlemi</button><button class="btn" data-quick="transfer">Transfer</button><button class="btn" data-action="new-account">Yeni Hesap</button></div>`:''}
    </div>
    <div class="stats-grid">
      ${statCard('Genel Kasa TL',money(mainBalance.TL),'Mevcut TL bakiye')}
      ${statCard('Toplam Finansal Değer',money(totalEstimatedValue()),'Hesap ve yatırımlar')}
      ${statCard('Kalan Borç',money(debtTotal),`${debtAccounts().length} borç hesabı`)}
      ${statCard('Onay Bekleyen',String(pending),isAdmin()?'Ödeme bildirimi':'Yusuf onayı bekleyen')}
    </div>
    <div class="card"><div class="card-head"><div><h3>Hesaplarım</h3><p>Bir hesabı açarak bakiyesini ve hareketlerini görüntüleyin.</p></div><button class="btn sm" data-go="accounts">Tümünü Gör</button></div>${renderAccountsGrid(state.accounts.slice(0,6))}</div>
    <div class="card"><div class="card-head"><div><h3>Son Hareketler</h3><p>En son gerçekleşen finansal işlemler</p></div></div>${renderGlobalMovements(8)}</div>
  </div>`;
}
function statCard(label,value,note){ return `<div class="stat-card"><div class="stat-label">${label}</div><div class="stat-value num">${value}</div><div class="stat-note">${note}</div></div>`; }
function quick(id,icon,title,sub){ return `<button class="quick-action" data-quick="${id}"><span class="qicon">${icon}</span><strong>${title}</strong><small>${sub}</small></button>`; }
function plHtml(v){ const n=num(v); return `<span class="${n>0?'profit':n<0?'loss':'neutral'}">${n>0?'+':''}${money(n)}</span>`; }

function renderAccounts(){
  return `<div class="page-grid"><div class="card"><div class="card-head"><div><h3>Tüm Hesaplar</h3><p>${state.accounts.length} hesap açık</p></div>${isAdmin()?'<button class="btn primary" data-action="new-account">+ Yeni Hesap</button>':''}</div>${renderAccountsGrid(state.accounts)}</div></div>`;
}
function renderAccountsGrid(accounts){
  if (!accounts.length) return `<div class="empty"><strong>Hesap yok</strong>Yeni hesap oluşturabilirsiniz.</div>`;
  return `<div class="accounts-grid">${accounts.map(a=>accountCard(a)).join('')}</div>`;
}
function accountCard(a){
  if (a.type==='debt'){
    return `<article class="account-card" data-open-account="${a.id}"><div class="account-type">BORÇ HESABI</div><div class="account-name">${esc(a.name)}</div><div class="account-meta">${esc(a.iban||'IBAN tanımsız')}</div><div class="balance-row"><div class="balance-chip"><small>Toplam</small><strong>${money(a.totalDebt)}</strong></div><div class="balance-chip"><small>Kalan</small><strong>${money(debtRemaining(a.id))}</strong></div></div></article>`;
  }
  const b=getBalances(a.id), gold=getGoldPosition(a.id), value=accountEstimatedValue(a.id);
  return `<article class="account-card" data-open-account="${a.id}"><div class="account-type">${esc(typeLabel(a.type))}</div><div class="account-name">${esc(a.name)}</div><div class="account-meta">${esc(a.bankName||a.owner||'')}</div><div class="balance-row"><div class="balance-chip"><small>TL</small><strong>${money(b.TL)}</strong></div><div class="balance-chip"><small>USD</small><strong>${qty(b.USD,2)}</strong></div><div class="balance-chip"><small>EUR</small><strong>${qty(b.EUR,2)}</strong></div><div class="balance-chip"><small>Altın</small><strong>${qty(gold.quantity,4)} gr</strong></div></div><div class="account-meta" style="margin-top:12px">Tahmini değer: <strong style="color:#dce7fa">${money(value)}</strong></div></article>`;
}

function renderAccountPage(id){
  const a=accountById(id); if(!a) return `<div class="empty">Hesap bulunamadı.</div>`;
  if (a.type==='debt') return renderDebtAccount(a);
  const b=getBalances(a.id), positions=getPositions(a.id), value=accountEstimatedValue(a.id), movements=getAccountMovements(a);
  return `<div class="page-grid account-detail">
    <div class="account-hero">
      <div><span class="eyebrow">${esc(typeLabel(a.type))}</span><h2>${esc(a.name)}</h2><p>${esc(a.bankName||a.owner||'Hesap')}</p></div>
      <div class="hero-value"><small>Tahmini Toplam Değer</small><strong>${money(value)}</strong></div>
    </div>
    <div class="balance-strip">
      <div><small>TL</small><strong>${money(b.TL)}</strong></div>
      <div><small>USD</small><strong>${qty(b.USD,2)}</strong></div>
      <div><small>EUR</small><strong>${qty(b.EUR,2)}</strong></div>
      <div><small>Yatırım Pozisyonu</small><strong>${positions.filter(p=>p.quantity>1e-9).length}</strong></div>
    </div>
    ${isAdmin()?`<div class="action-strip"><button class="btn primary" data-quick="external">Para Giriş / Çıkış</button><button class="btn" data-quick="transfer">Hesaplar Arası Transfer</button><button class="btn" data-quick="fx">Döviz Al / Sat</button><button class="btn" data-quick="trade">Altın / Fon / Hisse</button></div>`:''}
    <div class="card"><div class="card-head"><div><h3>Hesap Hareketleri</h3><p>Bu hesaba ait tüm giriş, çıkış ve transferler</p></div></div>${renderMovementsTable(movements)}</div>
    ${positions.filter(p=>p.quantity>1e-9).length?`<div class="card"><div class="card-head"><div><h3>Yatırımlar</h3><p>Güncel pozisyon, maliyet ve kâr/zarar</p></div></div>${renderPortfolio(a.id,positions)}</div>`:''}
  </div>`;
}
function currentMirrorSummary(owner){
  let sentTL=0,receivedTL=0;
  for(const t of state.transactions){
    if(t.counterparty!==owner || t.asset!=='TL') continue;
    if(t.type==='external_in') sentTL += num(t.amount);
    if(t.type==='external_out') receivedTL += num(t.amount);
  }
  return {sentTL,receivedTL};
}
function renderPortfolio(accountId,positions=getPositions(accountId)){
  const active=positions.filter(p=>p.quantity>1e-9);
  if(!active.length) return `<div class="empty"><strong>Pozisyon yok</strong>${isAdmin()?'Altın, fon veya hisse alımı yapabilirsiniz.':'Henüz yatırım pozisyonu yok.'}</div>`;
  return `<div class="portfolio-grid">${active.map(p=>`<div class="position-card"><div class="position-top"><div><div class="position-name">${esc(p.name)}</div><div class="position-symbol">${instrumentLabel(p.type)} • ${esc(p.symbol)}</div></div><div class="position-value">${money(p.marketValue)}</div></div><div class="kv"><span>Adet / Pay</span><strong>${qty(p.quantity,4)}</strong><span>Ort. Maliyet</span><strong>${money(p.avgCost)}</strong><span>Güncel Fiyat</span><strong>${p.currentPrice?money(p.currentPrice):'Girilmedi'}</strong><span>Gerç. K/Z</span><strong>${plHtml(p.realized)}</strong><span>Gerç. Olmayan K/Z</span><strong>${plHtml(p.unrealized)}</strong></div></div>`).join('')}</div>`;
}
function renderMovementsTable(rows){
  if(!rows.length) return `<div class="empty"><strong>Hareket yok</strong>Bu hesapta henüz işlem bulunmuyor.</div>`;
  return `<div class="table-wrap"><table class="table"><thead><tr><th>Tarih</th><th>İşlem</th><th>Karşı Taraf</th><th>Kanal</th><th>Varlık</th><th>Tutar</th><th>Açıklama</th>${isAdmin()?'<th></th>':''}</tr></thead><tbody>${rows.map(r=>`<tr><td>${dateTR(r.date)}</td><td>${esc(r.label)} ${r.automatic?'<span class="auto-tag">OTOMATİK</span>':''}</td><td>${esc(r.counterparty||'-')}</td><td>${esc(r.channel||'-')}${r.bankName?` · ${esc(r.bankName)}`:''}</td><td>${esc(r.asset)}</td><td class="${r.signed>0?'amount-pos':r.signed<0?'amount-neg':'amount-neutral'}">${r.signed>0?'+':''}${r.asset==='TL'?money(r.signed):qty(r.signed,4)}</td><td>${esc(r.note||'-')}</td>${isAdmin()?`<td>${!r.automatic?`<button class="btn sm danger" data-delete-tx="${r.id}">Sil</button>`:''}</td>`:''}</tr>`).join('')}</tbody></table></div>`;
}
function renderGlobalMovements(limit=10){
  const all=[];
  for(const a of realAccounts()) for(const r of getAccountMovements(a)) if(!r.automatic) all.push({...r,account:a.name});
  all.sort((a,b)=>(b.date||'').localeCompare(a.date||'')||(b.createdAt||'').localeCompare(a.createdAt||''));
  if(!all.length) return `<div class="empty"><strong>Henüz işlem yok</strong>İlk para girişini veya transferi kaydedebilirsiniz.</div>`;
  return `<div class="table-wrap"><table class="table"><thead><tr><th>Tarih</th><th>Hesap</th><th>İşlem</th><th>Karşı Taraf</th><th>Tutar</th><th>Açıklama</th></tr></thead><tbody>${all.slice(0,limit).map(r=>`<tr><td>${dateTR(r.date)}</td><td>${esc(r.account)}</td><td>${esc(r.label)}</td><td>${esc(r.counterparty)}</td><td class="${r.signed>0?'amount-pos':'amount-neg'}">${r.signed>0?'+':''}${r.asset==='TL'?money(r.signed):qty(r.signed,4)+' '+r.asset}</td><td>${esc(r.note||'-')}</td></tr>`).join('')}</tbody></table></div>`;
}

function renderDebts(){
  const debts=debtAccounts();
  return `<div class="page-grid"><div class="card"><div class="card-head"><div><h3>Borç Hesapları</h3><p>IBAN, aylık ödeme planı ve Yusuf onay akışı</p></div>${isAdmin()?'<button class="btn primary" data-action="new-account">+ Borç Hesabı</button>':''}</div>${debts.length?`<div class="accounts-grid">${debts.map(accountCard).join('')}</div>`:`<div class="empty"><strong>Borç hesabı yok</strong>${isAdmin()?'Yeni hesap açarken Borç tipini seçin.':''}</div>`}</div></div>`;
}
function renderDebtAccount(d){
  const rem=debtRemaining(d.id), paid=debtApprovedTotal(d.id), plans=state.debtPlans.filter(p=>p.debtAccountId===d.id).sort((a,b)=>b.month.localeCompare(a.month));
  const transferRows=state.transactions.filter(t=>t.type==='transfer'&&t.toAccountId===d.id&&t.purpose==='debt_payment').map(t=>({date:t.date,title:`${t.payer||accountName(t.fromAccountId)} ${monthTR(t.debtMonth)} borcu ödedi — ONAYLANDI`,amount:t.amount,note:t.note||`${accountName(t.fromAccountId)} hesabından borç hesabına transfer edildi.`}));
  const legacyRows=state.paymentClaims.filter(c=>c.debtAccountId===d.id&&c.status==='approved'&&!c.linkedTransferTxId).map(c=>({date:c.approvedAt||c.createdAt,title:`${c.user} ${monthTR(c.month)} borcu ödedi — ONAYLANDI`,amount:c.amount,note:'Eski kayıt: Yusuf tarafından onaylandı.'}));
  const directRows=state.transactions.filter(t=>t.type==='debt_payment'&&t.debtAccountId===d.id).map(t=>({date:t.date,title:`${t.payer||'Hesap'} borç ödemesi`,amount:t.amount,note:t.note||`${accountName(t.fromAccountId)} hesabından ödendi.`}));
  const moves=[...transferRows,...legacyRows,...directRows].sort((a,b)=>(b.date||'').localeCompare(a.date||''));
  return `<div class="page-grid debt-detail">
    <div class="account-hero debt-hero"><div><span class="eyebrow">BORÇ HESABI</span><h2>${esc(d.name)}</h2><p>Son ödeme: Her ayın ${state.settings.debtDueDay}'i</p></div><div class="hero-value"><small>Kalan Borç</small><strong>${money(rem)}</strong></div></div>
    <div class="balance-strip three"><div><small>Toplam Borç</small><strong>${money(d.totalDebt)}</strong></div><div><small>Onaylanan Ödeme</small><strong>${money(paid)}</strong></div><div><small>Kalan</small><strong>${money(rem)}</strong></div></div>
    <div class="card"><div class="card-head"><div><h3>Ödeme Yapılacak Hesap</h3><p>IBAN'ı kopyalayıp ödemenizi yapabilirsiniz.</p></div></div><div class="iban-box"><span>${esc(d.iban||'IBAN tanımlanmamış')}</span>${d.iban?`<button class="btn sm" data-copy="${esc(d.iban)}">IBAN Kopyala</button>`:''}</div></div>
    <div class="card"><div class="card-head"><div><h3>Aylık Ödemeler</h3><p>Ödeme bildirimi Yusuf onaylayana kadar borcu değiştirmez.</p></div>${isAdmin()?`<button class="btn primary sm" data-debt-plan="${d.id}">+ Ay Planı</button>`:''}</div>${renderDebtPlans(d,plans)}</div>
    <div class="card"><div class="card-head"><div><h3>Hesap Hareketleri</h3><p>Yusuf onayından sonra oluşan gerçek borç transferleri</p></div></div>${moves.length?`<div class="table-wrap"><table class="table"><thead><tr><th>Tarih</th><th>Hareket</th><th>Tutar</th><th>Açıklama</th></tr></thead><tbody>${moves.map(m=>`<tr><td>${dateTR(m.date)}</td><td>${esc(m.title)}</td><td class="amount-pos">+${money(m.amount)}</td><td>${esc(m.note)}</td></tr>`).join('')}</tbody></table></div>`:`<div class="empty"><strong>Henüz ödeme yok</strong>Onaylanan ödemeler burada görünecek.</div>`}</div>
  </div>`;
}
function renderDebtPlans(debt,plans){
  if(!plans.length) return `<div class="empty"><strong>Plan yok</strong>${isAdmin()?'İlk aylık ödeme planını belirleyin.':''}</div>`;
  return `<div class="table-wrap"><table class="table"><thead><tr><th>Ay</th><th>Son Gün</th><th>Yusuf</th><th>Taha</th><th>Ömer</th><th>Benim Durumum</th><th></th></tr></thead><tbody>${plans.map(p=>{
    const claim=state.paymentClaims.find(c=>c.planId===p.id&&c.user===currentUser&&c.status!=='rejected');
    const own=num(p.amounts?.[currentUser]);
    return `<tr><td>${monthTR(p.month)}</td><td>${dateTR(p.dueDate)}</td><td>${money(p.amounts.Yusuf)}</td><td>${money(p.amounts.Taha)}</td><td>${money(p.amounts.Ömer)}</td><td>${claim?statusBadge(claim.status):own>0?'<span class="muted">Ödenmedi</span>':'-'}</td><td>${own>0&&!claim?`<button class="btn good sm" data-mark-paid="${p.id}">Ödeme Yaptım</button>`:''}</td></tr>`;
  }).join('')}</tbody></table></div>`;
}
function statusBadge(s){ return `<span class="status ${s}">${s==='pending'?'Onay Bekliyor':s==='approved'?'Onaylandı':'Reddedildi'}</span>`; }

function unreadForUser(user){ return state.notifications.filter(n=>n.targetUser===user&&!n.read).length; }
function renderNotifications(){
  if(isAdmin()){
    const pending=state.paymentClaims.filter(c=>c.status==='pending').sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||''));
    return `<div class="page-grid"><div class="card"><div class="card-head"><div><h3>Ödeme Onayları</h3><p>Kullanıcı “Ödeme Yaptım” dediğinde borç henüz değişmez.</p></div></div>${pending.length?`<div class="page-grid">${pending.map(c=>{
      const d=accountById(c.debtAccountId);return `<div class="claim-card"><div class="card-head"><div><h3>${esc(c.user)} ödeme yaptığını bildirdi</h3><p>${esc(d?.name||'')} • ${monthTR(c.month)} • ${dateTR(c.paymentDate)}</p></div><strong>${money(c.amount)}</strong></div>${c.note?`<div class="muted">${esc(c.note)}</div>`:''}<div class="top-actions" style="margin-top:12px"><button class="btn good sm" data-approve-claim="${c.id}">Ödeme Alındı — Onayla</button><button class="btn danger sm" data-reject-claim="${c.id}">Reddet</button></div></div>`;
    }).join('')}</div>`:`<div class="empty"><strong>Onay bekleyen ödeme yok</strong>Tüm bildirimler tamamlanmış.</div>`}</div></div>`;
  }
  const notes=state.notifications.filter(n=>n.targetUser===currentUser).sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||''));
  notes.forEach(n=>n.read=true); saveState(false);
  return `<div class="card"><div class="card-head"><div><h3>Bildirimlerim</h3><p>Yusuf’un ödeme onay ve ret sonuçları</p></div></div>${notes.length?`<div class="page-grid">${notes.map(n=>`<div class="notification ${n.read?'':'unread'}"><strong>${esc(n.title)}</strong><div class="muted" style="margin-top:5px">${esc(n.message)}</div><div class="stat-note">${new Date(n.createdAt).toLocaleString('tr-TR')}</div></div>`).join('')}</div>`:`<div class="empty">Bildirim yok.</div>`}</div>`;
}

function renderStatement(){
  const start = $('#statementStart')?.value || '';
  const end = $('#statementEnd')?.value || '';
  const selected = $('#statementAccount')?.value || 'ALL';
  return `<div class="page-grid">
    <div class="card no-print"><div class="card-head"><div><h3>Ekstre Filtreleri</h3><p>PDF çıktısında açılan bütün hesapların özeti gösterilir.</p></div><button id="printStatement" class="btn primary">PDF Olarak Yazdır</button></div><div class="filterbar"><div class="field"><label>Hesap</label><select id="statementAccount" class="select"><option value="ALL">Tüm Hesaplar</option>${state.accounts.map(a=>`<option value="${a.id}" ${selected===a.id?'selected':''}>${esc(a.name)}</option>`).join('')}</select></div><div class="field"><label>Başlangıç</label><input id="statementStart" class="input" type="date" value="${esc(start)}"></div><div class="field"><label>Bitiş</label><input id="statementEnd" class="input" type="date" value="${esc(end)}"></div></div></div>
    <div id="statementReport" class="card">${statementReportHTML(selected,start,end)}</div>
  </div>`;
}
function renderStatementFilterOnly(){
  const report=$('#statementReport'); if(!report)return;
  report.innerHTML=statementReportHTML($('#statementAccount').value,$('#statementStart').value,$('#statementEnd').value);
}
function statementReportHTML(selected='ALL',start='',end=''){
  const accounts=selected==='ALL'?state.accounts:state.accounts.filter(a=>a.id===selected);
  return `<div class="card-head"><div><h3>Kutsal Cumartesi Kasa — Genel Finans Ekstresi</h3><p>${start||end?`${start?dateTR(start):'Başlangıç'} — ${end?dateTR(end):'Bugün'}`:'Tüm dönem'} • Oluşturma: ${new Date().toLocaleString('tr-TR')}</p></div></div>
  ${accounts.map(a=>statementAccountBlock(a,start,end)).join('')||'<div class="empty">Hesap bulunamadı.</div>'}`;
}
function statementAccountBlock(a,start,end){
  if(a.type==='debt'){
    const plans=state.debtPlans.filter(p=>p.debtAccountId===a.id);
    const approved=state.paymentClaims.filter(c=>c.debtAccountId===a.id&&c.status==='approved'&&withinDate(c.approvedAt||c.createdAt,start,end));
    return `<section class="report-account"><div class="report-head"><div><h3>${esc(a.name)}</h3><div class="muted">Borç Hesabı • ${esc(a.iban||'IBAN yok')}</div></div><div style="text-align:right"><div class="muted">Kalan Borç</div><strong>${money(debtRemaining(a.id))}</strong></div></div><div class="report-metrics"><div class="report-metric"><small>Toplam Borç</small><strong>${money(a.totalDebt)}</strong></div><div class="report-metric"><small>Toplam Onaylı Ödeme</small><strong>${money(debtApprovedTotal(a.id))}</strong></div><div class="report-metric"><small>Kalan</small><strong>${money(debtRemaining(a.id))}</strong></div><div class="report-metric"><small>Aylık Plan</small><strong>${plans.length}</strong></div><div class="report-metric"><small>Dönem Onayı</small><strong>${money(approved.reduce((s,c)=>s+num(c.amount),0))}</strong></div></div></section>`;
  }
  const b=getBalances(a.id), positions=getPositions(a.id).filter(p=>p.quantity>1e-9), realized=realizedPL(a.id), gold=positions.find(p=>p.type==='GOLD'&&p.symbol==='GRAM');
  const moves=getAccountMovements(a).filter(m=>withinDate(m.date,start,end));
  return `<section class="report-account"><div class="report-head"><div><h3>${esc(a.name)}</h3><div class="muted">${esc(typeLabel(a.type))}${a.bankName?` • ${esc(a.bankName)}`:''}</div></div><div style="text-align:right"><div class="muted">Tahmini Güncel Değer</div><strong>${money(accountEstimatedValue(a.id))}</strong></div></div><div class="report-metrics"><div class="report-metric"><small>TL</small><strong>${money(b.TL)}</strong></div><div class="report-metric"><small>USD</small><strong>${qty(b.USD,2)}</strong></div><div class="report-metric"><small>EUR</small><strong>${qty(b.EUR,2)}</strong></div><div class="report-metric"><small>Altın</small><strong>${qty(gold?.quantity||0,4)} gr</strong></div><div class="report-metric"><small>Gerçekleşen K/Z</small><strong>${plHtml(realized)}</strong></div></div>${positions.length?`<div style="margin-top:12px"><strong style="font-size:11px">Güncel Yatırım Pozisyonları</strong><div class="table-wrap" style="margin-top:7px"><table class="table"><thead><tr><th>Tür</th><th>Varlık</th><th>Adet</th><th>Ort. Maliyet</th><th>Güncel Fiyat</th><th>Güncel Değer</th><th>Gerç. Olmayan K/Z</th></tr></thead><tbody>${positions.map(p=>`<tr><td>${instrumentLabel(p.type)}</td><td>${esc(p.name)} (${esc(p.symbol)})</td><td>${qty(p.quantity,4)}</td><td>${money(p.avgCost)}</td><td>${p.currentPrice?money(p.currentPrice):'-'}</td><td>${money(p.marketValue)}</td><td>${plHtml(p.unrealized)}</td></tr>`).join('')}</tbody></table></div></div>`:''}<div style="margin-top:12px"><strong style="font-size:11px">Dönem Hareketleri</strong>${moves.length?`<div class="table-wrap" style="margin-top:7px"><table class="table"><thead><tr><th>Tarih</th><th>İşlem</th><th>Karşı Taraf</th><th>Varlık</th><th>Tutar</th></tr></thead><tbody>${moves.map(m=>`<tr><td>${dateTR(m.date)}</td><td>${esc(m.label)}</td><td>${esc(m.counterparty)}</td><td>${esc(m.asset)}</td><td>${m.asset==='TL'?money(m.signed):qty(m.signed,4)}</td></tr>`).join('')}</tbody></table></div>`:'<div class="muted" style="margin-top:7px">Dönemde hareket yok.</div>'}</div></section>`;
}
function withinDate(d,start,end){
  if(!d)return true; const x=String(d).slice(0,10); if(start&&x<start)return false; if(end&&x>end)return false; return true;
}

function renderSettings(){
  const priceRows=Object.keys(state.prices).sort().map(k=>`<tr><td>${esc(state.priceNames[k]||k)}</td><td>${esc(k)}</td><td>${num(state.prices[k])?money(state.prices[k]):'-'}</td><td><button class="btn sm" data-price-edit="${esc(k)}">Güncelle</button></td></tr>`).join('');
  return `<div class="page-grid"><div class="split"><div class="card"><div class="card-head"><div><h3>Güncel Fiyatlar</h3><p>Ekstredeki güncel değer ve gerçekleşmemiş K/Z için kullanılır.</p></div><button class="btn primary sm" data-quick="price-new">+ Fiyat Ekle</button></div><div class="table-wrap"><table class="table"><thead><tr><th>Ad</th><th>Kod</th><th>Fiyat</th><th></th></tr></thead><tbody>${priceRows}</tbody></table></div></div><div class="card"><div class="card-head"><div><h3>Borç Ayarları</h3><p>Varsayılan aylık son ödeme günü</p></div></div><div class="field"><label>Her ayın kaçında?</label><input id="dueDayInput" class="input" type="number" min="1" max="28" value="${state.settings.debtDueDay}"></div><button id="saveDueDay" class="btn primary">Kaydet</button><div class="separator"></div><div class="card-head"><div><h3>Yerel Veri</h3><p>Sadece bu tarayıcıdaki test verileri</p></div></div><button id="resetSystem" class="btn danger">Tüm Verileri Sıfırla</button></div></div></div>`;
}
function saveDueDay(){ if(!isAdmin())return; const n=Math.max(1,Math.min(28,num($('#dueDayInput').value))); state.settings.debtDueDay=n; saveState(); toast('Son ödeme günü güncellendi.','good'); }

function handleQuick(action){
  if(!isAdmin() && !['noop'].includes(action)) return toast('Bu işlem için Yusuf yetkisi gerekir.','warn');
  if(action==='new-account') openNewAccountModal();
  if(action==='external') openExternalModal();
  if(action==='transfer') openTransferModal();
  if(action==='fx') openFxModal();
  if(action==='trade') openTradeModal();
  if(action==='adjustment') openAdjustmentModal();
  if(action==='price-new') openPriceModal(null);
}

function modal(title,body,foot=''){
  $('#modalRoot').innerHTML=`<div class="modal-backdrop"><section class="modal"><header class="modal-head"><h3>${title}</h3><button class="modal-close" data-close-modal>×</button></header><div class="modal-body">${body}</div>${foot?`<footer class="modal-foot">${foot}</footer>`:''}</section></div>`;
  $('[data-close-modal]')?.addEventListener('click',closeModal); $('.modal-backdrop')?.addEventListener('click',e=>{if(e.target.classList.contains('modal-backdrop'))closeModal();});
}
function closeModal(){ $('#modalRoot').innerHTML=''; }
function field(label,html,hint=''){ return `<div class="field"><label>${label}</label>${html}${hint?`<div class="hint">${hint}</div>`:''}</div>`; }
function accountOptions(filterFn=()=>true,selected=''){ return state.accounts.filter(filterFn).map(a=>`<option value="${a.id}" ${a.id===selected?'selected':''}>${esc(a.name)} — ${esc(typeLabel(a.type))}</option>`).join(''); }
function assetOptions(selected='TL'){ return ASSETS.map(a=>`<option value="${a}" ${a===selected?'selected':''}>${a}</option>`).join(''); }

function openNewAccountModal(){
  if(!isAdmin())return;
  const body=`<div class="form-grid"><div class="full">${field('Hesap Türü','<select id="naType" class="select"><option value="wallet">Kasa / Cüzdan</option><option value="current">Cari</option><option value="debt">Borç Hesabı</option><option value="investment">Yatırım Hesabı</option></select>')}</div>${field('Hesap Adı','<input id="naName" class="input" placeholder="Örn. İş Bankası Kasa">')}${field('Banka Adı','<input id="naBank" class="input" placeholder="Opsiyonel">')}<div id="naOwnerWrap">${field('Cari Sahibi','<select id="naOwner" class="select"><option value="">Seçiniz</option><option>Yusuf</option><option>Taha</option><option>Ömer</option></select>')}</div><div id="naIbanWrap">${field('IBAN','<input id="naIban" class="input" placeholder="TR...">')}</div><div id="naDebtWrap" class="hidden">${field('Toplam Borç','<input id="naDebt" class="input" type="number" min="0" step="0.01" placeholder="0">')}</div><div class="full">${field('Not','<textarea id="naNote" class="textarea" placeholder="Opsiyonel açıklama"></textarea>')}</div></div>`;
  modal('Yeni Hesap',body,'<button class="btn ghost" data-close-modal>Vazgeç</button><button id="saveNewAccount" class="btn primary">Hesabı Aç</button>');
  const sync=()=>{const t=$('#naType').value; $('#naOwnerWrap').classList.toggle('hidden',t!=='current'); $('#naDebtWrap').classList.toggle('hidden',t!=='debt'); $('#naIbanWrap').classList.toggle('hidden',t!=='debt'&&t!=='wallet');}; sync(); $('#naType').addEventListener('change',sync); $$('[data-close-modal]').forEach(b=>b.addEventListener('click',closeModal)); $('#saveNewAccount').addEventListener('click',saveNewAccount);
}
function saveNewAccount(){
  const type=$('#naType').value,name=$('#naName').value.trim(),bankName=$('#naBank').value.trim(),owner=$('#naOwner')?.value||'',iban=$('#naIban')?.value.trim()||'',totalDebt=num($('#naDebt')?.value),note=$('#naNote').value.trim();
  if(!name)return toast('Hesap adı zorunlu.','bad');
  if(type==='debt'&&(!iban||totalDebt<=0))return toast('Borç hesabında IBAN ve toplam borç zorunlu.','bad');
  state.accounts.push({id:uid('acc'),type,name,bankName,owner:type==='current'?owner:'',iban,totalDebt:type==='debt'?totalDebt:0,note,createdAt:nowISO()}); saveState(); closeModal(); toast(`${name} açıldı.`,'good');
}

function openExternalModal(){
  const selected = route.page==='account' && accountById(route.id)?.type!=='debt' ? route.id : realAccounts()[0]?.id;
  const body=`<div class="form-grid">${field('Hesap',`<select id="exAccount" class="select">${accountOptions(a=>a.type!=='debt',selected)}</select>`)}${field('İşlem','<select id="exDirection" class="select"><option value="external_in">Para Girişi</option><option value="external_out">Para Çıkışı</option></select>')}${field('Kimden / Kime','<select id="exCounter" class="select"><option value="">Dışarıdan / Diğer</option><option>Yusuf</option><option>Taha</option><option>Ömer</option></select>','Kişi seçersen ilgili caride otomatik hareket görünür; cari bakiyesi ayrıca bozulmaz.')}${field('Nakit / Banka','<select id="exChannel" class="select"><option value="BANKA">Banka</option><option value="NAKİT">Nakit</option></select>')}<div id="exBankWrap">${field('Banka Adı','<input id="exBank" class="input" placeholder="Örn. Enpara">')}</div>${field('Varlık',`<select id="exAsset" class="select">${assetOptions()}</select>`)}${field('Tutar','<input id="exAmount" class="input" type="number" min="0" step="0.01">')}${field('Tarih',`<input id="exDate" class="input" type="date" value="${today()}">`)}<div class="full">${field('Açıklama','<textarea id="exNote" class="textarea" placeholder="Opsiyonel"></textarea>')}</div></div>`;
  modal('Para Girişi / Çıkışı',body,'<button class="btn ghost" data-close-modal>Vazgeç</button><button id="saveExternal" class="btn primary">Kaydet</button>');
  $$('[data-close-modal]').forEach(b=>b.addEventListener('click',closeModal));
  const syncBank=()=>$('#exBankWrap').classList.toggle('hidden',$('#exChannel').value!=='BANKA'); syncBank(); $('#exChannel').addEventListener('change',syncBank); $('#exAccount').addEventListener('change',()=>{const a=accountById($('#exAccount').value); if(a?.bankName&&!$('#exBank').value)$('#exBank').value=a.bankName;}); const a=accountById(selected); if(a?.bankName)$('#exBank').value=a.bankName;
  $('#saveExternal').addEventListener('click',saveExternal);
}
function saveExternal(){
  const accountId=$('#exAccount').value,type=$('#exDirection').value,counterparty=$('#exCounter').value,channel=$('#exChannel').value,bankName=channel==='BANKA'?$('#exBank').value.trim():'',asset=$('#exAsset').value,amount=num($('#exAmount').value),date=$('#exDate').value,note=$('#exNote').value.trim();
  if(!accountId||amount<=0||!date)return toast('Hesap, tutar ve tarih zorunlu.','bad');
  if(type==='external_out'&&!validateEnough(accountId,asset,amount))return toast(`${accountName(accountId)} hesabında yeterli ${asset} yok.`,'bad');
  state.transactions.push({id:uid('tx'),type,accountId,counterparty,channel,bankName,asset,amount,date,note,createdBy:currentUser,createdAt:nowISO()}); saveState(); closeModal(); toast('Para işlemi kaydedildi.','good');
}

function openTransferModal(){
  const sources=realAccounts(); if(!sources.length)return toast('Transfer için hesap yok.','warn');
  const selected=route.page==='account'&&realAccounts().some(a=>a.id===route.id)?route.id:sources[0].id;
  const body=`<div class="form-grid">${field('Kaynak Hesap',`<select id="trFrom" class="select">${accountOptions(a=>a.type!=='debt',selected)}</select>`)}${field('Hedef Hesap',`<select id="trTo" class="select">${accountOptions(a=>a.id!==selected)}</select>`)}${field('Varlık',`<select id="trAsset" class="select">${assetOptions()}</select>`)}${field('Tutar','<input id="trAmount" class="input" type="number" min="0" step="0.01">')}${field('Tarih',`<input id="trDate" class="input" type="date" value="${today()}">`)}<div id="trPayerWrap" class="hidden">${field('Borç Ödeyen','<select id="trPayer" class="select"><option>Yusuf</option><option>Taha</option><option>Ömer</option><option value="Genel">Genel</option></select>')}</div><div class="full">${field('Açıklama','<textarea id="trNote" class="textarea"></textarea>')}</div><div class="full"><div id="trBalanceInfo" class="calc-box"></div></div></div>`;
  modal('Hesaplar Arası Transfer',body,'<button class="btn ghost" data-close-modal>Vazgeç</button><button id="saveTransfer" class="btn primary">Transfer Et</button>');
  $$('[data-close-modal]').forEach(b=>b.addEventListener('click',closeModal));
  const sync=()=>{const from=$('#trFrom').value,to=$('#trTo').value,asset=$('#trAsset').value; const opts=state.accounts.filter(a=>a.id!==from).map(a=>`<option value="${a.id}" ${a.id===to?'selected':''}>${esc(a.name)} — ${esc(typeLabel(a.type))}</option>`).join(''); $('#trTo').innerHTML=opts; const target=accountById($('#trTo').value); $('#trPayerWrap').classList.toggle('hidden',target?.type!=='debt'); const b=getBalances(from); $('#trBalanceInfo').innerHTML=`Kullanılabilir ${asset}: <strong>${asset==='TL'?money(b[asset]):qty(b[asset],4)}</strong>${target?.type==='debt'?'<br><span class="muted">Borç hesabına transfer TL ile borç ödemesi olarak işlenir.</span>':''}`;}; sync(); $('#trFrom').addEventListener('change',sync); $('#trTo').addEventListener('change',sync); $('#trAsset').addEventListener('change',sync); $('#saveTransfer').addEventListener('click',saveTransfer);
}
function saveTransfer(){
  const from=$('#trFrom').value,to=$('#trTo').value,asset=$('#trAsset').value,amount=num($('#trAmount').value),date=$('#trDate').value,note=$('#trNote').value.trim(),target=accountById(to);
  if(!from||!to||from===to||amount<=0||!date)return toast('Transfer bilgilerini kontrol edin.','bad');
  if(target?.type==='debt'){
    if(asset!=='TL')return toast('Borç ödemesi sadece TL olabilir.','bad');
    if(!validateEnough(from,'TL',amount))return toast('Kaynak hesapta yeterli TL yok.','bad');
    if(amount>debtRemaining(to)+1e-9)return toast('Ödeme kalan borçtan büyük olamaz.','bad');
    state.transactions.push({id:uid('tx'),type:'debt_payment',fromAccountId:from,debtAccountId:to,payer:$('#trPayer').value,asset:'TL',amount,date,note,createdBy:currentUser,createdAt:nowISO()});
  }else{
    if(!validateEnough(from,asset,amount))return toast(`Kaynak hesapta yeterli ${asset} yok.`,'bad');
    state.transactions.push({id:uid('tx'),type:'transfer',fromAccountId:from,toAccountId:to,asset,amount,date,note,createdBy:currentUser,createdAt:nowISO()});
  }
  saveState(); closeModal(); toast('Transfer tamamlandı.','good');
}

function openFxModal(){
  const selected=route.page==='account'&&accountById(route.id)?.type!=='debt'?route.id:realAccounts()[0]?.id;
  const body=`<div class="form-grid">${field('Hesap',`<select id="fxAccount" class="select">${accountOptions(a=>a.type!=='debt',selected)}</select>`)}${field('İşlem','<select id="fxType" class="select"><option value="fx_buy">Döviz Alımı</option><option value="fx_sell">Döviz Satımı</option></select>')}${field('Döviz','<select id="fxAsset" class="select"><option>USD</option><option>EUR</option></select>')}${field('Kur TL','<input id="fxRate" class="input" type="number" min="0" step="0.0001">')}${field('Miktar','<input id="fxQty" class="input" type="number" min="0" step="0.01">')}${field('Tarih',`<input id="fxDate" class="input" type="date" value="${today()}">`)}<div class="full">${field('Açıklama','<textarea id="fxNote" class="textarea"></textarea>')}</div><div class="full"><div id="fxCalc" class="calc-box"></div></div></div>`;
  modal('Döviz Alım / Satım',body,'<button class="btn ghost" data-close-modal>Vazgeç</button><button id="saveFx" class="btn primary">Kaydet</button>'); $$('[data-close-modal]').forEach(b=>b.addEventListener('click',closeModal));
  const sync=()=>{const a=$('#fxAccount').value,asset=$('#fxAsset').value,type=$('#fxType').value,rate=num($('#fxRate').value),q=num($('#fxQty').value),b=getBalances(a),total=rate*q; $('#fxCalc').innerHTML=`TL Bakiye: <strong>${money(b.TL)}</strong> • ${asset}: <strong>${qty(b[asset],2)}</strong><br>${type==='fx_buy'?'Alım maliyeti':'Satış karşılığı'}: <strong>${money(total)}</strong>`;}; ['fxAccount','fxAsset','fxType','fxRate','fxQty'].forEach(id=>$('#'+id).addEventListener('input',sync)); const asset=$('#fxAsset').value; if(state.prices[`FX:${asset}`])$('#fxRate').value=state.prices[`FX:${asset}`]; sync(); $('#saveFx').addEventListener('click',saveFx);
}
function saveFx(){
  const accountId=$('#fxAccount').value,type=$('#fxType').value,asset=$('#fxAsset').value,rate=num($('#fxRate').value),quantity=num($('#fxQty').value),date=$('#fxDate').value,note=$('#fxNote').value.trim(),cost=rate*quantity;
  if(!accountId||rate<=0||quantity<=0||!date)return toast('Kur, miktar ve tarih zorunlu.','bad');
  if(type==='fx_buy'&&!validateEnough(accountId,'TL',cost))return toast('Hesapta alım için yeterli TL yok.','bad');
  if(type==='fx_sell'&&!validateEnough(accountId,asset,quantity))return toast(`Hesapta yeterli ${asset} yok.`,'bad');
  state.transactions.push({id:uid('tx'),type,accountId,asset,rate,quantity,date,note,createdBy:currentUser,createdAt:nowISO()}); state.prices[`FX:${asset}`]=rate; saveState(); closeModal(); toast('Döviz işlemi kaydedildi.','good');
}

function openTradeModal(){
  const eligible=realAccounts(); const selected=route.page==='account'&&eligible.some(a=>a.id===route.id)?route.id:eligible[0]?.id;
  const body=`<div class="form-grid">${field('Hesap',`<select id="tdAccount" class="select">${accountOptions(a=>a.type!=='debt',selected)}</select>`)}${field('İşlem','<select id="tdSide" class="select"><option value="trade_buy">Alım</option><option value="trade_sell">Satım</option></select>')}${field('Tür','<select id="tdType" class="select"><option value="GOLD">Altın</option><option value="FUND">Fon</option><option value="STOCK">Hisse</option></select>')}${field('Kod / Sembol','<input id="tdSymbol" class="input" value="GRAM" placeholder="THYAO / AFT / GRAM">')}${field('Varlık Adı','<input id="tdName" class="input" value="Gram Altın" placeholder="Türk Hava Yolları">')}${field('Adet / Pay','<input id="tdQty" class="input" type="number" min="0" step="0.0001">')}${field('Birim Fiyat TL','<input id="tdPrice" class="input" type="number" min="0" step="0.0001">','Satımda güncel satış fiyatını yazın. Sistem kâr/zararı hesaplar.')}${field('Tarih',`<input id="tdDate" class="input" type="date" value="${today()}">`)}<div class="full">${field('Açıklama','<textarea id="tdNote" class="textarea"></textarea>')}</div><div class="full"><div id="tdCalc" class="calc-box"></div></div></div>`;
  modal('Altın / Fon / Hisse Alım-Satım',body,'<button class="btn ghost" data-close-modal>Vazgeç</button><button id="saveTrade" class="btn primary">Kaydet</button>'); $$('[data-close-modal]').forEach(b=>b.addEventListener('click',closeModal));
  const syncType=()=>{const type=$('#tdType').value;if(type==='GOLD'){if(!$('#tdSymbol').value||['THYAO','AFT'].includes($('#tdSymbol').value))$('#tdSymbol').value='GRAM';if(!$('#tdName').value||['Türk Hava Yolları'].includes($('#tdName').value))$('#tdName').value='Gram Altın';} syncTradeCalc();};
  ['tdAccount','tdSide','tdType','tdSymbol','tdQty','tdPrice'].forEach(id=>$('#'+id).addEventListener('input',syncTradeCalc)); $('#tdType').addEventListener('change',syncType); syncTradeCalc(); $('#saveTrade').addEventListener('click',saveTrade);
}
function syncTradeCalc(){
  const box=$('#tdCalc'); if(!box)return; const accountId=$('#tdAccount').value,type=$('#tdType').value,symbol=$('#tdSymbol').value.trim().toUpperCase(),side=$('#tdSide').value,q=num($('#tdQty').value),price=num($('#tdPrice').value),b=getBalances(accountId),p=getPositions(accountId).find(x=>x.key===instrumentKey(type,symbol)),total=q*price;
  if(side==='trade_buy') box.innerHTML=`TL Bakiye: <strong>${money(b.TL)}</strong><br>Alım maliyeti: <strong>${money(total)}</strong>`;
  else { const avg=num(p?.avgCost),profit=q*(price-avg); box.innerHTML=`Mevcut: <strong>${qty(p?.quantity||0,4)}</strong> • Ortalama maliyet: <strong>${money(avg)}</strong><br>Satış tutarı: <strong>${money(total)}</strong> • Tahmini sonuç: <strong class="${profit>0?'profit':profit<0?'loss':'neutral'}">${profit>0?'+':''}${money(profit)}</strong>`; }
}
function saveTrade(){
  const accountId=$('#tdAccount').value,type=$('#tdType').value,symbol=$('#tdSymbol').value.trim().toUpperCase(),instrumentName=$('#tdName').value.trim()||symbol,side=$('#tdSide').value,quantity=num($('#tdQty').value),price=num($('#tdPrice').value),date=$('#tdDate').value,note=$('#tdNote').value.trim(),total=quantity*price;
  if(!accountId||!symbol||quantity<=0||price<=0||!date)return toast('Hesap, sembol, adet, fiyat ve tarih zorunlu.','bad');
  if(side==='trade_buy'&&!validateEnough(accountId,'TL',total))return toast('Hesapta alım için yeterli TL yok.','bad');
  let realizedProfit=0;
  if(side==='trade_sell'){
    if(!validatePositionEnough(accountId,type,symbol,quantity))return toast('Satış için yeterli adet/pay yok.','bad');
    const p=getPositions(accountId).find(x=>x.key===instrumentKey(type,symbol)); realizedProfit=quantity*(price-num(p?.avgCost));
  }
  const key=instrumentKey(type,symbol); state.priceNames[key]=instrumentName; state.prices[key]=price;
  state.transactions.push({id:uid('tx'),type:side,accountId,instrumentType:type,symbol,instrumentName,quantity,price,realizedProfit,date,note,createdBy:currentUser,createdAt:nowISO()}); saveState(); closeModal();
  if(side==='trade_sell') toast(`Satış kaydedildi. Bu işlemden ${realizedProfit>=0?'+':''}${money(realizedProfit)} ${realizedProfit>=0?'kâr':'zarar'}.`,realizedProfit>=0?'good':'bad'); else toast('Alım kaydedildi.','good');
}

function openAdjustmentModal(){
  const selected=route.page==='account'&&accountById(route.id)?.type!=='debt'?route.id:realAccounts()[0]?.id;
  const body=`<div class="form-grid">${field('Hesap',`<select id="adAccount" class="select">${accountOptions(a=>a.type!=='debt',selected)}</select>`)}${field('Varlık',`<select id="adAsset" class="select">${assetOptions()}</select>`)}${field('Düzeltme Tutarı','<input id="adAmount" class="input" type="number" step="0.01" placeholder="Artı veya eksi yazın">','Örn. +500 giriş, -250 çıkış düzeltmesi.')}${field('Tarih',`<input id="adDate" class="input" type="date" value="${today()}">`)}<div class="full">${field('Sebep','<textarea id="adNote" class="textarea" placeholder="Düzeltmenin nedenini yazın"></textarea>')}</div></div>`;
  modal('Bakiye Düzeltme',body,'<button class="btn ghost" data-close-modal>Vazgeç</button><button id="saveAdjustment" class="btn primary">Kaydet</button>'); $$('[data-close-modal]').forEach(b=>b.addEventListener('click',closeModal)); $('#saveAdjustment').addEventListener('click',()=>{const accountId=$('#adAccount').value,asset=$('#adAsset').value,amount=num($('#adAmount').value),date=$('#adDate').value,note=$('#adNote').value.trim(); if(!amount||!date)return toast('Tutar ve tarih zorunlu.','bad'); if(amount<0&&!validateEnough(accountId,asset,Math.abs(amount)))return toast('Negatif düzeltme bakiyeyi eksiye düşürüyor.','bad'); state.transactions.push({id:uid('tx'),type:'adjustment',accountId,asset,amount,date,note,createdBy:currentUser,createdAt:nowISO()}); saveState(); closeModal(); toast('Düzeltme kaydedildi.','good');});
}

function openDebtPlanModal(debtId){
  if(!isAdmin())return; const d=accountById(debtId); const ym=today().slice(0,7);
  const body=`<div class="form-grid">${field('Borç Hesabı',`<input class="input" value="${esc(d.name)}" disabled>`)}${field('Ay',`<input id="dpMonth" class="input" type="month" value="${ym}">`)}${field('Yusuf Ödemesi','<input id="dpY" class="input" type="number" min="0" step="0.01" value="0">')}${field('Taha Ödemesi','<input id="dpT" class="input" type="number" min="0" step="0.01" value="0">')}${field('Ömer Ödemesi','<input id="dpO" class="input" type="number" min="0" step="0.01" value="0">')}<div class="field"><label>Son Ödeme</label><div class="calc-box">Her ayın <strong>${state.settings.debtDueDay}</strong>'i</div></div></div>`;
  modal('Aylık Borç Ödemesi Belirle',body,'<button class="btn ghost" data-close-modal>Vazgeç</button><button id="saveDebtPlan" class="btn primary">Kaydet</button>'); $$('[data-close-modal]').forEach(b=>b.addEventListener('click',closeModal)); $('#saveDebtPlan').addEventListener('click',()=>{const month=$('#dpMonth').value;if(!month)return toast('Ay seçin.','bad'); if(state.debtPlans.some(p=>p.debtAccountId===debtId&&p.month===month))return toast('Bu ay için plan zaten var.','bad'); const [y,m]=month.split('-').map(Number); const dueDate=`${y}-${String(m).padStart(2,'0')}-${String(state.settings.debtDueDay).padStart(2,'0')}`; state.debtPlans.push({id:uid('plan'),debtAccountId:debtId,month,dueDate,amounts:{Yusuf:num($('#dpY').value),Taha:num($('#dpT').value),Ömer:num($('#dpO').value)},createdAt:nowISO(),createdBy:currentUser}); saveState(); closeModal(); toast(`${monthTR(month)} planı kaydedildi.`,'good');});
}
function openPaymentClaimModal(planId){
  const p=state.debtPlans.find(x=>x.id===planId); if(!p)return; const amount=num(p.amounts?.[currentUser]); if(amount<=0)return toast('Size tanımlı ödeme yok.','warn'); const d=accountById(p.debtAccountId);
  modal('Ödeme Yaptım',`<div class="calc-box"><strong>${esc(d.name)}</strong><br>${monthTR(p.month)} • ${money(amount)}<br><span class="muted">Bu bildirim borcu hemen düşürmez. Yusuf onayladıktan sonra düşer.</span></div>${field('Ödeme Tarihi',`<input id="pcDate" class="input" type="date" value="${today()}">`)}${field('Not / Dekont Açıklaması','<textarea id="pcNote" class="textarea" placeholder="Opsiyonel"></textarea>')}`,'<button class="btn ghost" data-close-modal>Vazgeç</button><button id="sendClaim" class="btn good">Yusuf’a Bildir</button>'); $$('[data-close-modal]').forEach(b=>b.addEventListener('click',closeModal)); $('#sendClaim').addEventListener('click',()=>{if(state.paymentClaims.some(c=>c.planId===planId&&c.user===currentUser&&c.status==='pending'))return toast('Zaten onay bekleyen bildiriminiz var.','warn'); state.paymentClaims.push({id:uid('claim'),planId,debtAccountId:p.debtAccountId,user:currentUser,month:p.month,amount,paymentDate:$('#pcDate').value,note:$('#pcNote').value.trim(),status:'pending',createdAt:nowISO()}); saveState(); closeModal(); toast('Ödeme bildirimi Yusuf’a gönderildi.','good');});
}
function approveClaim(id){
  if(!isAdmin()) return;
  const c=state.paymentClaims.find(x=>x.id===id);
  if(!c || c.status!=='pending') return;
  if(num(c.amount)>debtRemaining(c.debtAccountId)+1e-9) return toast('Ödeme kalan borçtan büyük. Borç hesabını kontrol edin.','bad');

  const currentAcc=currentAccountForUser(c.user);
  const debtAcc=accountById(c.debtAccountId);
  if(!currentAcc) return toast(`${c.user} için cari hesap bulunamadı. Önce cari hesabı oluşturun.`,'bad');
  if(!debtAcc) return toast('Borç hesabı bulunamadı.','bad');

  const entryTx={
    id:uid('tx'), type:'external_in', accountId:currentAcc.id, asset:'TL', amount:num(c.amount),
    counterparty:`${debtAcc.name} ödeme bildirimi`, channel:'BANKA', bankName:'', date:c.paymentDate||today(),
    note:`${c.user} ${monthTR(c.month)} borç ödemesi — Yusuf onayı ile cari hesaba giriş`,
    purpose:'debt_payment_entry', claimId:c.id, createdBy:currentUser, createdAt:nowISO()
  };
  const transferTx={
    id:uid('tx'), type:'transfer', fromAccountId:currentAcc.id, toAccountId:debtAcc.id, asset:'TL', amount:num(c.amount),
    date:c.paymentDate||today(), note:`${c.user} ${monthTR(c.month)} borcu ödedi — ONAYLANDI`,
    purpose:'debt_payment', payer:c.user, debtMonth:c.month, claimId:c.id, createdBy:currentUser, createdAt:nowISO()
  };

  state.transactions.push(entryTx,transferTx);
  c.status='approved'; c.approvedAt=nowISO(); c.approvedBy=currentUser;
  c.linkedEntryTxId=entryTx.id; c.linkedTransferTxId=transferTx.id;
  state.notifications.unshift({id:uid('n'),targetUser:c.user,title:'Borç ödemeniz onaylandı',message:`${monthTR(c.month)} için ${money(c.amount)} ödeme onaylandı. Cari hesabınıza giriş ve ardından ${debtAcc.name} hesabına transfer olarak işlendi.`,createdAt:nowISO(),read:false});
  saveState();
  toast(`${c.user}: ${money(c.amount)} cari giriş + borç hesabına transfer kaydedildi.`,'good');
}
function rejectClaim(id){
  if(!isAdmin())return; const c=state.paymentClaims.find(x=>x.id===id); if(!c||c.status!=='pending')return; c.status='rejected';c.rejectedAt=nowISO(); state.notifications.unshift({id:uid('n'),targetUser:c.user,title:'Ödeme bildiriminiz reddedildi',message:`${monthTR(c.month)} için gönderdiğiniz ${money(c.amount)} ödeme bildirimi onaylanmadı.`,createdAt:nowISO(),read:false}); saveState(); toast('Bildirim reddedildi.','warn');
}

function openPriceModal(key){
  if(!isAdmin())return; const existing=key||''; const [kind0,symbol0]=existing?existing.split(':'):['STOCK','']; const name0=existing?(state.priceNames[existing]||symbol0):''; const value0=existing?num(state.prices[existing]):0;
  const body=`<div class="form-grid">${field('Tür',`<select id="prType" class="select" ${existing?'disabled':''}><option value="FX" ${kind0==='FX'?'selected':''}>Döviz</option><option value="GOLD" ${kind0==='GOLD'?'selected':''}>Altın</option><option value="FUND" ${kind0==='FUND'?'selected':''}>Fon</option><option value="STOCK" ${kind0==='STOCK'?'selected':''}>Hisse</option></select>`)}${field('Kod / Sembol',`<input id="prSymbol" class="input" value="${esc(symbol0)}" ${existing?'disabled':''} placeholder="USD / GRAM / THYAO / AFT">`)}${field('Ad',`<input id="prName" class="input" value="${esc(name0)}" placeholder="Varlık adı">`)}${field('Güncel Fiyat TL',`<input id="prValue" class="input" type="number" min="0" step="0.0001" value="${value0||''}">`)}</div>`;
  modal(existing?'Güncel Fiyatı Güncelle':'Yeni Güncel Fiyat',body,'<button class="btn ghost" data-close-modal>Vazgeç</button><button id="savePrice" class="btn primary">Kaydet</button>'); $$('[data-close-modal]').forEach(b=>b.addEventListener('click',closeModal)); $('#savePrice').addEventListener('click',()=>{const type=$('#prType').value,symbol=$('#prSymbol').value.trim().toUpperCase(),name=$('#prName').value.trim()||symbol,value=num($('#prValue').value); if(!symbol||value<=0)return toast('Kod ve fiyat zorunlu.','bad'); const k=existing||instrumentKey(type,symbol); state.prices[k]=value; state.priceNames[k]=name; saveState(); closeModal(); toast('Güncel fiyat kaydedildi.','good');});
}

function deleteTransaction(id){
  if(!isAdmin())return; const t=state.transactions.find(x=>x.id===id); if(!t)return; if(!confirm('Bu finansal işlem silinsin mi? Bakiyeler yeniden hesaplanacaktır.'))return;
  state.transactions=state.transactions.filter(x=>x.id!==id); saveState(); toast('İşlem silindi; bakiyeler yeniden hesaplandı.','good');
}
function copyText(text){ navigator.clipboard?.writeText(text).then(()=>toast('IBAN kopyalandı.','good')).catch(()=>{prompt('Kopyalayın:',text);}); }
function toast(message,type='good'){
  const root=$('#toastRoot'); const el=document.createElement('div'); el.className=`toast ${type}`; el.textContent=message; root.appendChild(el); setTimeout(()=>el.remove(),3800);
}

// Initial render
if (currentUser && !USERS[currentUser]) currentUser = null;
if (currentUser){ $('#loginRoot').classList.add('hidden'); $('#appRoot').classList.remove('hidden'); renderApp(); }
else renderLogin();
