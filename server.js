/**
 * Quadro de Recompensas Mensal — Servidor Express
 * Armazenamento híbrido: Firebase Firestore (nuvem) com fallback para dados.json (local)
 * PIN armazenado em .env / Firestore
 * mDNS embutido via multicast-dns (quadro.local resolvível em redes locais)
 * Backup anual automático quando registros > 12 meses
 */
require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const fs      = require('fs');
const path    = require('path');
const os      = require('os');
const crypto  = require('crypto');

const app        = express();
const PORT       = process.env.PORT || 3000;
const DADOS_PATH = path.join(__dirname, 'dados.json');
const BACKUP_DIR = path.join(__dirname, 'backups');

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Firebase Firestore ────────────────────────────────────────────────────────
let db              = null;
let firestoreDocRef = null;

async function initFirebase() {
  try {
    let serviceAccount = null;

    // 1. Variável de ambiente FIREBASE_SERVICE_ACCOUNT (JSON string ou caminho para arquivo)
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      const raw = process.env.FIREBASE_SERVICE_ACCOUNT.trim();
      if (raw.startsWith('{')) {
        serviceAccount = JSON.parse(raw);
      } else if (fs.existsSync(raw)) {
        serviceAccount = JSON.parse(fs.readFileSync(raw, 'utf8'));
      }
    } else {
      // 2. Arquivo local padrão firebase-key.json
      const localKeyPath = path.join(__dirname, 'firebase-key.json');
      if (fs.existsSync(localKeyPath)) {
        serviceAccount = JSON.parse(fs.readFileSync(localKeyPath, 'utf8'));
      }
    }

    if (serviceAccount) {
      let admin;
      try {
        admin = require('firebase-admin');
      } catch {
        console.warn('⚠️  Pacote firebase-admin não instalado. Usando armazenamento local.');
        return false;
      }

      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });

      db = admin.firestore();
      firestoreDocRef = db.collection('quadro').doc('principal');
      console.log('🔥 Firebase Firestore conectado com sucesso!');

      // Sincroniza PIN salvo no Firestore se existir
      try {
        const cfgSnap = await db.collection('quadro').doc('config').get();
        if (cfgSnap.exists && cfgSnap.data().pin) {
          process.env.PIN = cfgSnap.data().pin;
        }
      } catch {}

      return true;
    }
  } catch (err) {
    console.error('⚠️  Falha ao conectar ao Firebase Firestore:', err.message);
  }

  console.log('📁 Operando com armazenamento local (dados.json)');
  return false;
}

// ── Helpers de dados ─────────────────────────────────────────────────────────

/**
 * Lê os dados do Firestore (se ativo) ou de dados.json com fallback seguro.
 */
