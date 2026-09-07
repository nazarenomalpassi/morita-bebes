create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public;

create type public.app_role as enum ('owner', 'admin', 'staff');
create type public.inventory_movement_kind as enum (
  'initial',
  'purchase',
  'sale',
  'adjustment',
  'return_in',
  'return_out',
  'loss'
);
create type public.sale_status as enum ('draft', 'completed', 'cancelled');
create type public.purchase_order_status as enum (
  'draft',
  'sent',
  'partial',
  'received',
  'cancelled'
);
create type public.employee_status as enum ('active', 'inactive');
create type public.payroll_movement_kind as enum (
  'salary',
  'advance',
  'bonus',
  'deduction'
);
create type public.wholesale_visibility as enum (
  'public',
  'registered',
  'hidden'
);

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 2 and 120),
  slug text not null check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organizations_slug_key unique (slug)
);

create table public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null default 'staff',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create index organization_members_user_active_idx
  on public.organization_members (user_id, organization_id)
  where is_active;

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 2 and 100),
  slug text not null check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  description text,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint categories_id_org_unique unique (id, organization_id),
  constraint categories_org_slug_key unique (organization_id, slug)
);

create unique index categories_org_name_key
  on public.categories (organization_id, lower(name));

create table public.brands (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 2 and 100),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint brands_id_org_unique unique (id, organization_id)
);

create unique index brands_org_name_key
  on public.brands (organization_id, lower(name));

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  business_name text not null check (char_length(trim(business_name)) between 2 and 160),
  contact_name text,
  phone text,
  whatsapp text,
  email text,
  address text,
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint suppliers_id_org_unique unique (id, organization_id)
);

create index suppliers_org_active_name_idx
  on public.suppliers (organization_id, business_name)
  where is_active;

create table public.products (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  category_id uuid,
  brand_id uuid,
  default_supplier_id uuid,
  name text not null check (char_length(trim(name)) between 2 and 180),
  sku text not null check (char_length(trim(sku)) between 1 and 80),
  barcode text,
  description text,
  cost_price numeric(14, 2) not null default 0 check (cost_price >= 0),
  retail_price numeric(14, 2) not null default 0 check (retail_price >= 0),
  wholesale_price numeric(14, 2) check (wholesale_price is null or wholesale_price >= 0),
  wholesale_min_quantity numeric(14, 3) not null default 1 check (wholesale_min_quantity > 0),
  current_stock numeric(14, 3) not null default 0,
  min_stock numeric(14, 3) not null default 0 check (min_stock >= 0),
  needs_restock boolean generated always as (current_stock <= min_stock) stored,
  unit text not null default 'unidad',
  image_path text,
  is_active boolean not null default true,
  is_published boolean not null default false,
  is_featured boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint products_id_org_unique unique (id, organization_id),
  constraint products_org_sku_key unique (organization_id, sku),
  constraint products_category_fk foreign key (category_id, organization_id)
    references public.categories(id, organization_id) on delete restrict,
  constraint products_brand_fk foreign key (brand_id, organization_id)
    references public.brands(id, organization_id) on delete restrict,
  constraint products_supplier_fk foreign key (default_supplier_id, organization_id)
    references public.suppliers(id, organization_id) on delete restrict
);

create unique index products_org_barcode_key
  on public.products (organization_id, barcode)
  where barcode is not null;
create index products_org_category_active_idx
  on public.products (organization_id, category_id, name)
  where is_active;
create index products_org_restock_idx
  on public.products (organization_id, default_supplier_id, name)
  where needs_restock and is_active;
create index products_org_published_idx
  on public.products (organization_id, is_featured desc, name)
  where is_published and is_active;

create table public.payment_methods (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 2 and 80),
  code text not null check (code ~ '^[a-z0-9_]+$'),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_methods_id_org_unique unique (id, organization_id),
  constraint payment_methods_org_code_key unique (organization_id, code)
);

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 2 and 160),
  phone text,
  whatsapp text,
  email text,
  address text,
  notes text,
  is_wholesale boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customers_id_org_unique unique (id, organization_id)
);

