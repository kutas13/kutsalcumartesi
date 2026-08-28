-- Kutsal Cumartesi Kasa - Supabase SQL schema
-- Run once in Supabase > SQL Editor > New query

create extension if not exists pgcrypto;

create table if not exists public.kck_accounts (
  id text primary key,
  name text not null,
  type text not null,
  owner_name text,
  bank_name text,
  iban text,
  total_debt numeric(18,2) not null default 0,
  note text,
  created_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb
);

create table if not exists public.kck_transactions (
  id text primary key,
  type text not null,
  account_id text,
  from_account_id text,
  to_account_id text,
  asset text,
  amount numeric(24,8) not null default 0,
  purpose text,
  transaction_date date,
  created_by text,
  created_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb
);

create table if not exists public.kck_debt_plans (
  id text primary key,
  debt_account_id text not null,
  month text not null,
  due_date date,
  created_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb,
  unique(debt_account_id, month)
);

create table if not exists public.kck_payment_claims (
  id text primary key,
  plan_id text,
  debt_account_id text,
  user_name text not null,
  month text,
  amount numeric(18,2) not null default 0,
  payment_date date,
  status text not null default 'pending',
  approved_by text,
  approved_at timestamptz,
  rejected_at timestamptz,
  created_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb
);

create table if not exists public.kck_notifications (
  id text primary key,
  target_user text not null,
  title text,
  message text,
  is_read boolean not null default false,
  created_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb
);

create table if not exists public.kck_prices (
  key text primary key,
  name text,
  value numeric(24,8) not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.kck_settings (
  id text primary key default 'main',
  debt_due_day integer not null default 5 check (debt_due_day between 1 and 28),
  updated_at timestamptz not null default now()
);

create table if not exists public.kck_passkeys (
  credential_id text primary key,
  user_name text not null,
  public_key text not null,
  counter bigint not null default 0,
  transports jsonb not null default '[]'::jsonb,
  device_type text,
  backed_up boolean not null default false,
  created_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb
);

create index if not exists kck_transactions_account_idx on public.kck_transactions(account_id);
create index if not exists kck_transactions_from_idx on public.kck_transactions(from_account_id);
create index if not exists kck_transactions_to_idx on public.kck_transactions(to_account_id);
create index if not exists kck_transactions_date_idx on public.kck_transactions(transaction_date desc);
create index if not exists kck_claims_status_idx on public.kck_payment_claims(status);
create index if not exists kck_claims_user_idx on public.kck_payment_claims(user_name);
create index if not exists kck_notifications_user_idx on public.kck_notifications(target_user, is_read);
create index if not exists kck_passkeys_user_idx on public.kck_passkeys(user_name);

alter table public.kck_accounts enable row level security;
alter table public.kck_transactions enable row level security;
alter table public.kck_debt_plans enable row level security;
alter table public.kck_payment_claims enable row level security;
alter table public.kck_notifications enable row level security;
alter table public.kck_prices enable row level security;
alter table public.kck_settings enable row level security;
alter table public.kck_passkeys enable row level security;

-- No anon/authenticated policies: browser cannot access financial tables directly.
-- Server uses SUPABASE_SERVICE_ROLE_KEY and bypasses RLS.

create or replace function public.kck_read_state()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'version', 7,
    'accounts', coalesce((select jsonb_agg(payload order by created_at, id) from public.kck_accounts), '[]'::jsonb),
    'transactions', coalesce((select jsonb_agg(payload order by created_at, id) from public.kck_transactions), '[]'::jsonb),
    'debtPlans', coalesce((select jsonb_agg(payload order by created_at, id) from public.kck_debt_plans), '[]'::jsonb),
    'paymentClaims', coalesce((select jsonb_agg(payload order by created_at, id) from public.kck_payment_claims), '[]'::jsonb),
    'notifications', coalesce((select jsonb_agg(payload order by created_at desc, id) from public.kck_notifications), '[]'::jsonb),
    'prices', coalesce((select jsonb_object_agg(key, value) from public.kck_prices), '{}'::jsonb),
    'priceNames', coalesce((select jsonb_object_agg(key, coalesce(name,key)) from public.kck_prices), '{}'::jsonb),
    'settings', jsonb_build_object('debtDueDay', coalesce((select debt_due_day from public.kck_settings where id='main'), 5))
  );
$$;

