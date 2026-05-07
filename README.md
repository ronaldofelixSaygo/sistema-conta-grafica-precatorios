# Sistema Conta Gráfica — Saygo

Refatoração completa do sistema antigo para a stack:

- **Node.js 18+** + **Express 4** (ES Modules)
- **Prisma ORM** + **PostgreSQL** no **Neon** (serverless)
- **Socket.IO** para chat em tempo real
- **JWT + bcrypt** para autenticação (cookie httpOnly)
- Frontend SPA leve (HTML + CSS + JS puro, sem build)
- Pronto para deploy em **Render** (1 web service)

---

## Perfis de acesso

| Perfil       | O que vê / faz                                                                 |
|--------------|--------------------------------------------------------------------------------|
| **ADM**      | Tudo: usuários, auditoria, todos os clientes/movimentações                     |
| **SAYGO**    | Opera o sistema como antes, vê **dados de todos os clientes**                  |
| **PARTNER**  | Vê **apenas clientes vinculados ao seu escritório** (campo `escritório`)       |
| **CLIENT**   | Vê **apenas o próprio cliente** (vinculado por `clienteId` no cadastro do user) |

> O vínculo **Parceiro ↔ Clientes** continua sendo o campo **Escritório** já existente no cadastro do cliente. Basta que o nome do escritório no usuário PARTNER seja **idêntico** ao valor do campo `escritorio` dos clientes que ele deve enxergar.

---

## Estrutura

```
.
├── prisma/
│   ├── schema.prisma        # tabelas: users, clientes, movimentacoes, audit, conversations, messages
│   └── seed.js              # cria 1º admin
├── scripts/
│   └── migrate-from-sqlite.js   # migra database.sqlite antigo → Neon
├── src/
│   ├── server.js            # entrypoint (HTTP + Socket.IO)
│   ├── app.js               # Express
│   ├── config/              # env, prisma client
│   ├── routes/              # /api/*
│   ├── controllers/
│   ├── services/            # toda a regra de negócio
│   ├── middlewares/         # auth, role, error
│   ├── sockets/             # chat real-time
│   └── utils/               # jwt, scoping por role
├── public/                  # SPA servida pelo próprio Express
│   ├── index.html
│   ├── css/styles.css
│   └── js/*.js
├── render.yaml              # blueprint de deploy
├── .env.example
└── package.json
```

---

## Rodando localmente

### 1. Crie o banco no Neon

1. Acesse <https://console.neon.tech> e crie um projeto.
2. Em **Connection Details**, copie a connection string (com `?sslmode=require`).

### 2. Configure o `.env`

```bash
cp .env.example .env
```

Edite `.env` e preencha pelo menos:

```env
DATABASE_URL="postgresql://USER:PASS@HOST.neon.tech/DBNAME?sslmode=require"
JWT_SECRET="$(openssl rand -hex 64)"
SEED_ADMIN_EMAIL=admin@saygogroup.com.br
SEED_ADMIN_PASSWORD=SuaSenhaForte!
```

### 3. Instale e migre

```bash
npm install
npx prisma migrate dev --name init
npm run seed
```

### 4. (Opcional) Importe os dados do sistema antigo

Aponte para o `database.sqlite` do sistema antigo no `.env`:

```env
LEGACY_SQLITE_PATH="C:\\Users\\RonaldoFélix\\Documents\\conta-grafica\\database.sqlite"
```

E rode:

```bash
npm run migrate:from-sqlite
```

Importa **users**, **clientes** e **movimentações** de forma idempotente (ignora duplicatas).

### 5. Suba o servidor

```bash
npm start
# http://localhost:3000
```

Faça login com o e-mail/senha do seed.

---

## Deploy no Render

Tudo já está configurado em `render.yaml`. Passo a passo:

