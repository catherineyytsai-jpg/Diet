-- Daily Plate database schema. Run once in Supabase SQL Editor.
-- Real people sign in with Supabase Auth. Every space has a maximum of two members.
create extension if not exists pgcrypto;

create table if not exists public.spaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 40),
  invite_code text not null unique check (char_length(invite_code)=8),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.memberships (
  space_id uuid not null references public.spaces(id) on delete cascade,
  user_id uuid primary key references auth.users(id) on delete cascade,
  slot text not null check (slot in ('a','b')),
  display_name text not null check (char_length(display_name) between 1 and 24),
  daily_goal integer check (daily_goal between 500 and 10000),
  joined_at timestamptz not null default now(),
  unique(space_id,slot)
);
create index if not exists memberships_space_idx on public.memberships(space_id);

create table if not exists public.meals (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  created_by uuid not null references auth.users(id),
  day date not null,
  meal_type text not null check (meal_type in ('breakfast','lunch','dinner','snack')),
  note text not null default '' check (char_length(note)<=500),
  restaurant text not null default '' check (char_length(restaurant)<=100),
  image_path text,
  items jsonb not null default '[]'::jsonb check (jsonb_typeof(items)='array'),
  estimate_meta jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists meals_space_day_idx on public.meals(space_id,day desc);

create or replace function public.is_space_member(p_space_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$ select exists(select 1 from public.memberships m where m.space_id=p_space_id and m.user_id=(select auth.uid())) $$;

revoke all on function public.is_space_member(uuid) from public;
grant execute on function public.is_space_member(uuid) to authenticated;

alter table public.spaces enable row level security;
alter table public.memberships enable row level security;
alter table public.meals enable row level security;

create policy "space_read_for_members" on public.spaces for select to authenticated using (public.is_space_member(id));
create policy "membership_read_for_members" on public.memberships for select to authenticated using (public.is_space_member(space_id));
create policy "membership_edit_own" on public.memberships for update to authenticated using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));
create policy "meals_read_members" on public.meals for select to authenticated using (public.is_space_member(space_id));
create policy "meals_insert_members" on public.meals for insert to authenticated with check (public.is_space_member(space_id) and created_by=(select auth.uid()));
create policy "meals_edit_members" on public.meals for update to authenticated using (public.is_space_member(space_id)) with check (public.is_space_member(space_id));
create policy "meals_delete_members" on public.meals for delete to authenticated using (public.is_space_member(space_id));

-- Explicit API privileges (some Supabase projects no longer auto-grant table access).
grant select on public.spaces to authenticated;
grant select,update on public.memberships to authenticated;
grant select,insert,update,delete on public.meals to authenticated;

-- Members may only change display name / goal; never change identities or room assignments.
revoke update on public.memberships from authenticated;
grant update (display_name,daily_goal) on public.memberships to authenticated;

create or replace function public.create_shared_space(p_space_name text,p_display_name text)
returns table(space_id uuid,invite_code text)
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_code text; v_attempt int;
begin
 if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
 if exists(select 1 from public.memberships where user_id=(select auth.uid())) then raise exception 'This account already belongs to a space'; end if;
 if length(trim(p_space_name)) not between 1 and 40 or length(trim(p_display_name)) not between 1 and 24 then raise exception 'Invalid name'; end if;
 for v_attempt in 1..8 loop
   v_code:=upper(substr(md5(gen_random_uuid()::text),1,8));
   begin
     insert into public.spaces(name,invite_code,created_by) values(trim(p_space_name),v_code,(select auth.uid())) returning id into v_id;
     exit;
   exception when unique_violation then null;
   end;
 end loop;
 if v_id is null then raise exception 'Could not create invite code'; end if;
 insert into public.memberships(space_id,user_id,slot,display_name) values(v_id,(select auth.uid()),'a',trim(p_display_name));
 return query select v_id,v_code;
end; $$;

create or replace function public.join_shared_space(p_invite_code text,p_display_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_count int;
begin
 if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
 if exists(select 1 from public.memberships where user_id=(select auth.uid())) then raise exception 'This account already belongs to a space'; end if;
 if length(trim(p_display_name)) not between 1 and 24 then raise exception 'Invalid name'; end if;
 select id into v_id from public.spaces where invite_code=upper(trim(p_invite_code)) for update;
 if v_id is null then raise exception 'Invalid invite code'; end if;
 select count(*) into v_count from public.memberships where space_id=v_id;
 if v_count>=2 then raise exception 'This space already has two members'; end if;
 insert into public.memberships(space_id,user_id,slot,display_name) values(v_id,(select auth.uid()),'b',trim(p_display_name));
 return v_id;
end; $$;

revoke all on function public.create_shared_space(text,text) from public;
revoke all on function public.join_shared_space(text,text) from public;
grant execute on function public.create_shared_space(text,text) to authenticated;
grant execute on function public.join_shared_space(text,text) to authenticated;

-- An atomic per-user rate limit to protect the OpenAI API key from excessive usage.
create table if not exists public.analysis_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  attempts integer not null default 0,
  primary key(user_id,day)
);
alter table public.analysis_usage enable row level security;
-- No direct read/write policies: only the security-definer function can access it.
create or replace function public.claim_analysis()
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_attempts integer;
begin
 if (select auth.uid()) is null then return false; end if;
 if not exists(select 1 from public.memberships where user_id=(select auth.uid())) then return false; end if;
 insert into public.analysis_usage(user_id,day,attempts) values((select auth.uid()),(now() at time zone 'UTC')::date,1)
 on conflict (user_id,day) do update set attempts=public.analysis_usage.attempts+1
 returning attempts into v_attempts;
 return v_attempts<=20;
end; $$;
revoke all on function public.claim_analysis() from public;
grant execute on function public.claim_analysis() to authenticated;

-- Supabase Storage: private album, image paths must start with the shared space ID.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('meal-photos','meal-photos',false,8388608,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=false,file_size_limit=8388608,allowed_mime_types=array['image/jpeg','image/png','image/webp'];
create policy "photos_read_members" on storage.objects for select to authenticated
 using (bucket_id='meal-photos' and public.is_space_member((storage.foldername(name))[1]::uuid));
create policy "photos_add_members" on storage.objects for insert to authenticated
 with check (bucket_id='meal-photos' and public.is_space_member((storage.foldername(name))[1]::uuid));
create policy "photos_delete_members" on storage.objects for delete to authenticated
 using (bucket_id='meal-photos' and public.is_space_member((storage.foldername(name))[1]::uuid));

-- Optional: enable near-real-time updates on the other person's screen.
-- Supabase normally creates this publication. If it does not exist, skip this line.
alter publication supabase_realtime add table public.meals;
