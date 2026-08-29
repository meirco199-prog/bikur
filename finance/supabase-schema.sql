-- ============================================================
--  סכימת PostgreSQL / Supabase לאפליקציית ניהול ההכנסות וההוצאות
--  ------------------------------------------------------------
--  הסכימה מקבילה 1:1 למבנה הנתונים המקומי (js/core/schema.js).
--  מעבר מ-localStorage: ליצור את הטבלאות, למלא אותן מקובץ הגיבוי,
--  ולהחליף ב-js/core/store.js את השורה
--      export const store = createStore();
--  בשורה
--      export const store = createStore(new SupabaseAdapter({ client, userId }));
--
--  אין טבלה נפרדת לכל חודש. השיוך החודשי הוא עמודה (month) עם אינדקס.
-- ============================================================

create extension if not exists "pgcrypto";

-- ============================================================
--  טיפוסים
-- ============================================================
do $$ begin
  create type space_kind      as enum ('business', 'personal');
  create type direction_kind  as enum ('income', 'expense');
  create type expense_kind    as enum ('fixed', 'variable', 'oneoff');
  create type payment_kind    as enum ('credit', 'standing', 'transfer', 'cash', 'check', 'other');
  create type account_kind    as enum ('checking', 'credit', 'wallet', 'cash', 'savings');
  create type tx_status       as enum ('confirmed', 'pending');
  create type tx_source       as enum ('manual', 'import', 'recurring', 'copy');
  create type match_kind      as enum ('contains', 'exact', 'regex');
  create type import_status   as enum ('review', 'done', 'cancelled');
exception when duplicate_object then null; end $$;

-- ============================================================
--  משתמשים
--  auth.users מנוהל על ידי Supabase; כאן רק פרופיל התצוגה.
-- ============================================================
create table if not exists profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at  timestamptz not null default now()
);

