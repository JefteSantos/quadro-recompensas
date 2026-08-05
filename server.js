/**
 * Quadro de Recompensas Mensal — Servidor Express
 * PIN armazenado em .env (nunca no dados.json)
 * mDNS embutido via multicast-dns (quadro.local resolvível em todos os dispositivos)
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

// ── Helpers de dados ─────────────────────────────────────────────────────────
/**
 * Lê dados.json com fallback seguro em caso de corrupção.
 * Se o arquivo estiver corrompido, tenta restaurar do backup (.bak).
 */
function loadData() {
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
    saveData(empty);
    return empty;
  }
}

/**
 * Escrita atômica: escreve em arquivo temporário e renomeia.
 * Evita corrupção se o PC desligar no meio da gravação.
 * Também mantém um backup (.bak) do estado anterior.
 */
function saveData(data) {
  const tmpPath = DADOS_PATH + '.tmp';
  const bakPath = DADOS_PATH + '.bak';
  const content = JSON.stringify(data, null, 2);

  // Escreve em arquivo temporário
  fs.writeFileSync(tmpPath, content, 'utf8');

  // Cria backup do estado atual antes de sobrescrever
  if (fs.existsSync(DADOS_PATH)) {
    try { fs.copyFileSync(DADOS_PATH, bakPath); } catch { /* silencioso */ }
  }

  // Renomeia o temporário para o definitivo (operação atômica no filesystem)
  fs.renameSync(tmpPath, DADOS_PATH);
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
      // Filho novo: recebe todas as tarefas
      data.tarefasAtivas[filho] = [...allIds];
    } else {
      // Remove IDs de tarefas que foram deletadas globalmente
      data.tarefasAtivas[filho] = data.tarefasAtivas[filho]
        .filter(id => allIds.includes(id));
    }
  });

  // Remove entradas de filhos que não existem mais
  Object.keys(data.tarefasAtivas).forEach(filho => {
    if (!data.filhos.includes(filho)) delete data.tarefasAtivas[filho];
  });

  return data;
}

/** Retorna as tarefas ativas de um filho específico */
function tarefasDoFilho(data, filho) {
  const activeIds = data.tarefasAtivas?.[filho];
  if (!activeIds) return data.tarefas;
  return data.tarefas.filter(t => activeIds.includes(t.id));
}

// ── Backup anual ──────────────────────────────────────────────────────────────
/**
 * Mantém registros de até 12 meses. Registros mais antigos são arquivados
 * em backups/ e removidos do dados.json (filhos e tarefas permanecem).
 */