create index customers_org_active_name_idx
  on public.customers (organization_id, name)
  where is_active;

create table public.sales (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  customer_id uuid,
  payment_method_id uuid,
  reference text,
  status public.sale_status not null default 'draft',
  occurred_at timestamptz not null default now(),
  subtotal numeric(14, 2) not null default 0 check (subtotal >= 0),
  discount numeric(14, 2) not null default 0 check (discount >= 0),
  total numeric(14, 2) not null default 0 check (total >= 0),
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  cancelled_at timestamptz,
  cancelled_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sales_id_org_unique unique (id, organization_id),
  constraint sales_customer_fk foreign key (customer_id, organization_id)
    references public.customers(id, organization_id) on delete restrict,
  constraint sales_payment_method_fk foreign key (payment_method_id, organization_id)
    references public.payment_methods(id, organization_id) on delete restrict,
  constraint sales_total_matches_subtotal_check check (total = subtotal - discount)
);

create unique index sales_org_reference_key
  on public.sales (organization_id, reference)
  where reference is not null;
create index sales_org_occurred_idx
  on public.sales (organization_id, occurred_at desc);
create index sales_org_status_idx
  on public.sales (organization_id, status, occurred_at desc);

create table public.sale_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  sale_id uuid not null,
  product_id uuid not null,
  quantity numeric(14, 3) not null check (quantity > 0),
  unit_price numeric(14, 2) not null check (unit_price >= 0),
  discount numeric(14, 2) not null default 0 check (discount >= 0),
  line_total numeric(14, 2) generated always as ((quantity * unit_price) - discount) stored,
  created_at timestamptz not null default now(),
  constraint sale_items_sale_fk foreign key (sale_id, organization_id)
    references public.sales(id, organization_id) on delete cascade,
  constraint sale_items_product_fk foreign key (product_id, organization_id)
    references public.products(id, organization_id) on delete restrict,
  constraint sale_items_discount_within_total_check check (discount <= quantity * unit_price)
);

create index sale_items_sale_idx on public.sale_items (sale_id);
create index sale_items_product_idx on public.sale_items (organization_id, product_id);

create table public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  product_id uuid not null,
  kind public.inventory_movement_kind not null,
  quantity_delta numeric(14, 3) not null check (quantity_delta <> 0),
  unit_cost numeric(14, 2) check (unit_cost is null or unit_cost >= 0),
  reference_type text,
  reference_id uuid,
  notes text,
  occurred_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint inventory_movements_product_fk foreign key (product_id, organization_id)
    references public.products(id, organization_id) on delete restrict
);

create index inventory_movements_product_occurred_idx
  on public.inventory_movements (organization_id, product_id, occurred_at desc);
create index inventory_movements_reference_idx
  on public.inventory_movements (organization_id, reference_type, reference_id)
  where reference_id is not null;

create table public.expense_categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 2 and 100),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint expense_categories_id_org_unique unique (id, organization_id)
);

create unique index expense_categories_org_name_key
  on public.expense_categories (organization_id, lower(name));

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  category_id uuid,
  payment_method_id uuid,
  description text not null check (char_length(trim(description)) between 2 and 240),
  amount numeric(14, 2) not null check (amount > 0),
  expense_date date not null default current_date,
  receipt_path text,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint expenses_category_fk foreign key (category_id, organization_id)
    references public.expense_categories(id, organization_id) on delete restrict,
  constraint expenses_payment_method_fk foreign key (payment_method_id, organization_id)
    references public.payment_methods(id, organization_id) on delete restrict
);

create index expenses_org_date_idx
  on public.expenses (organization_id, expense_date desc);

