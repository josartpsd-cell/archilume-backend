# Archilume — Backend de licenciamento e uso

Backend mínimo que faltava pro plugin Archilume virar produto vendável: gera chaves de
licença, controla quantas máquinas cada uma ativa, e desconta renders do saldo
mensal de cada plano.

**Não é um proxy de IA ainda** — isso é o próximo passo (o plugin hoje ainda fala
direto com Higgsfield/Google usando credenciais locais). Este backend só
controla *quem pode* renderizar e *quantas vezes*, independente de qual
provedor de IA é usado.

## Rodando localmente

```
npm install
cp .env.example .env    # edite ADMIN_SECRET para um valor seu
npm start                # sobe em http://localhost:3900
```

Banco de dados: SQLite embutido no Node (`node:sqlite`, sem dependência nativa
pra compilar) — fica em `data.sqlite` nesta pasta.

## Gerar uma chave para um cliente

```
npm run generate-key -- --email cliente@exemplo.com --plan starter
```

Planos disponíveis: `trial`, `starter`, `pro`, `studio` (definidos em `src/plans.js`,
espelhando a tabela "Planos de venda" do mapa/doc).

## Endpoints

| Rota | Quem chama | Uso |
| --- | --- | --- |
| `POST /license/generate` | Você (admin, header `x-admin-secret`) | Cria uma chave nova pra um cliente |
| `POST /license/activate` | Plugin, na primeira abertura | `{key, machine_id}` → libera a licença nesta máquina |
| `POST /license/validate` | Plugin, periodicamente | Revalida a licença + devolve módulos liberados |
| `POST /license/deactivate` | Plugin | Libera a vaga de ativação (cliente trocou de PC) |
| `POST /usage/check` | Plugin, antes de habilitar o botão Renderizar | Quantos renders restam no período |
| `POST /usage/consume` | Plugin, depois de um render dar certo | Desconta 1 render do saldo |

## O que ainda falta aqui (não é escopo deste backend ainda)

- Hospedar isso em algum lugar real (Railway/Fly.io/VPS) — hoje só roda local
- Webhook de pagamento (Stripe/Hotmart/Kiwify) chamando `/license/generate` automaticamente
- Painel admin visual (hoje é só o CLI `generate-key` ou chamar a API direto)
- Proxy de IA (meter as chamadas ao Higgsfield/Google por aqui, não direto do plugin)
- Migrar de SQLite para Postgres se for rodar em produção com múltiplas instâncias
