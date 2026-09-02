/**
 * Script de Migração: dados.json → Firebase Firestore
 * Lê os dados locais e envia com segurança para o Firestore.
 * Nenhuma chave ou dado sensível é exibido no console.
 */
require('dotenv').config();
const fs   = require('fs');
const path = require('path');

async function migrar() {
  console.log('\n🚀 Iniciando migração para o Firebase Firestore...\n');

  // 1. Localiza o arquivo de dados
  const customPath = process.argv[2];
  const dadosPath  = customPath ? path.resolve(customPath) : path.join(__dirname, 'dados.json');

  if (!fs.existsSync(dadosPath)) {
    console.error(`❌ Arquivo de dados não encontrado em: ${dadosPath}`);
    console.error('   Certifique-se de que o arquivo dados.json está na pasta do projeto ou passe o caminho.');
    process.exit(1);
  }

  let data;
  try {
    const raw = fs.readFileSync(dadosPath, 'utf8');
    data = JSON.parse(raw);
  } catch (err) {
    console.error('❌ Erro ao ler/parsear o arquivo dados.json:', err.message);
    process.exit(1);
  }

  // 2. Localiza as credenciais do Firebase
  let serviceAccount = null;

  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT.trim();
    try {
      if (raw.startsWith('{')) {
        serviceAccount = JSON.parse(raw);
      } else if (fs.existsSync(raw)) {
        serviceAccount = JSON.parse(fs.readFileSync(raw, 'utf8'));
      }
    } catch {}
  }

  if (!serviceAccount) {
    // Busca arquivo de chave na pasta do projeto
    try {
      const files = fs.readdirSync(__dirname);
      const keyFile = files.find(f => 
        f.endsWith('.json') && (f.includes('adminsdk') || f.includes('firebase') || f === 'firebase-key.json')
      );
      if (keyFile) {
        const keyPath = path.join(__dirname, keyFile);
        serviceAccount = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
        console.log(`🔑 Chave do Firebase detectada: ${keyFile}`);
      }
    } catch {}
  }

  if (!serviceAccount) {
    console.error('❌ Nenhuma credencial do Firebase encontrada.');
    console.error('   Coloque o arquivo .json da conta de serviço na pasta do projeto ou defina a variável FIREBASE_SERVICE_ACCOUNT.');
    process.exit(1);
  }

  // 3. Inicializa o Firebase Admin SDK
  let admin;
  try {
    admin = require('firebase-admin');
  } catch {
    console.error('❌ Pacote firebase-admin não instalado. Execute: npm install');
    process.exit(1);
  }

  try {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
  } catch (err) {
    console.error('❌ Erro ao inicializar conexão com o Firebase:', err.message);
    process.exit(1);
  }

  const db = admin.firestore();

  // 4. Envia os dados para a coleção "quadro", documento "principal"
  try {
    console.log('📤 Enviando dados para o Firestore (coleção: quadro / doc: principal)...');
    await db.collection('quadro').doc('principal').set(data);

    // Se houver PIN no .env, registra no Firestore também
    const pin = process.env.PIN;
    if (pin && /^\d{4}$/.test(pin)) {
      await db.collection('quadro').doc('config').set({ pin }, { merge: true });
    }

    const totalFilhos   = (data.filhos || []).length;
    const totalTarefas  = (data.tarefas || []).length;
    const totalMeses    = Object.keys(data.registros || {}).length;

    console.log('\n✅ Migração concluída com sucesso!');
    console.log(`   👥 Filhos migrados    : ${totalFilhos}`);
    console.log(`   📋 Tarefas migradas   : ${totalTarefas}`);
    console.log(`   📅 Meses com histórico: ${totalMeses}`);
    console.log('\nO seu servidor no Render e localmente agora utilizará estes dados no Firestore.\n');

  } catch (err) {
    console.error('❌ Erro ao gravar dados no Firestore:', err.message);
    process.exit(1);
  }
}

migrar();