create table public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  supplier_id uuid not null,
  reference text,
  status public.purchase_order_status not null default 'draft',
  ordered_at date,
  expected_at date,
  received_at timestamptz,
  estimated_total numeric(14, 2) not null default 0 check (estimated_total >= 0),
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint purchase_orders_id_org_unique unique (id, organization_id),
  constraint purchase_orders_supplier_fk foreign key (supplier_id, organization_id)
    references public.suppliers(id, organization_id) on delete restrict
);

create unique index purchase_orders_org_reference_key
  on public.purchase_orders (organization_id, reference)
  where reference is not null;
create index purchase_orders_org_status_idx
  on public.purchase_orders (organization_id, status, expected_at);

create table public.purchase_order_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  purchase_order_id uuid not null,
  product_id uuid not null,
  quantity_ordered numeric(14, 3) not null check (quantity_ordered > 0),
  quantity_received numeric(14, 3) not null default 0 check (quantity_received >= 0),
  unit_cost numeric(14, 2) not null default 0 check (unit_cost >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint purchase_order_items_order_fk foreign key (purchase_order_id, organization_id)
    references public.purchase_orders(id, organization_id) on delete cascade,
  constraint purchase_order_items_product_fk foreign key (product_id, organization_id)
    references public.products(id, organization_id) on delete restrict,
  constraint purchase_order_items_received_check check (quantity_received <= quantity_ordered),
  constraint purchase_order_items_product_key unique (purchase_order_id, product_id)
);

create index purchase_order_items_product_idx
  on public.purchase_order_items (organization_id, product_id);

create table public.employees (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  first_name text not null check (char_length(trim(first_name)) between 2 and 100),
  last_name text not null check (char_length(trim(last_name)) between 2 and 100),
  document_number text,
  email text,
  phone text,
  hire_date date,
  status public.employee_status not null default 'active',
  base_salary numeric(14, 2) not null default 0 check (base_salary >= 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint employees_id_org_unique unique (id, organization_id)
);

create unique index employees_org_document_key
  on public.employees (organization_id, document_number)
  where document_number is not null;
create index employees_org_status_name_idx
  on public.employees (organization_id, status, last_name, first_name);

create table public.payroll_movements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid not null,
  kind public.payroll_movement_kind not null,
  amount numeric(14, 2) not null check (amount > 0),
  period_month date not null check (period_month = date_trunc('month', period_month)::date),
  paid_at date,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint payroll_movements_employee_fk foreign key (employee_id, organization_id)
    references public.employees(id, organization_id) on delete restrict
);

create index payroll_movements_org_period_idx
  on public.payroll_movements (organization_id, period_month desc, employee_id);

create table public.site_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  whatsapp text,
  email text,
  address text,
  instagram_url text,
  homepage_title text not null default 'Productos que miman',
  homepage_message text,
  wholesale_visibility public.wholesale_visibility not null default 'hidden',
  minimum_wholesale_amount numeric(14, 2)
    check (minimum_wholesale_amount is null or minimum_wholesale_amount >= 0),
  updated_at timestamptz not null default now()
);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index audit_logs_org_created_idx
  on public.audit_logs (organization_id, created_at desc);

create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare
  target_table text;
begin
  foreach target_table in array array[
    'organizations',
    'organization_members',
    'categories',
    'brands',
    'suppliers',
    'products',
    'payment_methods',
    'customers',
    'sales',
    'expense_categories',
    'expenses',
    'purchase_orders',
    'purchase_order_items',
    'employees',
    'site_settings'
  ]
  loop
    execute format(
      'create trigger set_%1$s_updated_at before update on public.%1$I
       for each row execute function private.set_updated_at()',
      target_table
    );
  end loop;
end;
$$;