function checkAnnualBackup(data) {
  const registros = data.registros || {};
  const keys      = Object.keys(registros).sort();
  if (keys.length === 0) return data;

  // Cutoff: início do mês atual menos 11 meses = janela de 12 meses
  const now       = new Date();
  const cutoff    = new Date(now.getFullYear(), now.getMonth() - 11, 1);
  const cutoffKey = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, '0')}`;

  const oldKeys = keys.filter(k => k < cutoffKey);
  if (oldKeys.length === 0) return data;

  // Cria diretório de backup se não existir
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }

  // Monta arquivo de backup
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

  const stamp      = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const backupFile = path.join(BACKUP_DIR, `backup-${stamp}.json`);
  fs.writeFileSync(backupFile, JSON.stringify(backupPayload, null, 2));

  console.log(`\n📦 Backup automático gerado: ${path.basename(backupFile)}`);
  console.log(`   Meses arquivados: ${oldKeys.join(', ')}\n`);

  saveData(data);
  return data;
}

// ── Cálculo de saldo ──────────────────────────────────────────────────────────
function calcularSaldo(data, filho, monthKey) {
  const max      = data.valorMaximoMensal;
  const regMes   = data.registros?.[monthKey]?.[filho] || {};
  // Só conta deduções de tarefas ATIVAS para este filho
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
/**
 * Validação de PIN usando comparação em tempo constante.
 * Previne timing attacks que poderiam revelar o PIN dígito a dígito.
 */
function validatePin(req, res, next) {
  const pin        = req.headers['x-pin'] || '';
  const correctPin = process.env.PIN || '1234';

  // Normaliza para mesmo comprimento antes de comparar
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
  res.json({ status: 'online', timestamp: Date.now() });
});

app.get('/api/estado', (req, res) => {
  let data = loadData();
  data     = checkAnnualBackup(data);
  const monthKey = currentMonthKey();
  data     = ensureMonth(data, monthKey);
  data     = ensureTarefasAtivas(data);
  saveData(data);

  const saldos = {};
  data.filhos.forEach(filho => {
    saldos[filho] = calcularSaldo(data, filho, monthKey);
  });

  // Para meses históricos, usa saldo congelado se disponível
  const saldosHistorico = {};
  const mesesHist = Object.keys(data.registros).filter(k => k !== monthKey).sort().reverse();
  mesesHist.forEach(mes => {
    saldosHistorico[mes] = {};
    data.filhos.forEach(filho => {
      if (data.saldosCongelados?.[mes]?.[filho] !== undefined) {
        saldosHistorico[mes][filho] = data.saldosCongelados[mes][filho];
      } else {
        saldosHistorico[mes][filho] = calcularSaldo(data, filho, mes);
      }
    });
  });

  res.json({
    mesAtual          : monthKey,
    valorMaximoMensal : data.valorMaximoMensal,
    filhos            : data.filhos,
    tarefas           : data.tarefas,
    tarefasAtivas     : data.tarefasAtivas,
    registros         : data.registros,
    saldos,
    saldosHistorico,
    mesesHistorico    : mesesHist
  });
});

// ── Rotas POST (todas requerem PIN) ──────────────────────────────────────────
/** Registra ou limpa o status de uma tarefa para um filho num dia */
app.post('/api/registrar', validatePin, (req, res) => {
  const { filho, dia, tarefaId, cumprida } = req.body;

  if (!filho || !dia || tarefaId === undefined || cumprida === undefined) {
    return res.status(400).json({ erro: 'Dados incompletos' });
  }

  let data = loadData();
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
    // ⬜ Limpa o registro desta tarefa
    delete data.registros[monthKey][filho][diaStr][String(tarefaId)];
    if (Object.keys(data.registros[monthKey][filho][diaStr]).length === 0) {
      delete data.registros[monthKey][filho][diaStr];
    }
  } else {
    data.registros[monthKey][filho][diaStr][String(tarefaId)] = cumprida;
  }

  saveData(data);

  const saldo = calcularSaldo(data, filho, monthKey);
  res.json({ sucesso: true, saldo, registros: data.registros[monthKey][filho] });
});

/** Adiciona ou remove um filho */
app.post('/api/admin/filho', validatePin, (req, res) => {
  const { acao, nome } = req.body;
  let data = loadData();

  if (acao === 'adicionar') {
    const n = (nome || '').trim();
    if (!n)                      return res.status(400).json({ erro: 'Nome inválido' });
    if (data.filhos.includes(n)) return res.status(400).json({ erro: 'Filho já existe' });
    data.filhos.push(n);
    data = ensureMonth(data, currentMonthKey());
    data = ensureTarefasAtivas(data); // novo filho recebe todas as tarefas
  } else if (acao === 'remover') {
    data.filhos = data.filhos.filter(f => f !== nome);
    data = ensureTarefasAtivas(data); // limpa entrada removida
  } else {
    return res.status(400).json({ erro: 'Ação inválida. Use: adicionar | remover' });
  }

  saveData(data);
  res.json({ sucesso: true, filhos: data.filhos });
});

/** Adiciona, edita ou remove uma tarefa */
app.post('/api/admin/tarefa', validatePin, (req, res) => {
  const { acao, tarefa } = req.body;
  let data = loadData();

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
    // Nova tarefa é adicionada a TODOS os filhos por padrão
    data = ensureTarefasAtivas(data);
  } else if (acao === 'editar') {
    const idx = data.tarefas.findIndex(t => t.id === tarefa.id);
    if (idx === -1) return res.status(404).json({ erro: 'Tarefa não encontrada' });

    // Se a dedução mudou, congela os saldos dos meses anteriores
    const old = data.tarefas[idx];
    if (tarefa.deducao !== undefined && tarefa.deducao !== old.deducao) {
      const monthKey = currentMonthKey();
      if (!data.saldosCongelados) data.saldosCongelados = {};
      Object.keys(data.registros || {}).forEach(mes => {
        if (mes >= monthKey) return; // só congela meses passados
        if (!data.saldosCongelados[mes]) data.saldosCongelados[mes] = {};
        data.filhos.forEach(filho => {
          // Só congela se ainda não foi congelado
          if (data.saldosCongelados[mes][filho] === undefined) {
            data.saldosCongelados[mes][filho] = calcularSaldo(data, filho, mes);
          }
        });
      });
    }

    data.tarefas[idx] = { ...data.tarefas[idx], ...tarefa };
  } else if (acao === 'remover') {
    data.tarefas = data.tarefas.filter(t => t.id !== tarefa.id);
    data = ensureTarefasAtivas(data); // limpa ID removido de todos os filhos
  } else {
    return res.status(400).json({ erro: 'Ação inválida. Use: adicionar | editar | remover' });
  }

  saveData(data);
  res.json({ sucesso: true, tarefas: data.tarefas, tarefasAtivas: data.tarefasAtivas });
});

/** Ativa ou desativa uma tarefa para um filho específico */
app.post('/api/admin/tarefa-filho', validatePin, (req, res) => {
  const { filho, tarefaId, ativo } = req.body;
  let data = loadData();
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

  saveData(data);
  res.json({ sucesso: true, tarefasAtivas: data.tarefasAtivas });
});

/** Altera o valor máximo mensal e/ou o PIN */
app.post('/api/admin/config', validatePin, (req, res) => {
  const { valorMaximoMensal, novoPin } = req.body;
  let data = loadData();

  if (valorMaximoMensal !== undefined && !isNaN(valorMaximoMensal) && valorMaximoMensal > 0) {
    data.valorMaximoMensal = parseFloat(valorMaximoMensal);
  }

  if (novoPin && /^\d{4}$/.test(novoPin)) {
    const envPath = path.join(__dirname, '.env');
    // Preserva outras linhas do .env e atualiza apenas PIN
    let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
    if (/^PIN=/m.test(envContent)) {
      envContent = envContent.replace(/^PIN=.*/m, `PIN=${novoPin}`);
    } else {
      envContent += `\nPIN=${novoPin}\n`;
    }
    fs.writeFileSync(envPath, envContent, 'utf8');
    process.env.PIN = novoPin;
  }

  saveData(data);
  res.json({ sucesso: true });
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

app.listen(PORT, '0.0.0.0', () => {
  const ips = getLocalIPs();
  const line = '─'.repeat(52);
  console.log(`\n┌${line}┐`);
  console.log(`│  🏆  Quadro de Recompensas v1.1                          │`);
  console.log(`├${line}┤`);
  console.log(`│                                                          │`);
  ips.forEach(ip => {
    const url = `http://${ip}:${PORT}`;
    console.log(`│  📺  ${url.padEnd(48)}│`);
  });
  console.log(`│  💻  http://localhost:${PORT}`.padEnd(55) + '│');
  console.log(`│  🌐  http://quadro.local:${PORT}`.padEnd(55) + '│');
  console.log(`│                                                          │`);
  console.log(`│  Ctrl+C para parar                                       │`);
  console.log(`└${line}┘\n`);

  // Inicia mDNS para registrar quadro.local
  startMDNS(ips[0]);
});

