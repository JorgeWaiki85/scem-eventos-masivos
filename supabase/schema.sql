-- ============================================================
--  ATENCION DE PACIENTES - Esquema de base de datos (Supabase)
-- ------------------------------------------------------------
--  Ejecutar TODO este archivo en:
--  Supabase -> SQL Editor -> New query -> Run
--  (Se puede ejecutar varias veces sin problema)
-- ============================================================

create extension if not exists "pgcrypto";

-- ============================================================
--  TABLAS
-- ============================================================

create table if not exists public.atenciones (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid references auth.users(id) on delete set null,
  fecha             date,
  hora              text,
  quien_atiende     text,
  nombre            text,
  run               text,
  edad              text,
  domicilio         text,
  fono              text,
  enfermedades_base text,
  medicamentos      text,
  dispositivo       text,
  creado_cliente    timestamptz default now(),
  sincronizado_at   timestamptz default now()
);

alter table public.atenciones add column if not exists tratamiento         text;
alter table public.atenciones add column if not exists motivo_consulta     text;
alter table public.atenciones add column if not exists medicamentos_admin  text;
alter table public.atenciones add column if not exists cargo_atiende       text;
alter table public.atenciones add column if not exists traslado            text;
alter table public.atenciones add column if not exists traslado_lugar      text;
alter table public.atenciones add column if not exists traslado_ambulancia text;
alter table public.atenciones add column if not exists traslado_personal   text;

create table if not exists public.signos (
  id          uuid primary key default gen_random_uuid(),
  atencion_id uuid not null references public.atenciones(id) on delete cascade,
  seccion     text not null default 'signos',
  orden       integer default 0,
  hora        text,
  pa          text,
  fc          text,
  fr          text,
  sat         text,
  egt         text,
  temp        text,
  eva         text,
  cincinnati  text
);

-- ---------- Folio (ID auto-incremental por paciente) ----------
create sequence if not exists public.atenciones_folio_seq;
alter table public.atenciones add column if not exists folio bigint;
update public.atenciones set folio = nextval('public.atenciones_folio_seq') where folio is null;
alter table public.atenciones alter column folio set default nextval('public.atenciones_folio_seq');
create unique index if not exists idx_atenciones_folio on public.atenciones(folio);

-- ---------- Perfiles / Roles ----------
create table if not exists public.perfiles (
  id        uuid primary key references auth.users(id) on delete cascade,
  email     text,
  nombre    text,
  rol       text not null default 'RESCATISTA'
            check (rol in ('ADMINISTRADOR','MEDICO','ENFERMERIA','TENS','RESCATISTA')),
  creado_at timestamptz default now()
);

create index if not exists idx_signos_atencion   on public.signos(atencion_id);
create index if not exists idx_atenciones_creado on public.atenciones(creado_cliente desc);

-- ============================================================
--  ROL DEL USUARIO ACTUAL
-- ============================================================

create or replace function public.mi_rol()
returns text
language sql
security definer
set search_path = public
as $$
  select coalesce((select rol from public.perfiles where id = auth.uid()), 'RESCATISTA');
$$;

grant execute on function public.mi_rol() to authenticated;
grant execute on function public.mi_rol() to anon;

-- ============================================================
--  ALTA AUTOMATICA DE PERFIL (primer usuario = ADMINISTRADOR)
-- ============================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rol   text;
  v_count int;
begin
  select count(*) into v_count from public.perfiles;
  if v_count = 0 then
    v_rol := 'ADMINISTRADOR';
  else
    v_rol := coalesce(new.raw_user_meta_data->>'rol', 'RESCATISTA');
    if v_rol not in ('ADMINISTRADOR','MEDICO','ENFERMERIA','TENS','RESCATISTA') then
      v_rol := 'RESCATISTA';
    end if;
  end if;

  insert into public.perfiles (id, email, nombre, rol)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'nombre', new.email), v_rol)
  on conflict (id) do nothing;

  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Perfiles para usuarios que ya existian
insert into public.perfiles (id, email, nombre, rol)
select u.id,
       u.email,
       coalesce(u.raw_user_meta_data->>'nombre', u.email),
       case when row_number() over (order by u.created_at) = 1
            then 'ADMINISTRADOR' else 'RESCATISTA' end
from auth.users u
where not exists (select 1 from public.perfiles p where p.id = u.id);

-- ============================================================
--  SEGURIDAD POR ROL (RLS)
-- ============================================================

alter table public.atenciones enable row level security;
alter table public.signos     enable row level security;
alter table public.perfiles   enable row level security;

-- ---------- perfiles ----------
drop policy if exists "perfiles_select" on public.perfiles;
create policy "perfiles_select" on public.perfiles
  for select to authenticated using (true);

drop policy if exists "perfiles_insert" on public.perfiles;
create policy "perfiles_insert" on public.perfiles
  for insert to authenticated with check (public.mi_rol() = 'ADMINISTRADOR');

drop policy if exists "perfiles_update" on public.perfiles;
create policy "perfiles_update" on public.perfiles
  for update to authenticated using (public.mi_rol() = 'ADMINISTRADOR');

drop policy if exists "perfiles_delete" on public.perfiles;
create policy "perfiles_delete" on public.perfiles
  for delete to authenticated using (public.mi_rol() = 'ADMINISTRADOR');

-- ---------- atenciones ----------
-- Todos ingresan informacion. ADMINISTRADOR/MEDICO/ENFERMERIA/TENS ven todo.
-- RESCATISTA solo ve lo suyo y no puede editar.
drop policy if exists "atenciones_select" on public.atenciones;
create policy "atenciones_select" on public.atenciones
  for select to authenticated
  using (public.mi_rol() <> 'RESCATISTA' or user_id = auth.uid());

drop policy if exists "atenciones_insert" on public.atenciones;
create policy "atenciones_insert" on public.atenciones
  for insert to authenticated with check (true);

drop policy if exists "atenciones_update" on public.atenciones;
create policy "atenciones_update" on public.atenciones
  for update to authenticated using (public.mi_rol() = 'ADMINISTRADOR');

drop policy if exists "atenciones_delete" on public.atenciones;
create policy "atenciones_delete" on public.atenciones
  for delete to authenticated using (public.mi_rol() = 'ADMINISTRADOR');

-- ---------- signos ----------
drop policy if exists "signos_select" on public.signos;
create policy "signos_select" on public.signos
  for select to authenticated
  using (exists (
    select 1 from public.atenciones a
    where a.id = atencion_id
      and (public.mi_rol() <> 'RESCATISTA' or a.user_id = auth.uid())
  ));

drop policy if exists "signos_insert" on public.signos;
create policy "signos_insert" on public.signos
  for insert to authenticated with check (true);

drop policy if exists "signos_update" on public.signos;
create policy "signos_update" on public.signos
  for update to authenticated using (public.mi_rol() = 'ADMINISTRADOR');

drop policy if exists "signos_delete" on public.signos;
create policy "signos_delete" on public.signos
  for delete to authenticated using (public.mi_rol() = 'ADMINISTRADOR');

-- ============================================================
--  TIEMPO REAL (Realtime)
-- ============================================================
do $$
begin
  begin
    alter publication supabase_realtime add table public.atenciones;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.signos;
  exception when duplicate_object then null;
  end;
end $$;