1. **Crie o repositório no GitHub** com este projeto.
2. No Render, clique **New + → Blueprint** e aponte para o repo.
3. O Render lê `render.yaml` e cria o web service.
4. Em **Environment**, defina manualmente (não vão pelo blueprint):
   - `DATABASE_URL` → string do Neon (com `?sslmode=require`)
   - `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, `SEED_ADMIN_NAME`
5. Deploy. O `buildCommand` já roda:
   ```
   npm install && npx prisma generate && npx prisma migrate deploy
   ```
6. **Primeiro acesso**: rode o seed do admin uma vez via **Render → Shell**:
   ```
   npm run seed
   ```
   (ou abra o app, ele falha o login → você roda o seed → tenta de novo)

7. Acesse a URL `*.onrender.com` que o Render gera.

> **Plano free**: o serviço dorme após inatividade. Para chat sempre online, use plano Starter ($7/mês).

---

## Endpoints da API

Todas exigem autenticação (cookie `token`) salvo `/api/auth/login` e `/api/health`.

| Método | Rota                              | Quem pode |
|--------|-----------------------------------|-----------|
| POST   | `/api/auth/login`                 | público |
| POST   | `/api/auth/logout`                | logado |
| GET    | `/api/auth/me`                    | logado |
| POST   | `/api/auth/change-password`       | logado |
| GET    | `/api/users`                      | ADM |
| POST   | `/api/users`                      | ADM |
| PUT    | `/api/users/:id`                  | ADM |
| POST   | `/api/users/:id/deactivate`       | ADM |
| DELETE | `/api/users/:id`                  | ADM |
| GET    | `/api/clientes`                   | logado (filtrado por role) |
| POST   | `/api/clientes`                   | ADM/SAYGO |
| PUT    | `/api/clientes/:id`               | ADM/SAYGO |
| PUT    | `/api/clientes/comissao-lote`     | ADM/SAYGO |
| DELETE | `/api/clientes/:id`               | ADM/SAYGO |
| GET    | `/api/movimentacoes`              | logado (filtrado por role) |
| POST   | `/api/movimentacoes`              | ADM/SAYGO |
| PUT    | `/api/movimentacoes/:id`          | ADM/SAYGO |
| DELETE | `/api/movimentacoes/:id`          | ADM/SAYGO |
| GET    | `/api/dashboard`                  | logado |
| GET    | `/api/saldos`                     | logado |
| GET    | `/api/comissoes`                  | logado |
| GET    | `/api/alertas`                    | logado |
| GET    | `/api/relatorio` (json/excel/pdf) | logado |
| POST   | `/api/import`                     | ADM/SAYGO (Excel) |
| GET    | `/api/audit`                      | ADM |
| GET    | `/api/chat/contacts`              | logado |
| GET    | `/api/chat/conversations`         | logado |
| GET    | `/api/chat/messages/:otherId`     | logado |
| POST   | `/api/chat/messages/:otherId`     | logado |
| GET    | `/api/chat/unread`                | logado |

### Chat (Socket.IO)

- Conecta em `/` com `auth: { token }` (lido também do cookie).
- Eventos:
  - `chat:send` `{ toUserId, content }` → callback `{ ok, message }`.
  - `chat:message` (broadcast para os 2 usuários da conversa).
  - `chat:read` `{ otherId }` → marca como lidas.
  - `chat:typing` `{ toUserId, typing }`.
  - `chat:presence` `{ userId, online }`.

Regras de quem-fala-com-quem (aplicadas no servidor em `chat.service.js`):

- **ADM/SAYGO**: todos.
- **PARTNER**: ADM/SAYGO + clientes do mesmo `escritorio`.
- **CLIENT**: ADM/SAYGO + parceiro do seu `escritorio`.

---

## Tabelas no banco (resumo)

- `users`: id, email, passwordHash, name, role(ADM|SAYGO|PARTNER|CLIENT), officeName, clienteId, active, lastLoginAt
- `clientes`: id, nome, cnpj, escritorio (← chave do parceiro), percentualComissao, diaFechamento, etc.
- `movimentacoes`: id, clienteId, tipoMovimento, dataNf, parceiro, percentual, valor, valorAjustado
- `audit_log`: id, userId, action, entity, entityId, details, ip, createdAt
- `conversations`: id, userAId, userBId, lastMessage, lastAt
- `messages`: id, conversationId, fromUserId, toUserId, content, readAt, createdAt

---

## Trocando a senha do admin

Após o primeiro login, abra o **DevTools → Console** e:

```js
await fetch('/api/auth/change-password', {
  method: 'POST', credentials: 'include',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ current: 'TrocarEssaSenhaJa!', next: 'NovaSenha123!' })
}).then(r => r.json());
```

(Em uma versão futura, dá pra colocar isso numa tela de "Meu perfil".)

---

## Comandos úteis

```bash
npm start                    # roda o servidor
npm run dev                  # com watch
npx prisma studio            # abre GUI do banco
npx prisma migrate dev       # cria nova migration
npx prisma migrate deploy    # aplica migrations (produção)
npm run seed                 # cria/garante o admin
npm run migrate:from-sqlite  # importa dados do sistema antigo
```

---

## Licença

Uso interno Saygo Group.