// ── mDNS embutido — quadro.local ────────────────────────────────────────────
/**
 * Registra "quadro.local" na rede local via multicast DNS.
 * Funciona em: iOS, Android, macOS (nativamente), Windows 10+ (suporte nativo),
 * e Smart TVs com Android TV / Tizen / webOS.
 * Não requer instalação de software adicional como Bonjour.
 */
function startMDNS(localIP) {
  if (!localIP) {
    console.log('ℹ️  Nenhum IP de rede encontrado. mDNS não iniciado.\n');
    return;
  }

  try {
    const mdns = require('multicast-dns')();

    // Responde a consultas mDNS pelo hostname "quadro.local"
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

    // Anuncia proativamente na rede ao iniciar
    mdns.respond([{
      name: 'quadro.local',
      type: 'A',
      ttl: 120,
      data: localIP
    }]);

    // Re-anuncia a cada 60 segundos para manter a resolução atualizada
    const announceTimer = setInterval(() => {
      mdns.respond([{
        name: 'quadro.local',
        type: 'A',
        ttl: 120,
        data: localIP
      }]);
    }, 60_000);

    console.log(`✅ mDNS ativo: quadro.local → ${localIP}`);
    console.log('   📱 iOS/Android/macOS: acesse http://quadro.local:' + PORT);
    console.log('   🖥️  Windows 10+: acesse http://quadro.local:' + PORT);
    console.log('   📺 Smart TVs: acesse http://quadro.local:' + PORT + '\n');

    // Limpa recursos ao encerrar
    const cleanup = () => {
      clearInterval(announceTimer);
      mdns.destroy();
    };
    process.on('exit', cleanup);
    process.on('SIGINT',  () => { cleanup(); process.exit(0); });
    process.on('SIGTERM', () => { cleanup(); process.exit(0); });

  } catch (err) {
    console.log('⚠️  Erro ao iniciar mDNS:', err.message);
    console.log('   O servidor funciona normalmente via IP.\n');
  }
}