async function loadData() {
  if (firestoreDocRef) {
    try {
      const snap = await firestoreDocRef.get();
      if (snap.exists) {
        return snap.data();
      } else {
        console.log('📝 Criando documento inicial no Firestore...');
        let initialData;
        if (fs.existsSync(DADOS_PATH)) {
          try { initialData = JSON.parse(fs.readFileSync(DADOS_PATH, 'utf8')); } catch {}
        }
        if (!initialData) {
          initialData = { valorMaximoMensal: 50, filhos: [], tarefas: [], registros: {}, tarefasAtivas: {} };
        }
        await firestoreDocRef.set(initialData);
        return initialData;
      }
    } catch (err) {
      console.error('⚠️  Erro ao ler do Firestore (tentando fallback local):', err.message);
    }
  }

  // Fallback para arquivo local
  try {
    const raw = fs.readFileSync(DADOS_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('⚠️  Erro ao ler dados.json:', err.message);

    // Tenta restaurar do backup automático
    const bakPath = DADOS_PATH + '.bak';
    if (fs.existsSync(bakPath)) {
      try {
        console.log('🔄 Restaurando do backup (.bak)...');
        const bakRaw = fs.readFileSync(bakPath, 'utf8');
        const data = JSON.parse(bakRaw);
        fs.writeFileSync(DADOS_PATH, bakRaw, 'utf8');
        console.log('✅ Restauração concluída.');
        return data;
      } catch {
        console.error('❌ Backup também corrompido.');
      }
    }

    // Retorna estrutura mínima para não quebrar o servidor
    console.log('📝 Criando dados.json vazio...');
    const empty = { valorMaximoMensal: 50, filhos: [], tarefas: [], registros: {}, tarefasAtivas: {} };
    saveDataLocal(empty);
    return empty;
  }
}

/** Escrita atômica em arquivo local */
function saveDataLocal(data) {
  try {
    const tmpPath = DADOS_PATH + '.tmp';
    const bakPath = DADOS_PATH + '.bak';
    const content = JSON.stringify(data, null, 2);

    fs.writeFileSync(tmpPath, content, 'utf8');

    if (fs.existsSync(DADOS_PATH)) {
      try { fs.copyFileSync(DADOS_PATH, bakPath); } catch {}
    }

    fs.renameSync(tmpPath, DADOS_PATH);
  } catch (err) {
    // Em ambientes efêmeros como Render, pode não ter permissão ou ser efêmero
    console.error('⚠️  Erro ao salvar dados no disco local:', err.message);
  }
}

/** Salva dados no Firestore e mantém cópia local */
async function saveData(data) {
  if (firestoreDocRef) {
    try {
      await firestoreDocRef.set(data);
      return;
    } catch (err) {
      console.error('⚠️  Erro ao salvar no Firestore:', err.message);
    }
  }
  saveDataLocal(data);
}

function currentMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/** Garante que o mês atual e todos os filhos existem em registros */
function ensureMonth(data, monthKey) {
  if (!data.registros) data.registros = {};
  if (!data.registros[monthKey]) data.registros[monthKey] = {};
  data.filhos.forEach(filho => {
    if (!data.registros[monthKey][filho]) {
      data.registros[monthKey][filho] = {};
    }
  });
  return data;
}

/**
 * Garante que tarefasAtivas existe e está sincronizado:
 * - Novos filhos recebem TODAS as tarefas por padrão
 * - Tarefas removidas globalmente são limpas
 * - Filhos removidos são limpos
 * - Filhos existentes mantêm sua configuração individual
 */
function ensureTarefasAtivas(data) {
  if (!data.tarefasAtivas) data.tarefasAtivas = {};
  const allIds = data.tarefas.map(t => t.id);

  data.filhos.forEach(filho => {
    if (!Array.isArray(data.tarefasAtivas[filho])) {
      data.tarefasAtivas[filho] = [...allIds];
    } else {
      data.tarefasAtivas[filho] = data.tarefasAtivas[filho].filter(id => allIds.includes(id));
    }
  });

  Object.keys(data.tarefasAtivas).forEach(filho => {
    if (!data.filhos.includes(filho)) delete data.tarefasAtivas[filho];
  });

  return data;
}

// ── Backup anual ──────────────────────────────────────────────────────────────
/**
 * Mantém registros de até 12 meses. Registros mais antigos são arquivados
 * em backups/ ou no Firestore e removidos do documento ativo.
 */
async function checkAnnualBackup(data) {
  const registros = data.registros || {};
  const keys      = Object.keys(registros).sort();
  if (keys.length === 0) return data;

  const now       = new Date();
  const cutoff    = new Date(now.getFullYear(), now.getMonth() - 11, 1);
  const cutoffKey = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, '0')}`;

  const oldKeys = keys.filter(k => k < cutoffKey);
  if (oldKeys.length === 0) return data;

  const backupPayload = {
    geradoEm : new Date().toISOString(),
    filhos   : data.filhos,
    tarefas  : data.tarefas,
    registros: {}
  };

  oldKeys.forEach(k => {
    backupPayload.registros[k] = registros[k];
    delete data.registros[k];
  });

  if (firestoreDocRef) {
    try {
      await db.collection('quadro_backups').doc(`backup-${cutoffKey}`).set(backupPayload);
      console.log(`\n📦 Backup anual arquivado no Firestore: backup-${cutoffKey}`);
      await saveData(data);
      return data;
    } catch (err) {
      console.error('⚠️  Erro ao arquivar backup no Firestore:', err.message);
    }
  }

  if (!fs.existsSync(BACKUP_DIR)) {
    try { fs.mkdirSync(BACKUP_DIR, { recursive: true }); } catch {}
  }
  const stamp      = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const backupFile = path.join(BACKUP_DIR, `backup-${stamp}.json`);
  try {
    fs.writeFileSync(backupFile, JSON.stringify(backupPayload, null, 2));
    console.log(`\n📦 Backup automático gerado localmente: ${path.basename(backupFile)}`);
  } catch {}

  await saveData(data);
  return data;
}

// ── Cálculo de saldo ──────────────────────────────────────────────────────────
function calcularSaldo(data, filho, monthKey) {
  const max       = data.valorMaximoMensal;
  const regMes    = data.registros?.[monthKey]?.[filho] || {};
  const ativasIds = (data.tarefasAtivas?.[filho] || data.tarefas.map(t => t.id))
                      .map(id => String(id));
  let   deducoes = 0;

  Object.values(regMes).forEach(tarefasDia => {
    Object.entries(tarefasDia).forEach(([tarefaId, cumprida]) => {
      if (cumprida === false && ativasIds.includes(tarefaId)) {
        const t = data.tarefas.find(t => t.id === parseInt(tarefaId));
        if (t) deducoes += t.deducao;
      }
    });
  });

  return Math.max(0, parseFloat((max - deducoes).toFixed(2)));
}

// ── Middleware PIN ────────────────────────────────────────────────────────────
function validatePin(req, res, next) {
  const pin        = req.headers['x-pin'] || '';
  const correctPin = process.env.PIN || '1234';

  const pinBuf     = Buffer.from(pin.padEnd(4, '\0'));
  const correctBuf = Buffer.from(correctPin.padEnd(4, '\0'));

  if (pin.length !== 4 || !crypto.timingSafeEqual(pinBuf, correctBuf)) {
    return res.status(401).json({ erro: 'PIN inválido' });
  }
  next();
}

// ── Rotas GET ─────────────────────────────────────────────────────────────────

/** Health check — verifica se o servidor está online */
app.get('/api/ping', (_req, res) => {
  res.json({
    status   : 'online',
    timestamp: Date.now(),
    storage  : firestoreDocRef ? 'firestore' : 'local'
  });
});

app.get('/api/estado', async (req, res) => {
  try {
    let data = await loadData();
    data     = await checkAnnualBackup(data);
    const monthKey = currentMonthKey();
    data     = ensureMonth(data, monthKey);
    data     = ensureTarefasAtivas(data);
    await saveData(data);

    const saldos = {};
    data.filhos.forEach(filho => {
      saldos[filho] = calcularSaldo(data, filho, monthKey);
    });

    res.json({
      mesAtual          : monthKey,
      valorMaximoMensal : data.valorMaximoMensal,
      filhos            : data.filhos,
      tarefas           : data.tarefas,
      tarefasAtivas     : data.tarefasAtivas,
      registros         : data.registros,
      saldos,
      mesesHistorico    : Object.keys(data.registros)
                            .filter(k => k !== monthKey)
                            .sort()
                            .reverse()
    });
  } catch (err) {
    console.error('Erro em /api/estado:', err);
    res.status(500).json({ erro: 'Erro interno ao obter estado' });
  }
});

// ── Rotas POST (todas requerem PIN) ──────────────────────────────────────────

/** Registra ou limpa o status de uma tarefa para um filho num dia */
app.post('/api/registrar', validatePin, async (req, res) => {
  try {
    const { filho, dia, tarefaId, cumprida } = req.body;

    if (!filho || !dia || tarefaId === undefined || cumprida === undefined) {
      return res.status(400).json({ erro: 'Dados incompletos' });
    }

    let data = await loadData();
    const monthKey = currentMonthKey();
    data = ensureMonth(data, monthKey);

    if (!data.filhos.includes(filho)) {
      return res.status(400).json({ erro: 'Filho não encontrado' });
    }
    if (!data.tarefas.find(t => t.id === tarefaId)) {
      return res.status(400).json({ erro: 'Tarefa não encontrada' });
    }

    const diaStr = String(dia);
    if (!data.registros[monthKey][filho][diaStr]) {
      data.registros[monthKey][filho][diaStr] = {};
    }

    if (cumprida === null) {
      delete data.registros[monthKey][filho][diaStr][String(tarefaId)];
      if (Object.keys(data.registros[monthKey][filho][diaStr]).length === 0) {
        delete data.registros[monthKey][filho][diaStr];
      }
    } else {
      data.registros[monthKey][filho][diaStr][String(tarefaId)] = cumprida;
    }

    await saveData(data);

    const saldo = calcularSaldo(data, filho, monthKey);
    res.json({ sucesso: true, saldo, registros: data.registros[monthKey][filho] });
  } catch (err) {
    console.error('Erro em /api/registrar:', err);
    res.status(500).json({ erro: 'Erro ao registrar tarefa' });
  }
});

/** Adiciona ou remove um filho */
app.post('/api/admin/filho', validatePin, async (req, res) => {
  try {
    const { acao, nome } = req.body;
    let data = await loadData();

    if (acao === 'adicionar') {
      const n = (nome || '').trim();
      if (!n)                      return res.status(400).json({ erro: 'Nome inválido' });
      if (data.filhos.includes(n)) return res.status(400).json({ erro: 'Filho já existe' });
      data.filhos.push(n);
      data = ensureMonth(data, currentMonthKey());
      data = ensureTarefasAtivas(data);
    } else if (acao === 'remover') {
      data.filhos = data.filhos.filter(f => f !== nome);
      data = ensureTarefasAtivas(data);
    } else {
      return res.status(400).json({ erro: 'Ação inválida. Use: adicionar | remover' });
    }

    await saveData(data);
    res.json({ sucesso: true, filhos: data.filhos });
  } catch (err) {
    console.error('Erro em /api/admin/filho:', err);
    res.status(500).json({ erro: 'Erro ao processar filho' });
  }
});

/** Adiciona, edita ou remove uma tarefa */
app.post('/api/admin/tarefa', validatePin, async (req, res) => {
  try {
    const { acao, tarefa } = req.body;
    let data = await loadData();

    if (acao === 'adicionar') {
      const novoId = data.tarefas.length > 0
        ? Math.max(...data.tarefas.map(t => t.id)) + 1
        : 1;
      data.tarefas.push({
        id     : novoId,
        nome   : tarefa.nome,
        icone  : tarefa.icone  || '📋',
        deducao: parseFloat(tarefa.deducao) || 1.00
      });
      data = ensureTarefasAtivas(data);
    } else if (acao === 'editar') {
      const idx = data.tarefas.findIndex(t => t.id === tarefa.id);
      if (idx === -1) return res.status(404).json({ erro: 'Tarefa não encontrada' });
      data.tarefas[idx] = { ...data.tarefas[idx], ...tarefa };
    } else if (acao === 'remover') {
      data.tarefas = data.tarefas.filter(t => t.id !== tarefa.id);
      data = ensureTarefasAtivas(data);
    } else {
      return res.status(400).json({ erro: 'Ação inválida. Use: adicionar | editar | remover' });
    }

    await saveData(data);
    res.json({ sucesso: true, tarefas: data.tarefas, tarefasAtivas: data.tarefasAtivas });
  } catch (err) {
    console.error('Erro em /api/admin/tarefa:', err);
    res.status(500).json({ erro: 'Erro ao processar tarefa' });
  }
});

/** Ativa ou desativa uma tarefa para um filho específico */
app.post('/api/admin/tarefa-filho', validatePin, async (req, res) => {
  try {
    const { filho, tarefaId, ativo } = req.body;
    let data = await loadData();
    data = ensureTarefasAtivas(data);

    if (!data.filhos.includes(filho)) {
      return res.status(400).json({ erro: 'Filho não encontrado' });
    }
    if (!data.tarefas.find(t => t.id === tarefaId)) {
      return res.status(400).json({ erro: 'Tarefa não encontrada' });
    }

    if (ativo) {
      if (!data.tarefasAtivas[filho].includes(tarefaId)) {
        data.tarefasAtivas[filho].push(tarefaId);
      }
    } else {
      data.tarefasAtivas[filho] = data.tarefasAtivas[filho].filter(id => id !== tarefaId);
    }

    await saveData(data);
    res.json({ sucesso: true, tarefasAtivas: data.tarefasAtivas });
  } catch (err) {
    console.error('Erro em /api/admin/tarefa-filho:', err);
    res.status(500).json({ erro: 'Erro ao atualizar tarefa do filho' });
  }
});

/** Altera o valor máximo mensal e/ou o PIN */
app.post('/api/admin/config', validatePin, async (req, res) => {
  try {
    const { valorMaximoMensal, novoPin } = req.body;
    let data = await loadData();

    if (valorMaximoMensal !== undefined && !isNaN(valorMaximoMensal) && valorMaximoMensal > 0) {
      data.valorMaximoMensal = parseFloat(valorMaximoMensal);
    }

    if (novoPin && /^\d{4}$/.test(novoPin)) {
      process.env.PIN = novoPin;

      if (db) {
        try {
          await db.collection('quadro').doc('config').set({ pin: novoPin }, { merge: true });
        } catch (e) {
          console.error('Erro ao salvar PIN no Firestore:', e.message);
        }
      }

      try {
        const envPath = path.join(__dirname, '.env');
        let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
        if (/^PIN=/m.test(envContent)) {
          envContent = envContent.replace(/^PIN=.*/m, `PIN=${novoPin}`);
        } else {
          envContent += `\nPIN=${novoPin}\n`;
        }
        fs.writeFileSync(envPath, envContent, 'utf8');
      } catch {}
    }

    await saveData(data);
    res.json({ sucesso: true });
  } catch (err) {
    console.error('Erro em /api/admin/config:', err);
    res.status(500).json({ erro: 'Erro ao atualizar configurações' });
  }
});

// ── Inicialização ─────────────────────────────────────────────────────────────
function getLocalIPs() {
  const interfaces = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) ips.push(iface.address);
    }
  }
  return ips;
}

// ── mDNS embutido — quadro.local (somente rede local) ───────────────────────
function startMDNS(localIP) {
  if (!localIP) return;

  try {
    const mdns = require('multicast-dns')();

    mdns.on('query', (query) => {
      const answers = [];
      for (const q of query.questions) {
        if (q.name === 'quadro.local' && q.type === 'A') {
          answers.push({
            name: 'quadro.local',
            type: 'A',
            ttl: 120,
            data: localIP
          });
        }
      }
      if (answers.length > 0) {
        mdns.respond(answers);
      }
    });

    mdns.respond([{
      name: 'quadro.local',
      type: 'A',
      ttl: 120,
      data: localIP
    }]);

    const announceTimer = setInterval(() => {
      mdns.respond([{
        name: 'quadro.local',
        type: 'A',
        ttl: 120,
        data: localIP
      }]);
    }, 60_000);

    console.log(`✅ mDNS ativo: quadro.local → ${localIP}`);
    console.log('   📱 Celular/TV: acesse http://quadro.local:' + PORT + '\n');

    const cleanup = () => {
      clearInterval(announceTimer);
      mdns.destroy();
    };
    process.on('exit', cleanup);
    process.on('SIGINT',  () => { cleanup(); process.exit(0); });
    process.on('SIGTERM', () => { cleanup(); process.exit(0); });

  } catch (err) {
    console.log('⚠️  mDNS não iniciado:', err.message);
  }
}

// ── Start do servidor ────────────────────────────────────────────────────────
async function startServer() {
  await initFirebase();

  app.listen(PORT, '0.0.0.0', () => {
    const isCloud = !!(process.env.RENDER || process.env.NODE_ENV === 'production');
    const ips = getLocalIPs();
    const line = '─'.repeat(52);
    console.log(`\n┌${line}┐`);
    console.log(`│  🏆  Quadro de Recompensas v1.2                          │`);
    console.log(`├${line}┤`);
    console.log(`│                                                          │`);

    if (!isCloud && ips.length > 0) {
      ips.forEach(ip => {
        const url = `http://${ip}:${PORT}`;
        console.log(`│  📺  ${url.padEnd(48)}│`);
      });
      console.log(`│  💻  http://localhost:${PORT}`.padEnd(55) + '│');
      console.log(`│  🌐  http://quadro.local:${PORT}`.padEnd(55) + '│');
      console.log(`│                                                          │`);
      console.log(`│  Ctrl+C para parar                                       │`);
      console.log(`└${line}┘\n`);

      startMDNS(ips[0]);
    } else {
      console.log(`│  ☁️   Hospedagem na Nuvem Ativa (Porta: ${String(PORT).padEnd(5)})         │`);
      console.log(`│  💾  Armazenamento: ${(firestoreDocRef ? 'Firebase Firestore' : 'Arquivo local').padEnd(34)}│`);
      console.log(`└${line}┘\n`);
    }
  });
}

startServer();