-- ============================================================
--  הגדרות
-- ============================================================
create table if not exists settings (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- ============================================================
--  קטגוריות
-- ============================================================
create table if not exists categories (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references auth.users(id) on delete cascade,
  space                space_kind    not null,
  kind                 direction_kind not null,
  name                 text          not null,
  icon                 text          not null default '📦',
  color                text          not null default '#3b62f0',
  default_expense_type expense_kind,
  "order"              int           not null default 0,
  archived             boolean       not null default false,
  system               boolean       not null default false,
  created_at           timestamptz   not null default now(),
  unique (user_id, space, kind, name)
);
create index if not exists categories_user_idx on categories (user_id, space, kind, "order");

-- ============================================================
--  חשבונות וכרטיסים
--  מאוחסנות 4 ספרות אחרונות בלבד — לא מספר חשבון מלא.
-- ============================================================
create table if not exists accounts (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  name            text not null,
  type            account_kind not null default 'checking',
  space           space_kind not null,
  institution     text,
  last4           char(4),
  color           text not null default '#3b62f0',
  currency        char(3) not null default 'ILS',
  billing_day     smallint check (billing_day between 1 and 28),
  opening_balance numeric(14,2) not null default 0,
  archived        boolean not null default false,
  created_at      timestamptz not null default now(),
  constraint last4_is_digits check (last4 is null or last4 ~ '^[0-9]{4}$')
);
create index if not exists accounts_user_idx on accounts (user_id, space);

-- ============================================================
--  קבוצות ייבוא
-- ============================================================
create table if not exists imports (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  file_name      text,
  file_type      text,
  source         text not null default 'file',
  account_id     uuid references accounts(id) on delete set null,
  period_from    date,
  period_to      date,
  imported_at    timestamptz not null default now(),
  last_sync_at   timestamptz,
  row_count      int not null default 0,
  approved_count int not null default 0,
  review_count   int not null default 0,
  duplicate_count int not null default 0,
  skipped_count  int not null default 0,
  status         import_status not null default 'review',
  source_kept    boolean not null default false
);
create index if not exists imports_user_idx on imports (user_id, imported_at desc);

-- ============================================================
--  תנועות — הטבלה המרכזית
-- ============================================================
create table if not exists transactions (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,

  -- תאריכים ושיוך חודשי
  date              date not null,
  billing_date      date,
  month             char(7) not null,            -- YYYY-MM, לפי תאריך החיוב אם קיים

  -- זיהוי
  name              text not null default '',
  merchant          text not null default '',
  description       text not null default '',
  note              text not null default '',

  -- כספים: הסכום תמיד חיובי; הכיוון נקבע ב-direction
  amount            numeric(14,2) not null check (amount >= 0),
  currency          char(3) not null default 'ILS',
  original_amount   numeric(14,2),
  original_currency char(3),
  direction         direction_kind not null,

  -- שיוך
  space             space_kind not null,
  category_id       uuid references categories(id) on delete set null,
  expense_type      expense_kind,
  payment_method    payment_kind not null default 'credit',
  account_id        uuid references accounts(id) on delete set null,
  card_last4        char(4),

  -- דגלים שמשפיעים על החישוב
  recurring         boolean not null default false,
  auto_copy         boolean not null default false,
  internal_transfer boolean not null default false,   -- לא נספרת בהכנסות/הוצאות
  is_settlement     boolean not null default false,   -- חיוב אשראי מרוכז — לא נספר
  settlement_for    uuid references accounts(id) on delete set null,
  is_refund         boolean not null default false,   -- מקזז את ההוצאה בקטגוריה
  refund_of_id      uuid references transactions(id) on delete set null,

  -- תשלומים
  installment_current smallint,
  installment_total   smallint,
  installment_amount  numeric(14,2),

  -- מקור ובקרה
  source            tx_source not null default 'manual',
  import_id         uuid references imports(id) on delete set null,
  source_file       text,
  external_id       text,
  confidence        smallint not null default 100 check (confidence between 0 and 100),
  status            tx_status not null default 'confirmed',

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint installments_consistent check (
    (installment_current is null and installment_total is null)
    or (installment_current between 1 and installment_total)
  ),
  constraint expense_type_only_for_expenses check (
    direction = 'expense' or expense_type is null
  )
);

-- אינדקסים לשאילתות הדשבורד (חודש + מרחב הן הצירים העיקריים)
create index if not exists tx_user_month_space_idx on transactions (user_id, month, space);
create index if not exists tx_user_date_idx        on transactions (user_id, date desc);
create index if not exists tx_category_idx         on transactions (user_id, category_id, month);
create index if not exists tx_account_idx          on transactions (user_id, account_id, month);
create index if not exists tx_import_idx           on transactions (import_id);
create index if not exists tx_merchant_trgm_idx    on transactions using gin (merchant gin_trgm_ops);

-- מניעת כפילויות ברמת מסד הנתונים: אותו מזהה חיצוני באותו חשבון פעם אחת בלבד
create unique index if not exists tx_external_unique
  on transactions (user_id, account_id, external_id)
  where external_id is not null;

-- ============================================================
--  תקציבים
-- ============================================================
create table if not exists budgets (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  space       space_kind not null,
  category_id uuid not null references categories(id) on delete cascade,
  amount      numeric(14,2) not null check (amount >= 0),
  month       char(7),                       -- null = תקציב ברירת מחדל לכל חודש
  created_at  timestamptz not null default now()
);
-- תקציב אחד לכל קטגוריה לכל חודש (ואחד כללי)
create unique index if not exists budgets_unique
  on budgets (user_id, category_id, coalesce(month, 'default'));

-- ============================================================
--  חוקי סיווג בתי עסק
-- ============================================================
create table if not exists merchant_rules (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  pattern      text not null,
  match_type   match_kind not null default 'contains',
  category_id  uuid references categories(id) on delete cascade,
  space        space_kind,
  direction    direction_kind,
  expense_type expense_kind,
  priority     smallint not null default 50,
  learned      boolean not null default false,
  hits         int not null default 0,
  created_at   timestamptz not null default now()
);
create index if not exists rules_user_idx on merchant_rules (user_id, priority desc);

-- ============================================================
--  מטא-דאטה של חודשים
-- ============================================================
create table if not exists months (
  user_id     uuid not null references auth.users(id) on delete cascade,
  key         char(7) not null,
  closed      boolean not null default false,
  copied_from char(7),
  note        text,
  created_at  timestamptz not null default now(),
  primary key (user_id, key)
);

-- ============================================================
--  קבצים מצורפים (רשות)
-- ============================================================
create table if not exists attachments (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  transaction_id uuid references transactions(id) on delete cascade,
  import_id      uuid references imports(id) on delete cascade,
  storage_path   text not null,
  mime_type      text,
  size_bytes     bigint,
  created_at     timestamptz not null default now()
);

-- ============================================================
--  יומן ביקורת
-- ============================================================
create table if not exists audit_log (
  id        bigserial primary key,
  user_id   uuid not null references auth.users(id) on delete cascade,
  ts        timestamptz not null default now(),
  action    text not null,
  entity    text not null,
  entity_id uuid,
  details   text
);
create index if not exists audit_user_idx on audit_log (user_id, ts desc);

-- ============================================================
--  עדכון updated_at אוטומטי
-- ============================================================
create or replace function touch_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists transactions_touch on transactions;
create trigger transactions_touch before update on transactions
  for each row execute function touch_updated_at();

-- ============================================================
--  אבטחה: הפרדה מלאה בין משתמשים (Row Level Security)
--  כל שורה נגישה אך ורק לבעליה.
-- ============================================================
do $$
declare t text;
begin
  foreach t in array array[
    'profiles','settings','categories','accounts','transactions',
    'budgets','merchant_rules','imports','months','attachments','audit_log'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_owner', t);
    if t = 'profiles' then
      execute format(
        'create policy %I on %I for all using (id = auth.uid()) with check (id = auth.uid())',
        t || '_owner', t);
    else
      execute format(
        'create policy %I on %I for all using (user_id = auth.uid()) with check (user_id = auth.uid())',
        t || '_owner', t);
    end if;
  end loop;
end $$;

-- ============================================================
--  תצוגות עזר — אותם חישובים כמו domain/finance.js, בצד השרת
--  העברות פנימיות וחיובי אשראי מרוכזים אינם נספרים;
--  זיכוי מקזז את ההוצאה.
-- ============================================================
create or replace view monthly_totals as
select
  user_id,
  month,
  space,
  sum(case when direction = 'income'  then (case when is_refund then -amount else amount end) else 0 end) as income,
  sum(case when direction = 'expense' then (case when is_refund then -amount else amount end) else 0 end) as expense,
  sum(case when direction = 'income'  then (case when is_refund then -amount else amount end)
           else -(case when is_refund then -amount else amount end) end)                                  as balance,
  count(*) as tx_count
from transactions
where not internal_transfer
  and not is_settlement
  and status = 'confirmed'
group by user_id, month, space;

create or replace view category_totals as
select
  t.user_id,
  t.month,
  t.space,
  t.category_id,
  c.name as category_name,
  t.direction,
  sum(case when t.is_refund then -t.amount else t.amount end) as amount,
  count(*) as tx_count
from transactions t
left join categories c on c.id = t.category_id
where not t.internal_transfer
  and not t.is_settlement
  and t.status = 'confirmed'
group by t.user_id, t.month, t.space, t.category_id, c.name, t.direction;
