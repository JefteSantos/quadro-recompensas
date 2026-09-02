# 🏆 Quadro de Recompensas

Sistema de recompensas mensal para acompanhar tarefas diárias dos filhos. Exibe um quadro visual com saldo, tarefas cumpridas e um calendário mensal — acessível pelo celular, notebook, PC ou Smart TV.

Pode ser executado tanto **localmente na sua rede doméstica** quanto **hospedado na nuvem (Render.com + Firebase Firestore)** de forma 100% gratuita.

---

## ✨ Funcionalidades

- **Dashboard** com cards por filho mostrando saldo e tarefas do dia
- **Calendário mensal** com grid de tarefas por dia
- **Painel administrativo** protegido por PIN (4 dígitos)
  - Registrar tarefas cumpridas/não cumpridas por dia
  - Adicionar/remover filhos
  - Criar/editar/remover tarefas com ícones e valores de dedução
  - Atribuir tarefas individualmente por filho
  - Alterar valor máximo mensal e PIN
- **Armazenamento Híbrido**:
  - **Nuvem**: Sincronização persistente no **Firebase Firestore** (gratuito, nunca pausa por inatividade)
  - **Local**: Fallback seguro com escrita atômica em `dados.json`
- **Auto-atualização** a cada 30 segundos (ideal para deixar na TV)
- **Indicador de conexão** — avisa visualmente se o servidor cair
- **mDNS integrado** — acesse via `http://quadro.local:3000` na rede local (desativado automaticamente em nuvem)
- **Backup automático** — registros com mais de 12 meses são arquivados
- **Escrita atômica** — proteção contra corrupção de dados em quedas de energia
- **Design premium** com dark mode, glassmorphism e micro-animações

---

## 🚀 Instalação e Execução Local

```bash
# 1. Clone o repositório
git clone https://github.com/JefteSantos/quadro-recompensas.git
cd quadro-recompensas

# 2. Instale as dependências
npm install

# 3. Configure o PIN (copie o exemplo e edite)
copy .env.example .env
# Edite o arquivo .env com seu PIN de 4 dígitos desejado

# 4. Inicie o servidor
npm start
```

### Endereços de Acesso Local
- **No próprio computador**: `http://localhost:3000`
- **Em qualquer dispositivo na mesma rede Wi-Fi**: `http://quadro.local:3000` (ou pelo IP do PC)

### Execução em Segundo Plano no Windows
- **Iniciar silenciosamente**: Duplo clique em `iniciar_servidor_oculto.vbs`
- **Parar o servidor**: Duplo clique em `parar_servidor.bat`
- **Iniciar com o Windows**: Pressione `Win + R`, digite `shell:startup` e crie um atalho para `iniciar_servidor_oculto.vbs`.

---

## ☁️ Hospedagem Gratuita na Nuvem (Render + Firebase Firestore)

Para acessar o quadro de qualquer lugar (inclusive fora de casa) sem precisar manter o computador ligado.

### 1. Criar o Banco no Firebase Firestore
1. Acesse o [Console do Firebase](https://console.firebase.google.com/) e crie um projeto.
2. No menu lateral, acesse **Criação > Firestore Database** e clique em **Criar banco de dados** (escolha o modo de produção e a região mais próxima).
3. Vá em **Configurações do projeto ⚙️ > Contas de serviço**.
4. Clique em **Gerar nova chave privada** para baixar o arquivo de credenciais `.json`.

### 2. Publicar no Render.com
1. Acesse o [Render.com](https://dashboard.render.com/) e crie um novo **Web Service** conectado ao seu repositório no GitHub.
2. Configure os campos:
   - **Runtime**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
   - **Instance Type**: `Free`
3. Na seção **Environment Variables**, adicione:
   - `PIN`: seu PIN de 4 dígitos (ex: `1234`)
   - `FIREBASE_SERVICE_ACCOUNT`: abra o arquivo `.json` baixado do Firebase no Bloco de Notas, copie todo o conteúdo e cole diretamente no valor desta variável.
4. Clique em **Deploy Web Service**.

> **Dica para evitar hibernação no Render**: Como o plano gratuito hiberna após 15 minutos de inatividade, você pode cadastrar a URL `https://seu-app.onrender.com/api/ping` em um serviço gratuito como [UptimeRobot](https://uptimerobot.com/) a cada 10 minutos para mantê-lo sempre ativo 24h.

---

## 📦 Script de Migração (dados.json → Firestore)

Se você já utilizava o app localmente com dados salvos em `dados.json` e deseja transferi-los para o banco do Firestore:

1. Certifique-se de que o arquivo de credenciais `.json` baixado do Firebase está na pasta raiz do projeto.
2. Execute o comando de migração:
   ```bash
   npm run migrar
   ```
   *(Ou se o seu arquivo estiver em outro caminho: `node migrar-firestore.js "caminho/para/dados.json"`)*

O script enviará todos os filhos, tarefas, registros e configurações para o Firestore com segurança, sem exibir nenhuma credencial.

---

## 📁 Estrutura do Projeto

```
quadro-recompensas/
├── server.js                      # Servidor Express + Firestore + mDNS
├── migrar-firestore.js            # Script para migrar dados.json para o Firestore
├── dados.json                     # Dados locais (ignorado no git)
├── .env                           # Configurações sensíveis locais (ignorado no git)
├── .env.example                   # Modelo do .env
├── package.json                   # Dependências e scripts
├── iniciar_servidor_oculto.vbs    # Iniciar sem janela no Windows
├── parar_servidor.bat             # Parar servidor em segundo plano
└── public/
    ├── index.html                 # Interface HTML5
    ├── app.js                     # Lógica frontend (Vanilla JS)
    └── style.css                  # Design System Dark Mode Glassmorphism
```

---

## 🔒 Segurança e Privacidade

- **Credenciais Blindadas**: Arquivos `.env`, chaves privadas do Firebase (`*-adminsdk-*.json`, `*firebase*.json`), chaves do Render e certificados são estritamente ignorados pelo `.gitignore` e **nunca são enviados ao repositório**.
- **Validação de PIN Segura**: O PIN de acesso administrativo é verificado usando comparação em tempo constante (`crypto.timingSafeEqual`) contra ataques de temporização (*timing attacks*).
- **Dados Pessoais Protegidos**: O arquivo `dados.json` com o histórico familiar fica protegido localmente e, na nuvem, apenas acessível com a chave de serviço autenticada.

---

## 📄 Licença

Uso pessoal e familiar.