create or replace function public.kck_replace_state(p_state jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  x jsonb;
  k text;
  v jsonb;
begin
  -- Whole-state replacement is atomic because a PostgreSQL function runs in one transaction.
  delete from public.kck_transactions;
  delete from public.kck_payment_claims;
  delete from public.kck_debt_plans;
  delete from public.kck_notifications;
  delete from public.kck_accounts;
  delete from public.kck_prices;

  for x in select value from jsonb_array_elements(coalesce(p_state->'accounts','[]'::jsonb))
  loop
    insert into public.kck_accounts(id,name,type,owner_name,bank_name,iban,total_debt,note,created_at,payload)
    values(
      x->>'id', coalesce(x->>'name','Hesap'), coalesce(x->>'type','wallet'),
      nullif(x->>'owner',''), nullif(x->>'bankName',''), nullif(x->>'iban',''),
      coalesce(nullif(x->>'totalDebt','')::numeric,0), nullif(x->>'note',''),
      coalesce(nullif(x->>'createdAt','')::timestamptz,now()), x
    );
  end loop;

  for x in select value from jsonb_array_elements(coalesce(p_state->'transactions','[]'::jsonb))
  loop
    insert into public.kck_transactions(id,type,account_id,from_account_id,to_account_id,asset,amount,purpose,transaction_date,created_by,created_at,payload)
    values(
      x->>'id', coalesce(x->>'type','unknown'), nullif(x->>'accountId',''),
      nullif(x->>'fromAccountId',''), nullif(x->>'toAccountId',''), nullif(x->>'asset',''),
      coalesce(nullif(x->>'amount','')::numeric,0), nullif(x->>'purpose',''),
      coalesce(nullif(x->>'date','')::date,current_date), nullif(x->>'createdBy',''),
      coalesce(nullif(x->>'createdAt','')::timestamptz,now()), x
    );
  end loop;

  for x in select value from jsonb_array_elements(coalesce(p_state->'debtPlans','[]'::jsonb))
  loop
    insert into public.kck_debt_plans(id,debt_account_id,month,due_date,created_at,payload)
    values(
      x->>'id', x->>'debtAccountId', x->>'month',
      nullif(x->>'dueDate','')::date,
      coalesce(nullif(x->>'createdAt','')::timestamptz,now()), x
    );
  end loop;

  for x in select value from jsonb_array_elements(coalesce(p_state->'paymentClaims','[]'::jsonb))
  loop
    insert into public.kck_payment_claims(id,plan_id,debt_account_id,user_name,month,amount,payment_date,status,approved_by,approved_at,rejected_at,created_at,payload)
    values(
      x->>'id', nullif(x->>'planId',''), nullif(x->>'debtAccountId',''),
      coalesce(x->>'user',''), nullif(x->>'month',''),
      coalesce(nullif(x->>'amount','')::numeric,0), nullif(x->>'paymentDate','')::date,
      coalesce(nullif(x->>'status',''),'pending'), nullif(x->>'approvedBy',''),
      nullif(x->>'approvedAt','')::timestamptz, nullif(x->>'rejectedAt','')::timestamptz,
      coalesce(nullif(x->>'createdAt','')::timestamptz,now()), x
    );
  end loop;

  for x in select value from jsonb_array_elements(coalesce(p_state->'notifications','[]'::jsonb))
  loop
    insert into public.kck_notifications(id,target_user,title,message,is_read,created_at,payload)
    values(
      x->>'id', coalesce(x->>'targetUser',''), nullif(x->>'title',''), nullif(x->>'message',''),
      coalesce((x->>'read')::boolean,false),
      coalesce(nullif(x->>'createdAt','')::timestamptz,now()), x
    );
  end loop;

  for k,v in select key,value from jsonb_each(coalesce(p_state->'prices','{}'::jsonb))
  loop
    insert into public.kck_prices(key,name,value)
    values(k, coalesce(p_state->'priceNames'->>k,k), coalesce((v #>> '{}')::numeric,0));
  end loop;

  insert into public.kck_settings(id,debt_due_day,updated_at)
  values('main',greatest(1,least(28,coalesce((p_state#>>'{settings,debtDueDay}')::integer,5))),now())
  on conflict(id) do update set debt_due_day=excluded.debt_due_day, updated_at=now();

  return public.kck_read_state();
end;
$$;

revoke all on function public.kck_read_state() from public, anon, authenticated;
revoke all on function public.kck_replace_state(jsonb) from public, anon, authenticated;
grant execute on function public.kck_read_state() to service_role;
grant execute on function public.kck_replace_state(jsonb) to service_role;

insert into public.kck_settings(id,debt_due_day) values('main',5)
on conflict(id) do nothing;
