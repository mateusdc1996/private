-- =====================================================================
-- MDQuest · estrutura do banco (Supabase / Postgres)
-- Cole tudo no SQL Editor do Supabase e clique em "Run".
-- Pode ser rodado mais de uma vez sem estragar nada.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. PERFIS: um por aluno, criado sozinho no cadastro
-- ---------------------------------------------------------------------
create table if not exists public.perfis (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text,
  papel      text not null default 'aluno' check (papel in ('aluno','equipe')),
  criado_em  timestamptz not null default now()
);
alter table public.perfis enable row level security;

create or replace function public.criar_perfil() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.perfis(id, email) values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists ao_cadastrar on auth.users;
create trigger ao_cadastrar after insert on auth.users
  for each row execute function public.criar_perfil();

-- "a pessoa logada é da equipe?"
create or replace function public.eh_equipe() returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.perfis where id = auth.uid() and papel = 'equipe');
$$;

drop policy if exists "ver o próprio perfil" on public.perfis;
create policy "ver o próprio perfil" on public.perfis
  for select to authenticated using (id = auth.uid() or public.eh_equipe());

-- ---------------------------------------------------------------------
-- 2. DOCUMENTOS: tudo o que o programa guarda (progresso do aluno,
--    acervo comum, notícias, comentários, arenas...).
--    Imita o "banco" do claude.ai: cada registro tem um caminho,
--    ex.: data/users/<id-do-aluno>/estado
-- ---------------------------------------------------------------------
create table if not exists public.documentos (
  caminho        text primary key,
  colecao        text not null,
  doc_id         text not null,
  dono           uuid not null default auth.uid() references auth.users(id) on delete cascade,
  dados          jsonb not null default '{}'::jsonb,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);
create index if not exists documentos_colecao on public.documentos (colecao, doc_id);
alter table public.documentos enable row level security;

create or replace function public.tocar_atualizado() returns trigger
language plpgsql as $$ begin new.atualizado_em = now(); new.dono = old.dono; return new; end $$;
drop trigger if exists documentos_tocar on public.documentos;
create trigger documentos_tocar before update on public.documentos
  for each row execute function public.tocar_atualizado();

-- Regras de quem pode ler/escrever cada caminho
create or replace function public.eh_privado(c text) returns boolean
language sql immutable as $$ select c like 'data/users/%' $$;

create or replace function public.dono_do_caminho(c text) returns text
language sql immutable as $$ select split_part(c, '/', 3) $$;

-- conteúdo editorial: só a equipe escreve
create or replace function public.so_equipe_escreve(c text) returns boolean
language sql immutable as $$
  select split_part(c,'/',1) in ('comum','boletim','boletimDest','conceitos','juris','reversa','tesesmed')
      or (split_part(c,'/',1) in ('blog','arenas') and array_length(string_to_array(c,'/'),1) = 2)
$$;

drop policy if exists "ler" on public.documentos;
create policy "ler" on public.documentos for select to authenticated using (
  case when public.eh_privado(caminho)
       then public.dono_do_caminho(caminho) = auth.uid()::text
       else true end
);

drop policy if exists "criar" on public.documentos;
create policy "criar" on public.documentos for insert to authenticated with check (
  dono = auth.uid() and
  case when public.eh_privado(caminho) then public.dono_do_caminho(caminho) = auth.uid()::text
       when public.so_equipe_escreve(caminho) then public.eh_equipe()
       else true end
);

drop policy if exists "alterar" on public.documentos;
create policy "alterar" on public.documentos for update to authenticated using (
  case when public.eh_privado(caminho) then public.dono_do_caminho(caminho) = auth.uid()::text
       when public.so_equipe_escreve(caminho) then public.eh_equipe()
       -- duplas de correção: os dois participantes podem atualizar
       when split_part(caminho,'/',1) = 'duplas'
            then dono = auth.uid() or public.eh_equipe()
              or dados->'a'->>'uid' = auth.uid()::text or dados->'b'->>'uid' = auth.uid()::text
       else dono = auth.uid() or public.eh_equipe() end
);

drop policy if exists "apagar" on public.documentos;
create policy "apagar" on public.documentos for delete to authenticated using (
  case when public.eh_privado(caminho) then public.dono_do_caminho(caminho) = auth.uid()::text
       when public.so_equipe_escreve(caminho) then public.eh_equipe()
       else dono = auth.uid() or public.eh_equipe() end
);

-- ---------------------------------------------------------------------
-- 3. PLANOS, ASSINATURAS e CONSUMO DA IA
--    Só o servidor (com a chave secreta) grava aqui.
--    O aluno só consegue LER as próprias linhas.
-- ---------------------------------------------------------------------
create table if not exists public.planos (
  codigo          text primary key,
  nome            text not null,
  preco_centavos  integer not null default 0,
  cota_geral      integer,            -- chamadas de IA por ciclo (null = ilimitado)
  cota_professor  integer,            -- "Pergunte ao professor" por ciclo (null = ilimitado)
  ativo           boolean not null default true
);
alter table public.planos enable row level security;
drop policy if exists "planos são públicos" on public.planos;
create policy "planos são públicos" on public.planos for select using (true);

-- valores de referência (prompt-backend-mdquest.md). Ajuste à vontade.
-- cota_geral soma geração + correções de cada plano.
insert into public.planos(codigo,nome,preco_centavos,cota_geral,cota_professor) values
  ('basico',        'Básico',         4500,   0,   60),
  ('intermediario', 'Intermediário',  9000, 125,  200),
  ('avancado',      'Avançado',      18000, 135,  500),
  ('preparacao',    'Preparação',    36000, 365, 1500),
  ('teste',         'Teste (interno)',   0,  50,   50),
  ('equipe',        'Equipe',            0, null, null)
