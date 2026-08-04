# 🏆 Quadro de Recompensas

Sistema de recompensas mensal para acompanhar tarefas diárias dos filhos. Exibe um quadro visual com saldo, tarefas cumpridas e um calendário mensal — acessível pelo celular, notebook, PC ou Smart TV.

## ✨ Funcionalidades

- **Dashboard** com cards por filho mostrando saldo e tarefas do dia
- **Calendário mensal** com grid de tarefas por dia
- **Painel administrativo** protegido por PIN (4 dígitos)
  - Registrar tarefas cumpridas/não cumpridas por dia
  - Adicionar/remover filhos
  - Criar/editar/remover tarefas com ícones e valores de dedução
  - Atribuir tarefas individualmente por filho
  - Alterar valor máximo mensal e PIN
- **Auto-atualização** a cada 30 segundos (ideal para deixar na TV)
- **Indicador de conexão** — avisa visualmente se o servidor cair
- **mDNS integrado** — acesse via `http://quadro.local:3000` de qualquer dispositivo na rede
- **Backup automático** — registros com mais de 12 meses são arquivados
- **Escrita atômica** — proteção contra corrupção de dados em quedas de energia
- **Design premium** com dark mode, glassmorphism e micro-animações

## 🚀 Instalação

```bash
# Clone o repositório
git clone https://github.com/JefteSantos/quadro-recompensas.git
cd quadro-recompensas

# Instale as dependências
npm install

# Configure o PIN (copie o exemplo e edite)
copy .env.example .env
# Edite o arquivo .env com seu PIN de 4 dígitos
```

## ▶️ Como Usar

### Iniciar o servidor
```bash
npm start
```

O servidor exibirá os endereços de acesso:
```
┌────────────────────────────────────────────────────────┐
│  🏆  Quadro de Recompensas v1.1                       │
├────────────────────────────────────────────────────────┤
│  📺  http://192.168.x.x:3000                          │
│  💻  http://localhost:3000                             │
│  🌐  http://quadro.local:3000                         │
└────────────────────────────────────────────────────────┘
```

### Iniciar em segundo plano (sem janela do terminal)
Dê um duplo clique em `iniciar_servidor_oculto.vbs` — o servidor roda silenciosamente nos bastidores.

### Parar o servidor em segundo plano
Dê um duplo clique em `parar_servidor.bat`.

### Iniciar automaticamente com o Windows
1. Pressione `Win + R`, digite `shell:startup` e pressione Enter
2. Crie um atalho do arquivo `iniciar_servidor_oculto.vbs` dentro da pasta que abrir

## 🌐 Acesso na Rede Local

| Dispositivo | Endereço |
|-------------|----------|
| Mesmo PC    | `http://localhost:3000` |
| Celular/TV/Outros | `http://quadro.local:3000` |
| Fallback (IP direto) | `http://<IP-DO-PC>:3000` |

> O mDNS (`quadro.local`) funciona nativamente em iOS, Android, macOS e Windows 10+.

## 📁 Estrutura

```
quadro-recompensas/
├── server.js                      # Servidor Express + mDNS
├── dados.json                     # Dados persistidos (filhos, tarefas, registros)
├── .env                           # PIN de acesso (não commitado)
├── .env.example                   # Modelo do .env
├── package.json
├── iniciar_servidor_oculto.vbs    # Iniciar sem janela
├── parar_servidor.bat             # Parar servidor em segundo plano
└── public/
    ├── index.html                 # Página principal
    ├── app.js                     # Lógica frontend
    └── style.css                  # Design system premium
```

## 🔒 Segurança

- O PIN é armazenado apenas no arquivo `.env` (nunca no `dados.json`)
- O `.env` está no `.gitignore` — nunca é commitado
- A validação de PIN usa comparação em tempo constante (`crypto.timingSafeEqual`)

## 📄 Licença

Uso pessoal.
