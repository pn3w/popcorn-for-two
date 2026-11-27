-- Popcorn for Two — Supabase schema
-- วิธีใช้: Supabase Dashboard → SQL Editor → New query → วางทั้งไฟล์ → Run (รันซ้ำได้)

-- ---------- tables ----------
create table if not exists public.households (
  id          uuid primary key default gen_random_uuid(),
  name        text not null default 'บ้านเรา',
  invite_code text not null unique default upper(substr(md5(gen_random_uuid()::text), 1, 6)),
  tmdb_key    text,
  omdb_key    text,
  created_at  timestamptz not null default now()
);

create table if not exists public.members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  display_name text not null,
  joined_at    timestamptz not null default now(),
  primary key (household_id, user_id)
);

create table if not exists public.titles (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households(id) on delete cascade,
  tmdb_id       integer not null,
  media_type    text not null check (media_type in ('movie', 'tv')),
  title         text not null,
  year          text,
  poster_path   text,
  status        text not null default 'queue' check (status in ('queue', 'watching', 'done', 'dropped')),
  priority      integer not null default 0,
  season        integer,
  episode       integer not null default 0,
  note          text,
  added_by      uuid default auth.uid() references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (household_id, media_type, tmdb_id)
);

create table if not exists public.reviews (
  title_id     uuid not null references public.titles(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  score        numeric(3,1) check (score >= 0 and score <= 10),
  body         text,
  updated_at   timestamptz not null default now(),
  primary key (title_id, user_id)
);

create index if not exists titles_household_idx  on public.titles(household_id);
create index if not exists reviews_household_idx on public.reviews(household_id);

-- ---------- updated_at ----------
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists titles_touch on public.titles;
create trigger titles_touch before update on public.titles
  for each row execute function public.touch_updated_at();

drop trigger if exists reviews_touch on public.reviews;
create trigger reviews_touch before update on public.reviews
  for each row execute function public.touch_updated_at();

-- ---------- membership helper ----------
create or replace function public.is_member(h uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members m where m.household_id = h and m.user_id = auth.uid());
$$;

-- ---------- row level security ----------
alter table public.households enable row level security;
alter table public.members    enable row level security;
alter table public.titles     enable row level security;
alter table public.reviews    enable row level security;

drop policy if exists "households read"   on public.households;
drop policy if exists "households update" on public.households;
create policy "households read"   on public.households for select to authenticated using (public.is_member(id));
create policy "households update" on public.households for update to authenticated
  using (public.is_member(id)) with check (public.is_member(id));

drop policy if exists "members read"        on public.members;
drop policy if exists "members update self" on public.members;
create policy "members read" on public.members for select to authenticated using (public.is_member(household_id));
create policy "members update self" on public.members for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "titles all" on public.titles;
create policy "titles all" on public.titles for all to authenticated
  using (public.is_member(household_id)) with check (public.is_member(household_id));

drop policy if exists "reviews read"   on public.reviews;
drop policy if exists "reviews insert" on public.reviews;
drop policy if exists "reviews update" on public.reviews;
drop policy if exists "reviews delete" on public.reviews;
create policy "reviews read" on public.reviews for select to authenticated using (public.is_member(household_id));
create policy "reviews insert" on public.reviews for insert to authenticated with check (
  user_id = auth.uid()
  and public.is_member(household_id)
  and exists (select 1 from public.titles t where t.id = title_id and t.household_id = reviews.household_id)
);
create policy "reviews update" on public.reviews for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and public.is_member(household_id));
create policy "reviews delete" on public.reviews for delete to authenticated using (user_id = auth.uid());

-- ---------- create / join a household ----------
create or replace function public.create_household(p_name text, p_display text) returns uuid
language plpgsql security definer set search_path = public as $$
declare h uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  insert into public.households(name) values (coalesce(nullif(trim(p_name), ''), 'บ้านเรา')) returning id into h;
  insert into public.members(household_id, user_id, display_name)
    values (h, auth.uid(), coalesce(nullif(trim(p_display), ''), 'ฉัน'));
  return h;
end $$;

create or replace function public.join_household(p_code text, p_display text) returns uuid
language plpgsql security definer set search_path = public as $$
declare h uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select id into h from public.households where invite_code = upper(trim(p_code));
  if h is null then raise exception 'invite code not found'; end if;
  insert into public.members(household_id, user_id, display_name)
    values (h, auth.uid(), coalesce(nullif(trim(p_display), ''), 'ฉัน'))
    on conflict (household_id, user_id) do update set display_name = excluded.display_name;
  return h;
end $$;

revoke execute on function public.create_household(text, text) from public, anon;
revoke execute on function public.join_household(text, text)   from public, anon;
grant  execute on function public.create_household(text, text) to authenticated;
grant  execute on function public.join_household(text, text)   to authenticated;

-- ---------- realtime (อีกฝั่งเห็นการเปลี่ยนแปลงทันที) ----------
do $$
begin
  begin alter publication supabase_realtime add table public.titles;  exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.reviews; exception when duplicate_object then null; end;
end $$;
