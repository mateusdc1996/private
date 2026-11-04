-- =====================================================================
-- MDQuest · alunos podem ACRESCENTAR ao acervo comum
-- (questões objetivas, subjetivas e aulas da OAB).
-- Só o autor ou a equipe alteram/apagam o que já existe.
-- Catálogos (comum/oab, comum/teses) continuam só da equipe.
-- Cole no SQL Editor do Supabase e clique em "Run".
-- =====================================================================
create or replace function public.so_equipe_escreve(c text) returns boolean
language sql immutable as $$
  select (
           split_part(c,'/',1) in ('comum','boletim','boletimDest','conceitos','juris','reversa','tesesmed')
           and c not like 'comum/questoes/itens/%'
           and c not like 'comum/subjetivas/itens/%'
           and c not like 'comum/oab/aulas/%'
         )
      or (split_part(c,'/',1) in ('blog','arenas') and array_length(string_to_array(c,'/'),1) = 2)
$$;