on conflict (codigo) do nothing;

create table if not exists public.assinaturas (
  id              bigserial primary key,
  user_id         uuid not null references auth.users(id) on delete cascade,
  plano           text not null references public.planos(codigo),
  status          text not null default 'ativa' check (status in ('ativa','pendente','cancelada','suspensa')),
  ciclo_inicio    date not null default current_date,   -- dia em que o ciclo mensal "vira"
  valida_ate      date,                                  -- null = enquanto ativa
  mp_referencia   text,                                  -- id no Mercado Pago (Fase 1, pagamento)
  criado_em       timestamptz not null default now()
);
create index if not exists assinaturas_user on public.assinaturas(user_id);
alter table public.assinaturas enable row level security;
drop policy if exists "ver as próprias assinaturas" on public.assinaturas;
create policy "ver as próprias assinaturas" on public.assinaturas
  for select to authenticated using (user_id = auth.uid() or public.eh_equipe());

create table if not exists public.consumo_api (
  id             bigserial primary key,
  user_id        uuid not null references auth.users(id) on delete cascade,
  tipo           text not null default 'geral',   -- 'geral' | 'professor'
  modelo         text,
  tokens_entrada integer,
  tokens_saida   integer,
  criado_em      timestamptz not null default now()
);
create index if not exists consumo_user_data on public.consumo_api(user_id, criado_em);
alter table public.consumo_api enable row level security;
drop policy if exists "ver o próprio consumo" on public.consumo_api;
create policy "ver o próprio consumo" on public.consumo_api
  for select to authenticated using (user_id = auth.uid() or public.eh_equipe());

-- Situação da cota de um aluno no ciclo atual (usada pelo servidor)
create or replace function public.situacao_cota(p_user uuid, p_tipo text default 'geral')
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_papel text; a record; v_meses int; v_ini timestamptz; v_lim int; v_usado int;
begin
  select papel into v_papel from perfis where id = p_user;
  if v_papel = 'equipe' then
    return jsonb_build_object('permitido', true, 'plano', 'equipe', 'limite', null, 'usado', 0);
  end if;

  select s.*, p.cota_geral, p.cota_professor into a
    from assinaturas s join planos p on p.codigo = s.plano
   where s.user_id = p_user and s.status = 'ativa'
     and (s.valida_ate is null or s.valida_ate >= current_date)
   order by s.criado_em desc limit 1;

  if a is null then
    return jsonb_build_object('permitido', false, 'motivo', 'sem_plano');
  end if;

  v_meses := (extract(year from age(now(), a.ciclo_inicio)) * 12 + extract(month from age(now(), a.ciclo_inicio)))::int;
  v_ini   := a.ciclo_inicio + make_interval(months => v_meses);
  v_lim   := case when p_tipo = 'professor' then a.cota_professor else a.cota_geral end;

  select count(*) into v_usado from consumo_api
   where user_id = p_user and tipo = p_tipo and criado_em >= v_ini;

  return jsonb_build_object(
    'permitido', v_lim is null or v_usado < v_lim,
    'motivo',    case when v_lim is null or v_usado < v_lim then null else 'cota_esgotada' end,
    'plano',     a.plano, 'limite', v_lim, 'usado', v_usado,
    'renova_em', (v_ini + interval '1 month')::date);
end $$;
revoke all on function public.situacao_cota(uuid, text) from public, anon, authenticated;
grant execute on function public.situacao_cota(uuid, text) to service_role;

-- Versão para o próprio aluno consultar a cota dele
create or replace function public.minha_cota(p_tipo text default 'geral')
returns jsonb language sql stable security definer set search_path = public as $$
  select public.situacao_cota(auth.uid(), p_tipo);
$$;
grant execute on function public.minha_cota(text) to authenticated;

-- ---------------------------------------------------------------------
-- 4. ARQUIVOS (PDFs, pacotes, gravações) — pasta privada "arquivos"
--    Cada aluno tem sua pasta (<id-do-aluno>/...). A pasta "comum/"
--    é lida por todos os alunos e só a equipe grava.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public) values ('arquivos','arquivos', false)
on conflict (id) do nothing;

drop policy if exists "arquivos: ler" on storage.objects;
create policy "arquivos: ler" on storage.objects for select to authenticated using (
  bucket_id = 'arquivos' and ((storage.foldername(name))[1] = auth.uid()::text or (storage.foldername(name))[1] = 'comum'));

drop policy if exists "arquivos: gravar" on storage.objects;
create policy "arquivos: gravar" on storage.objects for insert to authenticated with check (
  bucket_id = 'arquivos' and ((storage.foldername(name))[1] = auth.uid()::text
                              or ((storage.foldername(name))[1] = 'comum' and public.eh_equipe())));

drop policy if exists "arquivos: apagar" on storage.objects;
create policy "arquivos: apagar" on storage.objects for delete to authenticated using (
  bucket_id = 'arquivos' and ((storage.foldername(name))[1] = auth.uid()::text
                              or ((storage.foldername(name))[1] = 'comum' and public.eh_equipe())));

-- ---------------------------------------------------------------------
-- 5. PERMISSÕES (necessárias porque desligamos o "expor tabelas
--    automaticamente"). As regras de linha acima continuam valendo.
-- ---------------------------------------------------------------------
grant select, insert, update, delete on public.documentos to authenticated;
grant select on public.perfis, public.assinaturas, public.consumo_api to authenticated;
grant select on public.planos to anon, authenticated;
grant all on public.perfis, public.documentos, public.planos, public.assinaturas, public.consumo_api to service_role;
grant usage, select on all sequences in schema public to service_role;
