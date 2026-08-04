/**
 * Quadro de Recompensas — Lógica Frontend (Vanilla JS)
 * Auto-refresh 30s · PIN via teclado visual · Admin CRUD
 */

/* ── Estado global ──────────────────────────────────────────── */
let state        = null;      // dados retornados por /api/estado
let currentPin   = '';        // PIN validado
let currentView  = 'dashboard'; // 'dashboard' | 'detail'
let detailChild  = null;      // filho na visão de detalhe
let refreshTimer = null;      // setInterval do auto-refresh
let pinValue     = '';        // dígitos digitados no PIN
let pendingStatuses = {};     // { tarefaId: true|false|null }
let isOnline     = true;      // status de conexão com o servidor
let failCount    = 0;         // contagem de falhas consecutivas

// Avatares por índice
const AVATARS = ['⭐','🦁','🐯','🐻','🦊','🐼','🦄','🐸','🦋','🌟','🐶','🐱'];

/* ── Utilitários ────────────────────────────────────────────── */
const fmt = v =>
  new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(v);

const monthNames = [
  'Janeiro','Fevereiro','Março','Abril','Maio','Junho',
  'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'
];

function fmtMonth(key) {
  const [y,m] = key.split('-').map(Number);
  return `${monthNames[m-1]} ${y}`;
}

function daysInMonth(key) {
  const [y,m] = key.split('-').map(Number);
  return new Date(y,m,0).getDate();
}

function weekDay(key, day) {
  const [y,m] = key.split('-').map(Number);
  return ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'][new Date(y,m-1,day).getDay()];
}

function today() { return new Date().getDate(); }

function pct(saldo, max) { return Math.min(100, Math.round((saldo/max)*100)); }

function saldoColor(p) {
  if (p >= 80) return 'var(--success)';
  if (p >= 45) return 'var(--warning)';
  return 'var(--danger)';
}

function avatar(i) { return AVATARS[i % AVATARS.length]; }

/** Retorna as tarefas que estão ativas para um filho específico */
function getActiveTasks(filho) {
  const activeIds = state.tarefasAtivas?.[filho];
  if (!activeIds) return state.tarefas;
  return state.tarefas.filter(t => activeIds.includes(t.id));
}

