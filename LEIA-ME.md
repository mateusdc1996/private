# MDQuest — site (Fase 1: login + IA com cota)

## O que tem aqui
| Arquivo | Para que serve |
|---|---|
| `public/index.html` | O programa MDQuest original, com 3 linhas a mais no topo que carregam o adaptador |
| `public/mdquest-adaptador.js` | Tela de login e as "tomadas" que o programa pedia ao claude.ai (`claude.use`): usuário, banco, IA, downloads e arquivos — agora ligadas ao Supabase e ao `/api/claude` |
| `public/config.js` | Endereço e chave **pública** do Supabase |
| `api/claude.js` | Servidor da IA: confere login e cota, chama a Anthropic com a chave secreta, registra o uso só quando a chamada termina bem |
| `supabase/01-estrutura.sql` | Cria as tabelas e as regras de acesso no Supabase |
| `montar.py` | Gera `public/index.html` a partir de uma versão nova do `mdquest.html` (`python3 montar.py mdquest.html`) |
| `vercel.json` | Configuração da hospedagem |

## Variáveis secretas na Vercel (Settings → Environment Variables)
- `ANTHROPIC_API_KEY` — chave da Anthropic
- `SUPABASE_URL` — `https://vhjwdgjfbgjxfvpduchf.supabase.co`
- `SUPABASE_SECRET_KEY` — "Secret key" do Supabase

## Regras de acesso (resumo)
- `data/users/<id>/...` — só o próprio aluno lê e grava.
- `comum/`, `boletim`, `boletimDest`, `conceitos`, `juris`, `reversa`, `tesesmed`, e os documentos de topo de `blog` e `arenas` — todos leem, só a equipe grava.
- Demais (comentários, inscrições, avaliações, duplas, comunidade, vitrine) — qualquer aluno logado cria; só o autor ou a equipe altera/apaga.
- Planos, assinaturas e consumo — só o servidor grava; o aluno lê as próprias linhas.
- Equipe = `perfis.papel = 'equipe'` (cota ilimitada).

## Cota (versão inicial)
Dois contadores por ciclo mensal (a partir de `assinaturas.ciclo_inicio`): `geral` (gerar, corrigir, transcrever) e `professor` (chat "Pergunte ao professor"). Limites na tabela `planos`. Refinamento por tipo de correção fica para depois.

## Pendências conhecidas
- Migrar o conteúdo que hoje está no banco do claude.ai (acervo `comum/questoes`, blog, arenas, pacote OAB `22dec773…`) para o Supabase.
- Pagamento (Mercado Pago) criando/atualizando `assinaturas` pelo webhook.
- Pesquisa na internet (`claude.use("mcp")`) não existe fora do claude.ai: o programa mostra o aviso de indisponível.
- Testado com um Supabase simulado e com a Anthropic simulada; falta o teste com as contas reais.