create function private.add_organization_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.organization_members (organization_id, user_id, role)
  values (new.id, new.created_by, 'owner');

  insert into public.site_settings (organization_id)
  values (new.id);

  insert into public.categories (organization_id, name, slug, sort_order)
  values
    (new.id, 'Pañales', 'panales', 10),
    (new.id, 'Mamaderas', 'mamaderas', 20),
    (new.id, 'Chupetes', 'chupetes', 30),
    (new.id, 'Higiene', 'higiene', 40),
    (new.id, 'Alimentación', 'alimentacion', 50),
    (new.id, 'Juguetes', 'juguetes', 60),
    (new.id, 'Accesorios', 'accesorios', 70),
    (new.id, 'Ropa para bebé', 'ropa-para-bebe', 80),
    (new.id, 'Cuidado personal', 'cuidado-personal', 90),
    (new.id, 'Otros', 'otros', 100);

  insert into public.payment_methods (organization_id, name, code, sort_order)
  values
    (new.id, 'Efectivo', 'cash', 10),
    (new.id, 'Transferencia', 'transfer', 20),
    (new.id, 'Billetera virtual', 'digital_wallet', 30),
    (new.id, 'Cuenta corriente', 'current_account', 40),
    (new.id, 'Otro', 'other', 50);

  insert into public.expense_categories (organization_id, name)
  values
    (new.id, 'Mercadería'),
    (new.id, 'Servicios'),
    (new.id, 'Sueldos'),
    (new.id, 'Impuestos'),
    (new.id, 'Otros');

  return new;
end;
$$;

revoke all on function private.add_organization_owner() from public;

create trigger add_organization_owner
after insert on public.organizations
for each row execute function private.add_organization_owner();

create function private.is_org_member(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members
    where organization_id = target_organization_id
      and user_id = (select auth.uid())
      and is_active
  );
$$;