/* ── API ────────────────────────────────────────────────────── */
async function fetchState() {
  const res = await fetch('/api/estado');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function apiPost(url, body, pin) {
  const res = await fetch(url, {
    method : 'POST',
    headers: { 'Content-Type':'application/json', 'x-pin': pin || currentPin },
    body   : JSON.stringify(body)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.erro || `Erro HTTP ${res.status}`);
  return { status: res.status, data };
}

/* ── Auto-refresh (30s) ─────────────────────────────────────── */
function startAutoRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(refresh, 30_000);
}

async function refresh() {
  try {
    state = await fetchState();
    failCount = 0;
    if (!isOnline) {
      isOnline = true;
      updateConnectionStatus();
    }
    updateHeader();
    if (currentView === 'dashboard') renderDashboard();
    else if (currentView === 'detail' && detailChild) renderDetail(detailChild);
  } catch(e) {
    failCount++;
    console.error('Erro ao atualizar:', e);
    if (failCount >= 2 && isOnline) {
      isOnline = false;
      updateConnectionStatus();
    }
  }
}

/** Atualiza o indicador visual de conexão no header */
function updateConnectionStatus() {
  const dot  = document.querySelector('.refresh-dot');
  const text = document.querySelector('.refresh-indicator > span:last-child');
  if (!dot || !text) return;

  if (isOnline) {
    dot.style.background = 'var(--success)';
    text.textContent = 'ao vivo';
    text.style.color = '';
    showToast('✅ Conexão restaurada', 'success');
  } else {
    dot.style.background = 'var(--danger)';
    text.textContent = 'offline';
    text.style.color = 'var(--danger)';
    showToast('⚠️ Servidor desconectado', 'error');
  }
}

/* ── Header ─────────────────────────────────────────────────── */
function updateHeader() {
  if (!state) return;
  document.getElementById('header-month').textContent = fmtMonth(state.mesAtual);
}

/* ── Dashboard ──────────────────────────────────────────────── */
function renderDashboard() {
  const main  = document.getElementById('main-content');
  const dia   = today();
  const diaS  = String(dia);
  const mes   = state.mesAtual;

  if (!state.filhos.length) {
    main.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">👶</span>
        <h2>Nenhum filho cadastrado</h2>
        <p>Abra o painel do pai (⚙️) para adicionar filhos.</p>
      </div>`;
    return;
  }

  main.innerHTML = `
    <div class="dashboard-grid" id="dashboard-grid">
      ${state.filhos.map((filho, i) => buildChildCard(filho, i, mes, diaS)).join('')}
    </div>`;
}

function buildChildCard(filho, i, mes, diaS) {
  const saldo    = state.saldos[filho] ?? state.valorMaximoMensal;
  const p        = pct(saldo, state.valorMaximoMensal);
  const cor      = saldoColor(p);
  const regHoje  = state.registros?.[mes]?.[filho]?.[diaS] || {};
  // Só mostra tarefas ativas para este filho
  const tarefas  = getActiveTasks(filho).map(t => ({
    ...t, status: Object.prototype.hasOwnProperty.call(regHoje, String(t.id))
                    ? regHoje[String(t.id)] : undefined
  }));

  const cumpridas   = tarefas.filter(t => t.status === true).length;
  const descumpridas= tarefas.filter(t => t.status === false).length;

  return `
    <div class="child-card" id="card-${i}" onclick="openDetail('${filho.replace(/'/g,"\\'")}')">
      <div class="card-glow" style="--glow-color:${cor}40"></div>

      <div class="card-header">
        <div class="avatar">${avatar(i)}</div>
        <div>
          <h2 class="child-name">${escapeHtml(filho)}</h2>
          <span class="month-label">${fmtMonth(mes)}</span>
        </div>
      </div>

      <div class="balance-section">
        <div class="balance-amount" style="color:${cor}">${fmt(saldo)}</div>
        <div class="balance-label">de ${fmt(state.valorMaximoMensal)}</div>
        <div class="progress-bar">
          <div class="progress-fill"
               style="width:${p}%;background:${cor};box-shadow:0 0 10px ${cor}60">
          </div>
        </div>
      </div>

      <div class="today-section">
        <div class="today-header">
          <span class="today-label">📅 Hoje — Dia ${today()}</span>
          <span class="today-stats">${cumpridas}/${tarefas.length} ✅ · ${descumpridas} ❌</span>
        </div>
        <div class="tasks-grid">
          ${tarefas.map(t => `
            <div class="task-chip ${t.status===true?'done':t.status===false?'missed':''}">
              <span class="task-icon">${t.icone}</span>
              <span class="task-name">${escapeHtml(t.nome)}</span>
              <span class="task-status">${t.status===true?'🟢':t.status===false?'🔴':'⬜'}</span>
            </div>`).join('')}
        </div>
      </div>

      <div class="card-footer">
        <span class="view-grid-btn">Ver calendário mensal →</span>
      </div>
    </div>`;
}

/* ── Visão de detalhe (grid mensal) ─────────────────────────── */
function openDetail(filho) {
  currentView = 'detail';
  detailChild = filho;
  renderDetail(filho);
}

function renderDetail(filho) {
  const mes      = state.mesAtual;
  const saldo    = state.saldos[filho] ?? state.valorMaximoMensal;
  const p        = pct(saldo, state.valorMaximoMensal);
  const cor      = saldoColor(p);
  const totalDias= daysInMonth(mes);
  const regMes   = state.registros?.[mes]?.[filho] || {};
  const numTar   = state.tarefas.length;
  const main     = document.getElementById('main-content');

  // Define colunas do grid via CSS variable
  document.documentElement.style.setProperty(
    '--grid-cols', `80px repeat(${numTar},minmax(48px,1fr)) 90px`
  );

  const deducaoTotal = state.valorMaximoMensal - saldo;
  // Só exibe tarefas ativas para este filho no grid
  const tarefasFiltradas = getActiveTasks(filho);

  // Monta linhas
  const rows = [];
  for (let d = 1; d <= totalDias; d++) {
    const dS  = String(d);
    const reg = regMes[dS] || {};
    let ded   = 0;
    state.tarefas.forEach(t => {
      if (reg[String(t.id)] === false) ded += t.deducao;
    });
    rows.push({ d, dS, reg, ded, isToday: d === today() });
  }

  main.innerHTML = `
    <div class="detail-view">
      <div class="detail-header">
        <button class="back-btn" onclick="goBack()">← Voltar</button>
        <div class="detail-title">
          <span class="detail-avatar">${avatar(state.filhos.indexOf(filho))}</span>
          <div>
            <h2>${escapeHtml(filho)}</h2>
            <span>${fmtMonth(mes)}</span>
          </div>
        </div>
        <div class="detail-balance" style="color:${cor}">${fmt(saldo)}</div>
      </div>

      <div class="monthly-grid-container">
        <div class="monthly-grid">

          <!-- Cabeçalho -->
          <div class="grid-header-row">
            <div class="grid-day-cell header">Dia</div>
            ${tarefasFiltradas.map(t => `
              <div class="grid-task-cell header" title="${escapeHtml(t.nome)}">
                ${t.icone}
                <span class="task-short">${escapeHtml(t.nome.split(' ')[0])}</span>
              </div>`).join('')}
            <div class="grid-deduc-cell header">💸</div>
          </div>

          <!-- Linhas -->
          ${rows.map(r => {
            let ded = 0;
            tarefasFiltradas.forEach(t => {
              if (r.reg[String(t.id)] === false) ded += t.deducao;
            });
            r.ded = ded;
            return `
            <div class="grid-row${r.isToday?' is-today':''}${!Object.keys(r.reg).length&&!r.isToday?' empty-row':''}">
              <div class="grid-day-cell">
                <span class="day-number">${r.d}</span>
                <span class="day-name">${weekDay(mes,r.d)}</span>
              </div>
              ${tarefasFiltradas.map(t => {
                const st = Object.prototype.hasOwnProperty.call(r.reg, String(t.id))
                             ? r.reg[String(t.id)] : undefined;
                return `<div class="grid-task-cell ${st===true?'done':st===false?'missed':'pending'}">
                          ${st===true?'🟢':st===false?'🔴':'⬜'}
                        </div>`;
              }).join('')}
              <div class="grid-deduc-cell${ded>0?' has-deduc':''}">
                ${ded>0 ? `-${fmt(ded)}` : '—'}
              </div>
            </div>`;}).join('')}
        </div>
      </div>

      <div class="detail-summary">
        <div class="summary-card">
          <span>💰 Máximo mensal</span>
          <strong>${fmt(state.valorMaximoMensal)}</strong>
        </div>
        <div class="summary-card s-danger">
          <span>📉 Total de deduções</span>
          <strong>-${fmt(deducaoTotal)}</strong>
        </div>
        <div class="summary-card" style="border-color:${cor}50">
          <span>🏆 Saldo atual</span>
          <strong style="color:${cor}">${fmt(saldo)}</strong>
        </div>
      </div>
      </div>`;

  // Scroll automático para o dia de hoje no grid
  setTimeout(() => {
    const todayRow = document.querySelector('.grid-row.is-today');
    if (todayRow) {
      todayRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, 100);
}

function goBack() {
  currentView = 'dashboard';
  detailChild = null;
  renderDashboard();
}

/* ── Modal admin ────────────────────────────────────────────── */
function openAdminModal() {
  pinValue = '';
  updatePinDots();
  document.getElementById('pin-screen').style.display = 'flex';
  document.getElementById('admin-tabs').style.display = 'none';
  document.getElementById('admin-modal').classList.add('open');
}

function closeAdminModal() {
  document.getElementById('admin-modal').classList.remove('open');
  currentPin = '';
  pinValue   = '';
}

function handleModalOverlayClick(e) {
  if (e.target === document.getElementById('admin-modal')) closeAdminModal();
}

/* ── Teclado PIN ────────────────────────────────────────────── */
function buildPinKeypad() {
  const keys = ['1','2','3','4','5','6','7','8','9','','0','⌫'];
  document.getElementById('pin-keypad').innerHTML = keys.map(k => {
    if (k === '')  return `<button class="key-btn empty" disabled aria-hidden="true"></button>`;
    if (k === '⌫') return `<button class="key-btn del-btn" onclick="pinDel()" aria-label="Apagar">⌫</button>`;
    return `<button class="key-btn" onclick="pinPress('${k}')" aria-label="${k}">${k}</button>`;
  }).join('');
}

function pinPress(d) {
  if (pinValue.length >= 4) return;
  pinValue += d;
  updatePinDots();
  if (pinValue.length === 4) setTimeout(submitPin, 180);
}

function pinDel() {
  pinValue = pinValue.slice(0,-1);
  updatePinDots();
}

function updatePinDots() {
  for (let i=0; i<4; i++) {
    document.getElementById(`dot-${i}`)
      ?.classList.toggle('filled', i < pinValue.length);
  }
}

async function submitPin() {
  if (pinValue.length !== 4) return;

  try {
    const { status } = await apiPost('/api/admin/config', {}, pinValue);
    if (status === 401) {
      showToast('PIN incorreto!','error');
      pinValue = '';
      updatePinDots();
      document.getElementById('pin-dots').classList.add('shake');
      setTimeout(()=>document.getElementById('pin-dots').classList.remove('shake'),450);
      return;
    }
    currentPin = pinValue;
    document.getElementById('pin-screen').style.display  = 'none';
    document.getElementById('admin-tabs').style.display  = 'flex';
    switchTab('registrar');
  } catch(e) {
    showToast('Erro ao validar PIN','error');
    pinValue = '';
    updatePinDots();
  }
}

/* ── Abas ───────────────────────────────────────────────────── */
function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(b => {
    b.classList.toggle('active', b.id === `tab-${tab}`);
    b.setAttribute('aria-selected', b.id === `tab-${tab}`);
  });
  document.querySelectorAll('.tab-panel').forEach(p => {
    p.classList.toggle('active', p.id === `panel-${tab}`);
  });
  const renders = {
    registrar: renderAdminRegister,
    filhos   : renderAdminFilhos,
    tarefas  : renderAdminTarefas,
    config   : renderAdminConfig
  };
  renders[tab]?.();
}

/* ── Aba Registrar ──────────────────────────────────────────── */
function renderAdminRegister() {
  const panel = document.getElementById('panel-registrar');
  const dia   = today();
  const firstFilho = state.filhos[0];

  if (!firstFilho) {
    panel.innerHTML = '<div class="admin-form"><p style="color:var(--text-3);font-size:.85rem">Nenhum filho cadastrado.</p></div>';
    return;
  }

  panel.innerHTML = `
    <div class="admin-form">
      <div class="form-group">
        <label>👶 Filho</label>
        <select id="reg-filho">
          ${state.filhos.map(f=>`<option value="${escapeHtml(f)}">${escapeHtml(f)}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label>📅 Dia do mês</label>
        <select id="reg-dia">
          ${Array.from({length:daysInMonth(state.mesAtual)},(_,i)=>i+1).map(d=>`
            <option value="${d}" ${d===dia?'selected':''}>${d} (${weekDay(state.mesAtual,d)})</option>
          `).join('')}
        </select>
      </div>
      <div class="form-group">
        <label>✅ Tarefas — clique para marcar o status</label>
        <div class="task-checklist" id="task-checklist">
          ${getActiveTasks(firstFilho).map(t=>`
            <div class="task-check-item">
              <span class="task-check-icon">${t.icone}</span>
              <span class="task-check-name">${escapeHtml(t.nome)}</span>
              <div class="status-toggle">
                <button class="status-btn" id="sbtn-done-${t.id}"
                        onclick="setStatus(${t.id},true)"  title="Cumpriu">🟢</button>
                <button class="status-btn" id="sbtn-miss-${t.id}"
                        onclick="setStatus(${t.id},false)" title="Não cumpriu">🔴</button>
                <button class="status-btn" id="sbtn-clr-${t.id}"
                        onclick="setStatus(${t.id},null)"  title="Sem registro">⬜</button>
              </div>
            </div>`).join('')}
        </div>
      </div>
      <button class="btn-primary" id="btn-save-reg" onclick="saveRegister()">
        💾 Salvar Registros
      </button>
    </div>`;

  // Carrega status existentes
  loadStatusForSelection();

  document.getElementById('reg-filho').addEventListener('change', loadStatusForSelection);
  document.getElementById('reg-dia'  ).addEventListener('change', loadStatusForSelection);
}

function loadStatusForSelection() {
  const filho = document.getElementById('reg-filho')?.value;
  const dia   = document.getElementById('reg-dia')?.value;
  if (!filho || !dia) return;

  const reg = state.registros?.[state.mesAtual]?.[filho]?.[dia] || {};
  pendingStatuses = {};

  // Carrega apenas as tarefas ativas para este filho
  getActiveTasks(filho).forEach(t => {
    const id = String(t.id);
    pendingStatuses[t.id] = Object.prototype.hasOwnProperty.call(reg, id)
                              ? reg[id] : null;
  });

  // Rebuildlist of task check items when filho changes
  rebuildTaskChecklist(filho);
  refreshStatusButtons();
}

function rebuildTaskChecklist(filho) {
  const checklist = document.getElementById('task-checklist');
  if (!checklist) return;
  checklist.innerHTML = getActiveTasks(filho).map(t => `
    <div class="task-check-item">
      <span class="task-check-icon">${t.icone}</span>
      <span class="task-check-name">${escapeHtml(t.nome)}</span>
      <div class="status-toggle">
        <button class="status-btn" id="sbtn-done-${t.id}"
                onclick="setStatus(${t.id},true)"  title="Cumpriu">🟢</button>
        <button class="status-btn" id="sbtn-miss-${t.id}"
                onclick="setStatus(${t.id},false)" title="Não cumpriu">🔴</button>
        <button class="status-btn" id="sbtn-clr-${t.id}"
                onclick="setStatus(${t.id},null)"  title="Sem registro">⬜</button>
      </div>
    </div>`).join('');
}

function setStatus(tarefaId, val) {
  pendingStatuses[tarefaId] = val;
  refreshStatusButtons();
}

function refreshStatusButtons() {
  state.tarefas.forEach(t => {
    const v = pendingStatuses[t.id];
    document.getElementById(`sbtn-done-${t.id}`)?.classList.toggle('active', v===true);
    document.getElementById(`sbtn-miss-${t.id}`)?.classList.toggle('active', v===false);
    document.getElementById(`sbtn-clr-${t.id}`) ?.classList.toggle('active', v===null);
  });
}

let saveDebounce = false;
async function saveRegister() {
  if (saveDebounce) return; // Previne duplo clique
  saveDebounce = true;

  const filho = document.getElementById('reg-filho').value;
  const dia   = parseInt(document.getElementById('reg-dia').value);
  const btn   = document.getElementById('btn-save-reg');

  btn.disabled    = true;
  btn.textContent = '⏳ Salvando...';

  let saved = 0;
  try {
    for (const [id, val] of Object.entries(pendingStatuses)) {
      await apiPost('/api/registrar',
        { filho, dia, tarefaId:parseInt(id), cumprida:val },
        currentPin
      );
      saved++;
    }
    showToast(`${saved} tarefa(s) salva(s)!`, 'success');
    await refresh();
  } catch(e) {
    showToast(e.message, 'error');
  } finally {
    btn.disabled    = false;
    btn.textContent = '💾 Salvar Registros';
    setTimeout(() => { saveDebounce = false; }, 800);
  }
}

/* ── Aba Filhos ─────────────────────────────────────────────── */
function renderAdminFilhos() {
  document.getElementById('panel-filhos').innerHTML = `
    <div class="admin-form">
      <div class="current-list">
        ${state.filhos.length
          ? state.filhos.map(f => `
              <div class="list-item">
                <span>${escapeHtml(f)}</span>
                <button class="btn-danger-sm"
                        onclick="removeFilho('${escapeHtml(f)}')">🗑️ Remover</button>
              </div>`).join('')
          : '<p style="color:var(--text-3);font-size:.85rem">Nenhum filho cadastrado.</p>'}
      </div>
      <div class="form-group">
        <label>➕ Adicionar filho</label>
        <div class="input-row">
          <input id="inp-novo-filho" type="text" placeholder="Nome do filho" maxlength="30"
                 onkeydown="if(event.key==='Enter') addFilho()">
          <button class="btn-primary-sm" onclick="addFilho()">Adicionar</button>
        </div>
      </div>
    </div>`;
}

async function addFilho() {
  const nome = document.getElementById('inp-novo-filho').value.trim();
  if (!nome) return showToast('Digite um nome','error');
  try {
    await apiPost('/api/admin/filho',{acao:'adicionar',nome},currentPin);
    showToast(`${nome} adicionado!`,'success');
    await refresh();
    renderAdminFilhos();
  } catch(e) { showToast(e.message,'error'); }
}

async function removeFilho(nome) {
  if (!confirm(`Remover "${nome}"?\n\nOs registros já gravados serão mantidos no histórico.`)) return;
  try {
    await apiPost('/api/admin/filho',{acao:'remover',nome},currentPin);
    showToast(`${nome} removido`,'success');
    await refresh();
    renderAdminFilhos();
  } catch(e) { showToast(e.message,'error'); }
}

/* ── Aba Tarefas ────────────────────────────────────────────── */
function renderAdminTarefas() {
  document.getElementById('panel-tarefas').innerHTML = `
    <div class="admin-form">
      <div class="current-list">
        ${state.tarefas.length
          ? state.tarefas.map(t => {
              // Mostra quais filhos têm esta tarefa ativa
              const toggles = state.filhos.map(filho => {
                const ativo = (state.tarefasAtivas?.[filho] || []).includes(t.id);
                return `<button
                  class="child-task-toggle ${ativo?'on':'off'}"
                  onclick="toggleTarefaFilho('${escapeHtml(filho)}',${t.id},${!ativo})"
                  title="${ativo?'Remover de':'Adicionar a'} ${escapeHtml(filho)}">
                  ${avatar(state.filhos.indexOf(filho))} ${escapeHtml(filho)}
                  <span class="toggle-badge">${ativo?'✅':'❌'}</span>
                </button>`;
              }).join('');

              return `
              <div class="list-item tarefa-item">
                <div class="tarefa-main">
                  <span class="task-list-icon">${t.icone}</span>
                  <div class="task-list-info">
                    <strong>${escapeHtml(t.nome)}</strong>
                    <small>Dedução: -${fmt(t.deducao)}</small>
                  </div>
                  <button class="btn-primary-sm" onclick="editTarefa(${t.id})" style="background:var(--bg-card); color:var(--text-1); border:1px solid var(--border)">✏️</button>
                  <button class="btn-danger-sm" onclick="removeTarefa(${t.id})">🗑️</button>
                </div>
                ${state.filhos.length ? `
                <div class="tarefa-filhos-row">
                  <span class="tarefa-filhos-label">Atribuir a:</span>
                  ${toggles}
                </div>` : ''}
              </div>`;
            }).join('')
          : '<p style="color:var(--text-3);font-size:.85rem">Nenhuma tarefa cadastrada.</p>'}
      </div>
      <div class="form-group">
        <label>➕ Nova / Editar tarefa</label>
        <div class="task-form-grid">
          <input id="inp-tar-nome"   type="text"   placeholder="Nome da tarefa" maxlength="50">
          <input id="inp-tar-icone"  type="text"   placeholder="Emoji 📋" maxlength="5">
          <input id="inp-tar-ded"    type="number" placeholder="R$ dedução" step="0.50" min="0">
          
          <!-- Quadro de sugestão de emojis -->
          <div style="grid-column: 1 / -1; display: flex; gap: 10px; font-size: 1.3rem; flex-wrap: wrap; margin: 4px 0 8px;">
            ${['📋','🛏️','🦷','📚','🧹','🐶','🍽️','🧸','🚿','🚮','⏰','🎮','⚽'].map(e => 
              `<span style="cursor:pointer; transition:transform 0.2s;" onclick="document.getElementById('inp-tar-icone').value='${e}'" onmouseover="this.style.transform='scale(1.2)'" onmouseout="this.style.transform='scale(1)'">${e}</span>`
            ).join('')}
            <small style="color:var(--text-3); font-size:0.75rem; margin-left:auto; align-self:center;">Dica: Tecle <b>Win + .</b></small>
          </div>

          <div style="grid-column: 1 / -1; display: flex; gap: 10px;">
            <button id="btn-add-tarefa" class="btn-primary" onclick="addTarefa()">➕ Adicionar Tarefa</button>
            <button id="btn-cancel-edit" class="btn-primary" onclick="cancelEditTarefa()" style="display:none; background:var(--bg-card); color:var(--text-1); border:1px solid var(--border)">❌ Cancelar</button>
          </div>
        </div>
      </div>
    </div>`;
}

let editingTarefaId = null;

function editTarefa(id) {
  const t = state.tarefas.find(x => x.id === id);
  if (!t) return;
  document.getElementById('inp-tar-nome').value = t.nome;
  document.getElementById('inp-tar-icone').value = t.icone;
  document.getElementById('inp-tar-ded').value = t.deducao;
  
  editingTarefaId = id;
  const btn = document.getElementById('btn-add-tarefa');
  btn.textContent = '💾 Salvar Alterações';
  document.getElementById('btn-cancel-edit').style.display = 'block';
  
  // Rola a tela até o formulário para o usuário ver no celular
  document.getElementById('inp-tar-nome').focus();
  document.getElementById('inp-tar-nome').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function cancelEditTarefa() {
  editingTarefaId = null;
  document.getElementById('inp-tar-nome').value = '';
  document.getElementById('inp-tar-icone').value = '';
  document.getElementById('inp-tar-ded').value = '';
  const btn = document.getElementById('btn-add-tarefa');
  btn.textContent = '➕ Adicionar Tarefa';
  document.getElementById('btn-cancel-edit').style.display = 'none';
}

async function addTarefa() {
  const nome    = document.getElementById('inp-tar-nome').value.trim();
  const icone   = document.getElementById('inp-tar-icone').value.trim() || '📋';
  const deducao = parseFloat(document.getElementById('inp-tar-ded').value);
  if (!nome || isNaN(deducao) || deducao < 0) return showToast('Preencha nome e dedução','error');
  try {
    const btn = document.getElementById('btn-add-tarefa');
    btn.disabled = true;
    
    if (editingTarefaId) {
      await apiPost('/api/admin/tarefa',{acao:'editar',tarefa:{id:editingTarefaId,nome,icone,deducao}},currentPin);
      showToast('Tarefa atualizada!','success');
    } else {
      await apiPost('/api/admin/tarefa',{acao:'adicionar',tarefa:{nome,icone,deducao}},currentPin);
      showToast('Tarefa adicionada a todos os filhos!','success');
    }
    
    editingTarefaId = null;
    await refresh();
    renderAdminTarefas();
  } catch(e) { 
    showToast(e.message,'error'); 
    document.getElementById('btn-add-tarefa').disabled = false;
  }
}

async function toggleTarefaFilho(filho, tarefaId, ativo) {
  try {
    const res = await apiPost('/api/admin/tarefa-filho',{filho,tarefaId,ativo},currentPin);
    state.tarefasAtivas = res.data.tarefasAtivas;
    showToast(
      ativo ? `Tarefa adicionada a ${filho}` : `Tarefa removida de ${filho}`,
      'success'
    );
    renderAdminTarefas();
    // Atualiza dashboard em background
    refresh();
  } catch(e) { showToast(e.message,'error'); }
}

async function removeTarefa(id) {
  if (!confirm('Remover esta tarefa?')) return;
  try {
    await apiPost('/api/admin/tarefa',{acao:'remover',tarefa:{id}},currentPin);
    showToast('Tarefa removida','success');
    await refresh();
    renderAdminTarefas();
  } catch(e) { showToast(e.message,'error'); }
}

/* ── Aba Config ─────────────────────────────────────────────── */
function renderAdminConfig() {
  document.getElementById('panel-config').innerHTML = `
    <div class="admin-form">
      <div class="form-group">
        <label>💰 Valor máximo mensal (R$)</label>
        <input id="cfg-valor" type="number" value="${state.valorMaximoMensal}"
               step="5" min="1" placeholder="Ex: 50">
      </div>
      <div class="form-group">
        <label>🔐 Novo PIN (deixe em branco para manter o atual)</label>
        <input id="cfg-pin" type="password" placeholder="4 dígitos" maxlength="4"
               inputmode="numeric">
        <small style="color:var(--text-3);font-size:.75rem">
          ⚠️ O PIN é salvo no arquivo .env do servidor e não é commitado no Git.
        </small>
      </div>
      <button class="btn-primary" onclick="saveConfig()">💾 Salvar Configurações</button>
    </div>`;
}

async function saveConfig() {
  const valor  = parseFloat(document.getElementById('cfg-valor').value);
  const novoPin= document.getElementById('cfg-pin').value.trim();
  const body   = {};

  if (!isNaN(valor) && valor > 0) body.valorMaximoMensal = valor;
  if (novoPin) {
    if (!/^\d{4}$/.test(novoPin)) return showToast('PIN deve ter exatamente 4 dígitos','error');
    body.novoPin = novoPin;
  }

  try {
    await apiPost('/api/admin/config', body, currentPin);
    if (novoPin) currentPin = novoPin;
    showToast('Configurações salvas!','success');
    await refresh();
  } catch(e) { showToast(e.message,'error'); }
}

/* ── Toast ──────────────────────────────────────────────────── */
let toastTimer = null;
function showToast(msg, type='info') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className   = `toast ${type} show`;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(()=> el.classList.remove('show'), 3200);
}

/* ── Segurança XSS ──────────────────────────────────────────── */
function escapeHtml(s) {
  return String(s)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

/* ── Teclado físico no PIN ──────────────────────────────────── */
document.addEventListener('keydown', e => {
  const modal = document.getElementById('admin-modal');
  if (!modal.classList.contains('open')) return;

  const pinVisible = document.getElementById('pin-screen').style.display !== 'none';
  if (!pinVisible) return;

  if (/^\d$/.test(e.key)) { pinPress(e.key); }
  else if (e.key === 'Backspace') { pinDel(); }
  else if (e.key === 'Escape')    { closeAdminModal(); }
});

/* ── Inicialização ──────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', async () => {
  buildPinKeypad();

  try {
    state = await fetchState();
    updateHeader();
    renderDashboard();
    startAutoRefresh();
  } catch(e) {
    document.getElementById('main-content').innerHTML = `
      <div class="error-state">
        <h2>⚠️ Erro ao conectar</h2>
        <p>${e.message}</p>
        <button onclick="location.reload()">Tentar novamente</button>
      </div>`;
  }
});