create function private.has_org_role(
  target_organization_id uuid,
  allowed_roles public.app_role[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members
    where organization_id = target_organization_id
      and user_id = (select auth.uid())
      and is_active
      and role = any(allowed_roles)
  );
$$;

revoke all on function private.is_org_member(uuid) from public;
revoke all on function private.has_org_role(uuid, public.app_role[]) from public;
grant usage on schema private to authenticated;
grant execute on function private.is_org_member(uuid) to authenticated;
grant execute on function private.has_org_role(uuid, public.app_role[]) to authenticated;

create function private.apply_inventory_movement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.products
  set current_stock = current_stock + new.quantity_delta,
      updated_at = now()
  where id = new.product_id
    and organization_id = new.organization_id;

  if not found then
    raise exception 'Product does not belong to the inventory movement organization';
  end if;

  return new;
end;
$$;

revoke all on function private.apply_inventory_movement() from public;

create trigger apply_inventory_movement
after insert on public.inventory_movements
for each row execute function private.apply_inventory_movement();

alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.categories enable row level security;
alter table public.brands enable row level security;
alter table public.suppliers enable row level security;
alter table public.products enable row level security;
alter table public.payment_methods enable row level security;
alter table public.customers enable row level security;
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.expense_categories enable row level security;
alter table public.expenses enable row level security;
alter table public.purchase_orders enable row level security;
alter table public.purchase_order_items enable row level security;
alter table public.employees enable row level security;
alter table public.payroll_movements enable row level security;
alter table public.site_settings enable row level security;
alter table public.audit_logs enable row level security;

create policy "users create organizations"
on public.organizations for insert
to authenticated
with check (created_by = (select auth.uid()));

create policy "members read organizations"
on public.organizations for select
to authenticated
using (
  private.is_org_member(id)
  or created_by = (select auth.uid())
);

create policy "owners and admins update organizations"
on public.organizations for update
to authenticated
using (private.has_org_role(id, array['owner', 'admin']::public.app_role[]))
with check (private.has_org_role(id, array['owner', 'admin']::public.app_role[]));

create policy "owners delete organizations"
on public.organizations for delete
to authenticated
using (private.has_org_role(id, array['owner']::public.app_role[]));

create policy "members read organization memberships"
on public.organization_members for select
to authenticated
using (private.is_org_member(organization_id));

create policy "owners add organization memberships"
on public.organization_members for insert
to authenticated
with check (private.has_org_role(organization_id, array['owner']::public.app_role[]));

create policy "owners update organization memberships"
on public.organization_members for update
to authenticated
using (private.has_org_role(organization_id, array['owner']::public.app_role[]))
with check (private.has_org_role(organization_id, array['owner']::public.app_role[]));

create policy "owners delete organization memberships"
on public.organization_members for delete
to authenticated
using (private.has_org_role(organization_id, array['owner']::public.app_role[]));

create policy "members manage categories"
on public.categories for all
to authenticated
using (private.is_org_member(organization_id))
with check (private.is_org_member(organization_id));

create policy "members manage brands"
on public.brands for all
to authenticated
using (private.is_org_member(organization_id))
with check (private.is_org_member(organization_id));

create policy "members manage suppliers"
on public.suppliers for all
to authenticated
using (private.is_org_member(organization_id))
with check (private.is_org_member(organization_id));

create policy "members manage products"
on public.products for all
to authenticated
using (private.is_org_member(organization_id))
with check (private.is_org_member(organization_id));

create policy "members manage payment methods"
on public.payment_methods for all
to authenticated
using (private.is_org_member(organization_id))
with check (private.is_org_member(organization_id));

create policy "members manage customers"
on public.customers for all
to authenticated
using (private.is_org_member(organization_id))
with check (private.is_org_member(organization_id));

create policy "members manage sales"
on public.sales for all
to authenticated
using (private.is_org_member(organization_id))
with check (private.is_org_member(organization_id));

create policy "members manage sale items"
on public.sale_items for all
to authenticated
using (private.is_org_member(organization_id))
with check (private.is_org_member(organization_id));

create policy "members read inventory movements"
on public.inventory_movements for select
to authenticated
using (private.is_org_member(organization_id));

create policy "members add inventory movements"
on public.inventory_movements for insert
to authenticated
with check (private.is_org_member(organization_id));

create policy "members manage expense categories"
on public.expense_categories for all
to authenticated
using (private.is_org_member(organization_id))
with check (private.is_org_member(organization_id));

create policy "members manage expenses"
on public.expenses for all
to authenticated
using (private.is_org_member(organization_id))
with check (private.is_org_member(organization_id));

create policy "members manage purchase orders"
on public.purchase_orders for all
to authenticated
using (private.is_org_member(organization_id))
with check (private.is_org_member(organization_id));

create policy "members manage purchase order items"
on public.purchase_order_items for all
to authenticated
using (private.is_org_member(organization_id))
with check (private.is_org_member(organization_id));

create policy "owners and admins manage employees"
on public.employees for all
to authenticated
using (private.has_org_role(organization_id, array['owner', 'admin']::public.app_role[]))
with check (private.has_org_role(organization_id, array['owner', 'admin']::public.app_role[]));

create policy "owners and admins manage payroll"
on public.payroll_movements for all
to authenticated
using (private.has_org_role(organization_id, array['owner', 'admin']::public.app_role[]))
with check (private.has_org_role(organization_id, array['owner', 'admin']::public.app_role[]));

create policy "owners and admins manage site settings"
on public.site_settings for all
to authenticated
using (private.has_org_role(organization_id, array['owner', 'admin']::public.app_role[]))
with check (private.has_org_role(organization_id, array['owner', 'admin']::public.app_role[]));

create policy "owners and admins read audit logs"
on public.audit_logs for select
to authenticated
using (private.has_org_role(organization_id, array['owner', 'admin']::public.app_role[]));

grant usage on schema public to authenticated, service_role;

grant select, insert, update, delete on table
  public.organizations,
  public.organization_members,
  public.categories,
  public.brands,
  public.suppliers,
  public.products,
  public.payment_methods,
  public.customers,
  public.sales,
  public.sale_items,
  public.expense_categories,
  public.expenses,
  public.purchase_orders,
  public.purchase_order_items,
  public.employees,
  public.payroll_movements,
  public.site_settings
to authenticated;

grant select, insert on table public.inventory_movements to authenticated;
grant select on table public.audit_logs to authenticated;

grant all privileges on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;
