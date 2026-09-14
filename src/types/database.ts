export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      audit_logs: {
        Row: {
          action: string
          created_at: string
          entity_id: string | null
          entity_type: string
          id: number
          metadata: Json
          organization_id: string
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: never
          metadata?: Json
          organization_id: string
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: never
          metadata?: Json
          organization_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      brands: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          is_featured_online: boolean
          logo_path: string | null
          name: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          is_featured_online?: boolean
          logo_path?: string | null
          name: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          is_featured_online?: boolean
          logo_path?: string | null
          name?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "brands_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_accounts: {
        Row: {
          created_at: string
          current_balance: number
          id: string
          organization_id: string
          payment_method_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          current_balance?: number
          id?: string
          organization_id: string
          payment_method_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          current_balance?: number
          id?: string
          organization_id?: string
          payment_method_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cash_accounts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_accounts_payment_method_fk"
            columns: ["payment_method_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "payment_methods"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      cash_movements: {
        Row: {
          amount: number
          balance_after: number
          balance_before: number
          cash_account_id: string
          created_at: string
          created_by: string | null
          description: string
          direction: Database["public"]["Enums"]["cash_movement_direction"]
          id: string
          idempotency_key: string
          metadata: Json
          occurred_at: string
          organization_id: string
          reference_id: string | null
          reference_type: string | null
          reverses_movement_id: string | null
          signed_amount: number | null
          transfer_id: string | null
          type: Database["public"]["Enums"]["cash_movement_type"]
        }
        Insert: {
          amount: number
          balance_after: number
          balance_before: number
          cash_account_id: string
          created_at?: string
          created_by?: string | null
          description: string
          direction: Database["public"]["Enums"]["cash_movement_direction"]
          id?: string
          idempotency_key: string
          metadata?: Json
          occurred_at: string
          organization_id: string
          reference_id?: string | null
          reference_type?: string | null
          reverses_movement_id?: string | null
          signed_amount?: number | null
          transfer_id?: string | null
          type: Database["public"]["Enums"]["cash_movement_type"]
        }
        Update: {
          amount?: number
          balance_after?: number
          balance_before?: number
          cash_account_id?: string
          created_at?: string
          created_by?: string | null
          description?: string
          direction?: Database["public"]["Enums"]["cash_movement_direction"]
          id?: string
          idempotency_key?: string
          metadata?: Json
          occurred_at?: string
          organization_id?: string
          reference_id?: string | null
          reference_type?: string | null
          reverses_movement_id?: string | null
          signed_amount?: number | null
          transfer_id?: string | null
          type?: Database["public"]["Enums"]["cash_movement_type"]
        }
        Relationships: [
          {
            foreignKeyName: "cash_movements_account_fk"
            columns: ["cash_account_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "cash_accounts"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "cash_movements_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_movements_reverses_movement_id_fkey"
            columns: ["reverses_movement_id"]
            isOneToOne: false
            referencedRelation: "cash_movements"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_tracking_settings: {
        Row: {
          automatic_closure_enabled_from: string
          created_at: string
          daily_closure_required_from: string
          initialized_at: string
          initialized_by: string
          organization_id: string
          tracking_started_at: string
        }
        Insert: {
          automatic_closure_enabled_from?: string
          created_at?: string
          daily_closure_required_from?: string
          initialized_at?: string
          initialized_by: string
          organization_id: string
          tracking_started_at: string
        }
        Update: {
          automatic_closure_enabled_from?: string
          created_at?: string
          daily_closure_required_from?: string
          initialized_at?: string
          initialized_by?: string
          organization_id?: string
          tracking_started_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cash_tracking_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      categories: {
        Row: {
          created_at: string
          description: string | null
          id: string
          image_path: string | null
          is_active: boolean
          is_featured_online: boolean
          name: string
          organization_id: string
          slug: string
          sort_order: number
          store_description: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          image_path?: string | null
          is_active?: boolean
          is_featured_online?: boolean
          name: string
          organization_id: string
          slug: string
          sort_order?: number
          store_description?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          image_path?: string | null
          is_active?: boolean
          is_featured_online?: boolean
          name?: string
          organization_id?: string
          slug?: string
          sort_order?: number
          store_description?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "categories_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      commission_agents: {
        Row: {
          created_at: string
          created_by: string
          first_name: string
          id: string
          is_active: boolean
          last_name: string
          notes: string | null
          organization_id: string
          phone: string
          route_description: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          first_name: string
          id?: string
          is_active?: boolean
          last_name: string
          notes?: string | null
          organization_id: string
          phone: string
          route_description: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          first_name?: string
          id?: string
          is_active?: boolean
          last_name?: string
          notes?: string | null
          organization_id?: string
          phone?: string
          route_description?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "commission_agents_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          address: string | null
          created_at: string
          email: string | null
          id: string
          is_active: boolean
          is_wholesale: boolean
          name: string
          notes: string | null
          organization_id: string
          phone: string | null
          updated_at: string
          whatsapp: string | null
        }
        Insert: {
          address?: string | null
          created_at?: string
          email?: string | null
          id?: string
          is_active?: boolean
          is_wholesale?: boolean
          name: string
          notes?: string | null
          organization_id: string
          phone?: string | null
          updated_at?: string
          whatsapp?: string | null
        }
        Update: {
          address?: string | null
          created_at?: string
          email?: string | null
          id?: string
          is_active?: boolean
          is_wholesale?: boolean
          name?: string
          notes?: string | null
          organization_id?: string
          phone?: string | null
          updated_at?: string
          whatsapp?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_cash_closure_items: {
        Row: {
          cash_account_id: string
          closure_id: string
          counted_balance: number
          created_at: string
          difference: number
          expected_balance: number
          expense: number
          id: string
          income: number
          opening_balance: number
          organization_id: string
          payment_method_id: string
          payment_method_name: string
          sort_order: number
        }
        Insert: {
          cash_account_id: string
          closure_id: string
          counted_balance: number
          created_at?: string
          difference: number
          expected_balance: number
          expense: number
          id?: string
          income: number
          opening_balance: number
          organization_id: string
          payment_method_id: string
          payment_method_name: string
          sort_order: number
        }
        Update: {
          cash_account_id?: string
          closure_id?: string
          counted_balance?: number
          created_at?: string
          difference?: number
          expected_balance?: number
          expense?: number
          id?: string
          income?: number
          opening_balance?: number
          organization_id?: string
          payment_method_id?: string
          payment_method_name?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "daily_cash_closure_items_account_fk"
            columns: ["cash_account_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "cash_accounts"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "daily_cash_closure_items_closure_fk"
            columns: ["closure_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "daily_cash_closures"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "daily_cash_closure_items_method_fk"
            columns: ["payment_method_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "payment_methods"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "daily_cash_closure_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_cash_closures: {
        Row: {
          absolute_difference_total: number
          business_date: string
          closed_at: string
          closed_by: string | null
          closure_type: string
          counted_total: number
          created_at: string
          difference_total: number
          expected_total: number
          id: string
          notes: string | null
          organization_id: string
          status: string
        }
        Insert: {
          absolute_difference_total: number
          business_date: string
          closed_at?: string
          closed_by?: string | null
          closure_type?: string
          counted_total: number
          created_at?: string
          difference_total: number
          expected_total: number
          id?: string
          notes?: string | null
          organization_id: string
          status: string
        }
        Update: {
          absolute_difference_total?: number
          business_date?: string
          closed_at?: string
          closed_by?: string | null
          closure_type?: string
          counted_total?: number
          created_at?: string
          difference_total?: number
          expected_total?: number
          id?: string
          notes?: string | null
          organization_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_cash_closures_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_compensations: {
        Row: {
          base_salary: number
          commission_percentage: number
          commission_type: Database["public"]["Enums"]["commission_type"]
          created_at: string
          created_by: string | null
          effective_from: string
          effective_to: string | null
          employee_id: string
          id: string
          is_active: boolean
          notes: string | null
          organization_id: string
          updated_at: string
        }
        Insert: {
          base_salary: number
          commission_percentage?: number
          commission_type?: Database["public"]["Enums"]["commission_type"]
          created_at?: string
          created_by?: string | null
          effective_from: string
          effective_to?: string | null
          employee_id: string
          id?: string
          is_active?: boolean
          notes?: string | null
          organization_id: string
          updated_at?: string
        }
        Update: {
          base_salary?: number
          commission_percentage?: number
          commission_type?: Database["public"]["Enums"]["commission_type"]
          created_at?: string
          created_by?: string | null
          effective_from?: string
          effective_to?: string | null
          employee_id?: string
          id?: string
          is_active?: boolean
          notes?: string | null
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_compensations_employee_fk"
            columns: ["employee_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "employee_compensations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      employees: {
        Row: {
          base_salary: number
          created_at: string
          document_number: string | null
          email: string | null
          first_name: string
          hire_date: string | null
          id: string
          last_name: string
          notes: string | null
          organization_id: string
          phone: string | null
          status: Database["public"]["Enums"]["employee_status"]
          updated_at: string
          user_id: string | null
        }
        Insert: {
          base_salary?: number
          created_at?: string
          document_number?: string | null
          email?: string | null
          first_name: string
          hire_date?: string | null
          id?: string
          last_name: string
          notes?: string | null
          organization_id: string
          phone?: string | null
          status?: Database["public"]["Enums"]["employee_status"]
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          base_salary?: number
          created_at?: string
          document_number?: string | null
          email?: string | null
          first_name?: string
          hire_date?: string | null
          id?: string
          last_name?: string
          notes?: string | null
          organization_id?: string
          phone?: string | null
          status?: Database["public"]["Enums"]["employee_status"]
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employees_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      expense_categories: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          is_payroll_advance: boolean
          name: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          is_payroll_advance?: boolean
          name: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          is_payroll_advance?: boolean
          name?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "expense_categories_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      expenses: {
        Row: {
          amount: number
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          category_id: string | null
          created_at: string
          created_by: string | null
          description: string
          expense_date: string
          id: string
          notes: string | null
          organization_id: string
          payment_method_id: string | null
          payroll_employee_id: string | null
          payroll_period_month: string | null
          receipt_path: string | null
          status: string
          updated_at: string
        }
        Insert: {
          amount: number
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          category_id?: string | null
          created_at?: string
          created_by?: string | null
          description: string
          expense_date?: string
          id?: string
          notes?: string | null
          organization_id: string
          payment_method_id?: string | null
          payroll_employee_id?: string | null
          payroll_period_month?: string | null
          receipt_path?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          amount?: number
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          category_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string
          expense_date?: string
          id?: string
          notes?: string | null
          organization_id?: string
          payment_method_id?: string | null
          payroll_employee_id?: string | null
          payroll_period_month?: string | null
          receipt_path?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "expenses_category_fk"
            columns: ["category_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "expense_categories"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "expenses_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_payroll_employee_fk"
            columns: ["payroll_employee_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "expenses_payment_method_fk"
            columns: ["payment_method_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "payment_methods"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      import_batches: {
        Row: {
          completed_at: string | null
          created_at: string
          created_by: string
          file_hash: string
          filename: string
          id: string
          imported_rows: number
          issue_count: number
          organization_id: string
          status: Database["public"]["Enums"]["import_batch_status"]
          summary: Json
          total_rows: number
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          created_by: string
          file_hash: string
          filename: string
          id?: string
          imported_rows?: number
          issue_count?: number
          organization_id: string
          status?: Database["public"]["Enums"]["import_batch_status"]
          summary?: Json
          total_rows: number
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          created_by?: string
          file_hash?: string
          filename?: string
          id?: string
          imported_rows?: number
          issue_count?: number
          organization_id?: string
          status?: Database["public"]["Enums"]["import_batch_status"]
          summary?: Json
          total_rows?: number
        }
        Relationships: [
          {
            foreignKeyName: "import_batches_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      import_issues: {
        Row: {
          batch_id: string
          created_at: string
          field: string | null
          id: number
          message: string
          organization_id: string
          raw_data: Json
          row_number: number
          severity: Database["public"]["Enums"]["import_issue_severity"]
          sku: string | null
        }
        Insert: {
          batch_id: string
          created_at?: string
          field?: string | null
          id?: never
          message: string
          organization_id: string
          raw_data?: Json
          row_number: number
          severity: Database["public"]["Enums"]["import_issue_severity"]
          sku?: string | null
        }
        Update: {
          batch_id?: string
          created_at?: string
          field?: string | null
          id?: never
          message?: string
          organization_id?: string
          raw_data?: Json
          row_number?: number
          severity?: Database["public"]["Enums"]["import_issue_severity"]
          sku?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "import_issues_batch_fk"
            columns: ["batch_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "import_issues_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_movements: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          kind: Database["public"]["Enums"]["inventory_movement_kind"]
          notes: string | null
          occurred_at: string
          organization_id: string
          product_id: string
          quantity_delta: number
          reference_id: string | null
          reference_type: string | null
          unit_cost: number | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          kind: Database["public"]["Enums"]["inventory_movement_kind"]
          notes?: string | null
          occurred_at?: string
          organization_id: string
          product_id: string
          quantity_delta: number
          reference_id?: string | null
          reference_type?: string | null
          unit_cost?: number | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["inventory_movement_kind"]
          notes?: string | null
          occurred_at?: string
          organization_id?: string
          product_id?: string
          quantity_delta?: number
          reference_id?: string | null
          reference_type?: string | null
          unit_cost?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_movements_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_movements_product_fk"
            columns: ["product_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      legacy_sale_import_batches: {
        Row: {
          completed_at: string | null
          created_at: string
          created_by: string | null
          detected_sales: number
          duplicate_sales: number
          error_sales: number
          first_occurred_at: string | null
          id: string
          imported_sales: number
          imported_total: number
          last_occurred_at: string | null
          organization_id: string
          source_file_name: string
          source_file_sha256: string
          source_name: string
          status: string
          summary: Json
          total_rows: number
          warning_count: number
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          detected_sales: number
          duplicate_sales?: number
          error_sales?: number
          first_occurred_at?: string | null
          id?: string
          imported_sales?: number
          imported_total?: number
          last_occurred_at?: string | null
          organization_id: string
          source_file_name: string
          source_file_sha256: string
          source_name: string
          status?: string
          summary?: Json
          total_rows: number
          warning_count?: number
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          detected_sales?: number
          duplicate_sales?: number
          error_sales?: number
          first_occurred_at?: string | null
          id?: string
          imported_sales?: number
          imported_total?: number
          last_occurred_at?: string | null
          organization_id?: string
          source_file_name?: string
          source_file_sha256?: string
          source_name?: string
          status?: string
          summary?: Json
          total_rows?: number
          warning_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "legacy_sale_import_batches_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      legacy_sale_import_issues: {
        Row: {
          batch_id: string
          code: string
          created_at: string
          id: number
          legacy_sale_number: string | null
          message: string
          organization_id: string
          raw_data: Json
          severity: string
          source_row: number | null
        }
        Insert: {
          batch_id: string
          code: string
          created_at?: string
          id?: never
          legacy_sale_number?: string | null
          message: string
          organization_id: string
          raw_data?: Json
          severity: string
          source_row?: number | null
        }
        Update: {
          batch_id?: string
          code?: string
          created_at?: string
          id?: never
          legacy_sale_number?: string | null
          message?: string
          organization_id?: string
          raw_data?: Json
          severity?: string
          source_row?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "legacy_sale_import_issues_batch_fk"
            columns: ["batch_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "legacy_sale_import_batches"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      monthly_sales_goals: {
        Row: {
          created_at: string
          created_by: string
          goal_month: string
          id: string
          organization_id: string
          sales_target: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          goal_month: string
          id?: string
          organization_id: string
          sales_target: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          goal_month?: string
          id?: string
          organization_id?: string
          sales_target?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "monthly_sales_goals_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_members: {
        Row: {
          created_at: string
          is_active: boolean
          organization_id: string
          role: Database["public"]["Enums"]["app_role"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          is_active?: boolean
          organization_id: string
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          is_active?: boolean
          organization_id?: string
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_members_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          created_by: string
          id: string
          name: string
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          name: string
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          name?: string
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      payment_methods: {
        Row: {
          code: string
          created_at: string
          credit_surcharge_percent: number
          debit_surcharge_percent: number
          financial_account_code: string | null
          id: string
          is_active: boolean
          name: string
          organization_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          credit_surcharge_percent?: number
          debit_surcharge_percent?: number
          financial_account_code?: string | null
          id?: string
          is_active?: boolean
          name: string
          organization_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          credit_surcharge_percent?: number
          debit_surcharge_percent?: number
          financial_account_code?: string | null
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_methods_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_movements: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          employee_id: string
          expense_id: string | null
          id: string
          kind: Database["public"]["Enums"]["payroll_movement_kind"]
          notes: string | null
          organization_id: string
          paid_at: string | null
          payment_method_id: string | null
          period_month: string
          settlement_id: string | null
          voided_at: string | null
          voided_by: string | null
          void_reason: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          created_by?: string | null
          employee_id: string
          expense_id?: string | null
          id?: string
          kind: Database["public"]["Enums"]["payroll_movement_kind"]
          notes?: string | null
          organization_id: string
          paid_at?: string | null
          payment_method_id?: string | null
          period_month: string
          settlement_id?: string | null
          voided_at?: string | null
          voided_by?: string | null
          void_reason?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          employee_id?: string
          expense_id?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["payroll_movement_kind"]
          notes?: string | null
          organization_id?: string
          paid_at?: string | null
          payment_method_id?: string | null
          period_month?: string
          settlement_id?: string | null
          voided_at?: string | null
          voided_by?: string | null
          void_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payroll_movements_employee_fk"
            columns: ["employee_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "payroll_movements_expense_fk"
            columns: ["expense_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "expenses"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "payroll_movements_payment_method_fk"
            columns: ["payment_method_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "payment_methods"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "payroll_movements_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_movements_settlement_id_fkey"
            columns: ["settlement_id"]
            isOneToOne: false
            referencedRelation: "payroll_settlements"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_settlement_adjustments: {
        Row: {
          amount: number
          created_at: string
          description: string
          id: string
          kind: Database["public"]["Enums"]["payroll_movement_kind"]
          occurred_on: string
          organization_id: string
          settlement_id: string
          source_movement_id: string | null
          source_type: string
        }
        Insert: {
          amount: number
          created_at?: string
          description: string
          id?: string
          kind: Database["public"]["Enums"]["payroll_movement_kind"]
          occurred_on: string
          organization_id: string
          settlement_id: string
          source_movement_id?: string | null
          source_type?: string
        }
        Update: {
          amount?: number
          created_at?: string
          description?: string
          id?: string
          kind?: Database["public"]["Enums"]["payroll_movement_kind"]
          occurred_on?: string
          organization_id?: string
          settlement_id?: string
          source_movement_id?: string | null
          source_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "payroll_settlement_adjustments_settlement_fk"
            columns: ["settlement_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "payroll_settlements"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "payroll_settlement_adjustments_source_fk"
            columns: ["source_movement_id"]
            isOneToOne: false
            referencedRelation: "payroll_movements"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_settlement_payments: {
        Row: {
          amount: number
          created_at: string
          created_by: string
          id: string
          organization_id: string
          payment_method_id: string
          settlement_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          created_by: string
          id?: string
          organization_id: string
          payment_method_id: string
          settlement_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string
          id?: string
          organization_id?: string
          payment_method_id?: string
          settlement_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payroll_settlement_payments_method_fk"
            columns: ["payment_method_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "payment_methods"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "payroll_settlement_payments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_settlement_payments_settlement_fk"
            columns: ["settlement_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "payroll_settlements"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      payroll_settlements: {
        Row: {
          advance_amount: number
          base_salary: number
          bonus_amount: number
          commission_amount: number
          commission_base: number
          commission_percentage: number
          commission_type: Database["public"]["Enums"]["commission_type"]
          compensation_id: string | null
          created_at: string
          deduction_amount: number
          employee_id: string
          gross_salary: number
          id: string
          notes: string | null
          net_salary: number
          organization_id: string
          paid_at: string | null
          paid_by: string | null
          payment_method: string | null
          payment_method_id: string | null
          period_month: string
          sales_count: number
          settled_at: string
          settled_by: string
          status: Database["public"]["Enums"]["payroll_settlement_status"]
          updated_at: string
          voided_at: string | null
          voided_by: string | null
          void_reason: string | null
        }
        Insert: {
          advance_amount?: number
          base_salary: number
          bonus_amount?: number
          commission_amount: number
          commission_base: number
          commission_percentage: number
          commission_type: Database["public"]["Enums"]["commission_type"]
          compensation_id?: string | null
          created_at?: string
          deduction_amount?: number
          employee_id: string
          gross_salary: number
          id?: string
          notes?: string | null
          net_salary?: number
          organization_id: string
          paid_at?: string | null
          paid_by?: string | null
          payment_method?: string | null
          payment_method_id?: string | null
          period_month: string
          sales_count?: number
          settled_at?: string
          settled_by: string
          status?: Database["public"]["Enums"]["payroll_settlement_status"]
          updated_at?: string
          voided_at?: string | null
          voided_by?: string | null
          void_reason?: string | null
        }
        Update: {
          advance_amount?: number
          base_salary?: number
          bonus_amount?: number
          commission_amount?: number
          commission_base?: number
          commission_percentage?: number
          commission_type?: Database["public"]["Enums"]["commission_type"]
          compensation_id?: string | null
          created_at?: string
          deduction_amount?: number
          employee_id?: string
          gross_salary?: number
          id?: string
          notes?: string | null
          net_salary?: number
          organization_id?: string
          paid_at?: string | null
          paid_by?: string | null
          payment_method?: string | null
          payment_method_id?: string | null
          period_month?: string
          sales_count?: number
          settled_at?: string
          settled_by?: string
          status?: Database["public"]["Enums"]["payroll_settlement_status"]
          updated_at?: string
          voided_at?: string | null
          voided_by?: string | null
          void_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payroll_settlements_compensation_id_fkey"
            columns: ["compensation_id"]
            isOneToOne: false
            referencedRelation: "employee_compensations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_settlements_employee_fk"
            columns: ["employee_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "payroll_settlements_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_settlements_payment_method_fk"
            columns: ["payment_method_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "payment_methods"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      product_images: {
        Row: {
          alt_text: string | null
          created_at: string
          created_by: string | null
          id: string
          is_primary: boolean
          organization_id: string
          product_id: string
          sort_order: number
          storage_path: string
          updated_at: string
        }
        Insert: {
          alt_text?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_primary?: boolean
          organization_id: string
          product_id: string
          sort_order?: number
          storage_path: string
          updated_at?: string
        }
        Update: {
          alt_text?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_primary?: boolean
          organization_id?: string
          product_id?: string
          sort_order?: number
          storage_path?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_images_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_images_product_fk"
            columns: ["product_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      products: {
        Row: {
          barcode: string | null
          brand_id: string | null
          category_id: string | null
          commercial_description: string | null
          cost_price: number
          created_at: string
          current_stock: number
          default_supplier_id: string | null
          description: string | null
          hide_when_out_of_stock: boolean
          id: string
          image_path: string | null
          is_active: boolean
          is_featured: boolean
          is_published: boolean
          min_stock: number
          name: string
          needs_restock: boolean | null
          organization_id: string
          published_at: string | null
          retail_price: number
          seo_description: string | null
          seo_title: string | null
          sku: string
          store_slug: string
          target_stock: number | null
          unit: string
          updated_at: string
          wholesale_min_quantity: number
          wholesale_price: number | null
        }
        Insert: {
          barcode?: string | null
          brand_id?: string | null
          category_id?: string | null
          commercial_description?: string | null
          cost_price?: number
          created_at?: string
          current_stock?: number
          default_supplier_id?: string | null
          description?: string | null
          hide_when_out_of_stock?: boolean
          id?: string
          image_path?: string | null
          is_active?: boolean
          is_featured?: boolean
          is_published?: boolean
          min_stock?: number
          name: string
          needs_restock?: boolean | null
          organization_id: string
          published_at?: string | null
          retail_price?: number
          seo_description?: string | null
          seo_title?: string | null
          sku: string
          store_slug?: string
          target_stock?: number | null
          unit?: string
          updated_at?: string
          wholesale_min_quantity?: number
          wholesale_price?: number | null
        }
        Update: {
          barcode?: string | null
          brand_id?: string | null
          category_id?: string | null
          commercial_description?: string | null
          cost_price?: number
          created_at?: string
          current_stock?: number
          default_supplier_id?: string | null
          description?: string | null
          hide_when_out_of_stock?: boolean
          id?: string
          image_path?: string | null
          is_active?: boolean
          is_featured?: boolean
          is_published?: boolean
          min_stock?: number
          name?: string
          needs_restock?: boolean | null
          organization_id?: string
          published_at?: string | null
          retail_price?: number
          seo_description?: string | null
          seo_title?: string | null
          sku?: string
          store_slug?: string
          target_stock?: number | null
          unit?: string
          updated_at?: string
          wholesale_min_quantity?: number
          wholesale_price?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "products_brand_fk"
            columns: ["brand_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "products_category_fk"
            columns: ["category_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "products_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_supplier_fk"
            columns: ["default_supplier_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      purchase_order_items: {
        Row: {
          created_at: string
          id: string
          organization_id: string
          product_id: string
          purchase_order_id: string
          quantity_ordered: number
          quantity_received: number
          unit_cost: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id: string
          product_id: string
          purchase_order_id: string
          quantity_ordered: number
          quantity_received?: number
          unit_cost?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string
          product_id?: string
          purchase_order_id?: string
          quantity_ordered?: number
          quantity_received?: number
          unit_cost?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_order_items_order_fk"
            columns: ["purchase_order_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "purchase_order_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_items_product_fk"
            columns: ["product_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      purchase_orders: {
        Row: {
          created_at: string
          created_by: string | null
          estimated_total: number
          expected_at: string | null
          id: string
          notes: string | null
          ordered_at: string | null
          organization_id: string
          received_at: string | null
          reference: string | null
          status: Database["public"]["Enums"]["purchase_order_status"]
          supplier_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          estimated_total?: number
          expected_at?: string | null
          id?: string
          notes?: string | null
          ordered_at?: string | null
          organization_id: string
          received_at?: string | null
          reference?: string | null
          status?: Database["public"]["Enums"]["purchase_order_status"]
          supplier_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          estimated_total?: number
          expected_at?: string | null
          id?: string
          notes?: string | null
          ordered_at?: string | null
          organization_id?: string
          received_at?: string | null
          reference?: string | null
          status?: Database["public"]["Enums"]["purchase_order_status"]
          supplier_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_orders_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_supplier_fk"
            columns: ["supplier_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      purchase_receipts: {
        Row: {
          created_at: string
          id: string
          items: Json
          notes: string | null
          organization_id: string
          purchase_order_id: string
          received_by: string
        }
        Insert: {
          created_at?: string
          id?: string
          items: Json
          notes?: string | null
          organization_id: string
          purchase_order_id: string
          received_by: string
        }
        Update: {
          created_at?: string
          id?: string
          items?: Json
          notes?: string | null
          organization_id?: string
          purchase_order_id?: string
          received_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_receipts_order_fk"
            columns: ["purchase_order_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "purchase_receipts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      sale_items: {
        Row: {
          created_at: string
          discount: number
          id: string
          legacy_barcode: string | null
          legacy_payload: Json
          legacy_product_code: string | null
          legacy_product_name: string | null
          line_total: number | null
          organization_id: string
          product_id: string | null
          product_name_snapshot: string
          product_sku_snapshot: string | null
          quantity: number
          sale_id: string
          unit_cost: number | null
          unit_price: number
        }
        Insert: {
          created_at?: string
          discount?: number
          id?: string
          legacy_barcode?: string | null
          legacy_payload?: Json
          legacy_product_code?: string | null
          legacy_product_name?: string | null
          line_total?: number | null
          organization_id: string
          product_id?: string | null
          product_name_snapshot: string
          product_sku_snapshot?: string | null
          quantity: number
          sale_id: string
          unit_cost?: number | null
          unit_price: number
        }
        Update: {
          created_at?: string
          discount?: number
          id?: string
          legacy_barcode?: string | null
          legacy_payload?: Json
          legacy_product_code?: string | null
          legacy_product_name?: string | null
          line_total?: number | null
          organization_id?: string
          product_id?: string | null
          product_name_snapshot?: string
          product_sku_snapshot?: string | null
          quantity?: number
          sale_id?: string
          unit_cost?: number | null
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "sale_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_items_product_fk"
            columns: ["product_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "sale_items_sale_fk"
            columns: ["sale_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      sale_payments: {
        Row: {
          amount: number
          base_amount: number
          card_type: string | null
          created_at: string
          id: string
          organization_id: string
          payment_method_id: string
          sale_id: string
          surcharge_amount: number
          surcharge_percentage: number
        }
        Insert: {
          amount: number
          base_amount: number
          card_type?: string | null
          created_at?: string
          id?: string
          organization_id: string
          payment_method_id: string
          sale_id: string
          surcharge_amount?: number
          surcharge_percentage?: number
        }
        Update: {
          amount?: number
          base_amount?: number
          card_type?: string | null
          created_at?: string
          id?: string
          organization_id?: string
          payment_method_id?: string
          sale_id?: string
          surcharge_amount?: number
          surcharge_percentage?: number
        }
        Relationships: [
          {
            foreignKeyName: "sale_payments_method_fk"
            columns: ["payment_method_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "payment_methods"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "sale_payments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_payments_sale_fk"
            columns: ["sale_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      sales: {
        Row: {
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          created_at: string
          created_by: string | null
          customer_id: string | null
          discount: number
          discount_percent: number | null
          id: string
          import_batch_id: string | null
          item_detail_status: string
          legacy_customer_name: string | null
          legacy_customer_tax_id: string | null
          legacy_document_number: string | null
          legacy_document_type: string | null
          legacy_payload: Json
          legacy_payment_method: string | null
          legacy_point_of_sale: string | null
          legacy_sale_number: string | null
          legacy_seller_name: string | null
          legacy_source_key: string | null
          legacy_source_row: number | null
          legacy_status: string | null
          manual_surcharge: number
          notes: string | null
          occurred_at: string
          organization_id: string
          original_time_known: boolean
          payment_method_id: string | null
          reference: string | null
          rounding_adjustment: number
          source: string
          status: Database["public"]["Enums"]["sale_status"]
          subtotal: number
          surcharge: number
          total: number
          updated_at: string
          vat_10_5: number
          vat_21: number
        }
        Insert: {
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          discount?: number
          discount_percent?: number | null
          id?: string
          import_batch_id?: string | null
          item_detail_status?: string
          legacy_customer_name?: string | null
          legacy_customer_tax_id?: string | null
          legacy_document_number?: string | null
          legacy_document_type?: string | null
          legacy_payload?: Json
          legacy_payment_method?: string | null
          legacy_point_of_sale?: string | null
          legacy_sale_number?: string | null
          legacy_seller_name?: string | null
          legacy_source_key?: string | null
          legacy_source_row?: number | null
          legacy_status?: string | null
          manual_surcharge?: number
          notes?: string | null
          occurred_at?: string
          organization_id: string
          original_time_known?: boolean
          payment_method_id?: string | null
          reference?: string | null
          rounding_adjustment?: number
          source?: string
          status?: Database["public"]["Enums"]["sale_status"]
          subtotal?: number
          surcharge?: number
          total?: number
          updated_at?: string
          vat_10_5?: number
          vat_21?: number
        }
        Update: {
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          discount?: number
          discount_percent?: number | null
          id?: string
          import_batch_id?: string | null
          item_detail_status?: string
          legacy_customer_name?: string | null
          legacy_customer_tax_id?: string | null
          legacy_document_number?: string | null
          legacy_document_type?: string | null
          legacy_payload?: Json
          legacy_payment_method?: string | null
          legacy_point_of_sale?: string | null
          legacy_sale_number?: string | null
          legacy_seller_name?: string | null
          legacy_source_key?: string | null
          legacy_source_row?: number | null
          legacy_status?: string | null
          manual_surcharge?: number
          notes?: string | null
          occurred_at?: string
          organization_id?: string
          original_time_known?: boolean
          payment_method_id?: string | null
          reference?: string | null
          rounding_adjustment?: number
          source?: string
          status?: Database["public"]["Enums"]["sale_status"]
          subtotal?: number
          surcharge?: number
          total?: number
          updated_at?: string
          vat_10_5?: number
          vat_21?: number
        }
        Relationships: [
          {
            foreignKeyName: "sales_customer_fk"
            columns: ["customer_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "sales_import_batch_fk"
            columns: ["import_batch_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "legacy_sale_import_batches"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "sales_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_payment_method_fk"
            columns: ["payment_method_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "payment_methods"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      site_settings: {
        Row: {
          address: string | null
          email: string | null
          homepage_message: string | null
          homepage_title: string
          instagram_url: string | null
          minimum_retail_amount: number
          minimum_wholesale_amount: number | null
          organization_id: string
          shipping_message: string | null
          store_description: string | null
          store_online: boolean
          updated_at: string
          whatsapp: string | null
          whatsapp_prefill: string
          wholesale_visibility: Database["public"]["Enums"]["wholesale_visibility"]
        }
        Insert: {
          address?: string | null
          email?: string | null
          homepage_message?: string | null
          homepage_title?: string
          instagram_url?: string | null
          minimum_retail_amount?: number
          minimum_wholesale_amount?: number | null
          organization_id: string
          shipping_message?: string | null
          store_description?: string | null
          store_online?: boolean
          updated_at?: string
          whatsapp?: string | null
          whatsapp_prefill?: string
          wholesale_visibility?: Database["public"]["Enums"]["wholesale_visibility"]
        }
        Update: {
          address?: string | null
          email?: string | null
          homepage_message?: string | null
          homepage_title?: string
          instagram_url?: string | null
          minimum_retail_amount?: number
          minimum_wholesale_amount?: number | null
          organization_id?: string
          shipping_message?: string | null
          store_description?: string | null
          store_online?: boolean
          updated_at?: string
          whatsapp?: string | null
          whatsapp_prefill?: string
          wholesale_visibility?: Database["public"]["Enums"]["wholesale_visibility"]
        }
        Relationships: [
          {
            foreignKeyName: "site_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      store_banners: {
        Row: {
          created_at: string
          created_by: string | null
          cta_href: string | null
          cta_label: string | null
          id: string
          image_path: string
          is_active: boolean
          organization_id: string
          sort_order: number
          subtitle: string | null
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          cta_href?: string | null
          cta_label?: string | null
          id?: string
          image_path: string
          is_active?: boolean
          organization_id: string
          sort_order?: number
          subtitle?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          cta_href?: string | null
          cta_label?: string | null
          id?: string
          image_path?: string
          is_active?: boolean
          organization_id?: string
          sort_order?: number
          subtitle?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "store_banners_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      store_customer_profiles: {
        Row: {
          address: string | null
          business_name: string | null
          created_at: string
          cuit: string | null
          customer_type: Database["public"]["Enums"]["store_customer_type"]
          email: string
          first_name: string
          last_name: string
          locality: string
          organization_id: string
          phone: string
          province: string
          reviewed_at: string | null
          reviewed_by: string | null
          updated_at: string
          user_id: string
          wholesale_review_notes: string | null
          wholesale_status: Database["public"]["Enums"]["wholesale_account_status"]
        }
        Insert: {
          address?: string | null
          business_name?: string | null
          created_at?: string
          cuit?: string | null
          customer_type?: Database["public"]["Enums"]["store_customer_type"]
          email: string
          first_name: string
          last_name: string
          locality: string
          organization_id: string
          phone: string
          province: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          updated_at?: string
          user_id: string
          wholesale_review_notes?: string | null
          wholesale_status?: Database["public"]["Enums"]["wholesale_account_status"]
        }
        Update: {
          address?: string | null
          business_name?: string | null
          created_at?: string
          cuit?: string | null
          customer_type?: Database["public"]["Enums"]["store_customer_type"]
          email?: string
          first_name?: string
          last_name?: string
          locality?: string
          organization_id?: string
          phone?: string
          province?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          updated_at?: string
          user_id?: string
          wholesale_review_notes?: string | null
          wholesale_status?: Database["public"]["Enums"]["wholesale_account_status"]
        }
        Relationships: [
          {
            foreignKeyName: "store_customer_profiles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          address: string | null
          business_name: string
          contact_name: string | null
          created_at: string
          email: string | null
          id: string
          is_active: boolean
          notes: string | null
          organization_id: string
          phone: string | null
          updated_at: string
          whatsapp: string | null
        }
        Insert: {
          address?: string | null
          business_name: string
          contact_name?: string | null
          created_at?: string
          email?: string | null
          id?: string
          is_active?: boolean
          notes?: string | null
          organization_id: string
          phone?: string | null
          updated_at?: string
          whatsapp?: string | null
        }
        Update: {
          address?: string | null
          business_name?: string
          contact_name?: string | null
          created_at?: string
          email?: string | null
          id?: string
          is_active?: boolean
          notes?: string | null
          organization_id?: string
          phone?: string | null
          updated_at?: string
          whatsapp?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "suppliers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      user_profiles: {
        Row: {
          created_at: string
          display_name: string | null
          email: string | null
          last_login_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          email?: string | null
          last_login_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          email?: string | null
          last_login_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      web_order_items: {
        Row: {
          created_at: string
          id: string
          line_total: number | null
          order_id: string
          organization_id: string
          product_id: string
          product_name: string
          product_sku: string
          quantity: number
          unit_price: number
        }
        Insert: {
          created_at?: string
          id?: string
          line_total?: number | null
          order_id: string
          organization_id: string
          product_id: string
          product_name: string
          product_sku: string
          quantity: number
          unit_price: number
        }
        Update: {
          created_at?: string
          id?: string
          line_total?: number | null
          order_id?: string
          organization_id?: string
          product_id?: string
          product_name?: string
          product_sku?: string
          quantity?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "web_order_items_order_fk"
            columns: ["order_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "web_orders"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "web_order_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "web_order_items_product_fk"
            columns: ["product_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      web_orders: {
        Row: {
          cancelled_at: string | null
          cancelled_by: string | null
          completed_at: string | null
          confirmed_at: string | null
          confirmed_by: string | null
          contacted_at: string | null
          created_at: string
          customer_business_name: string | null
          customer_email: string
          customer_locality: string
          customer_name: string
          customer_phone: string
          customer_province: string
          customer_type: Database["public"]["Enums"]["store_customer_type"]
          customer_user_id: string
          id: string
          idempotency_key: string | null
          minimum_amount: number
          notes: string | null
          order_number: string
          organization_id: string
          payment_card_type: string | null
          payment_method_id: string | null
          payment_surcharge_amount: number | null
          sale_id: string | null
          source: string
          status: Database["public"]["Enums"]["web_order_status"]
          subtotal: number
          total: number
          updated_at: string
        }
        Insert: {
          cancelled_at?: string | null
          cancelled_by?: string | null
          completed_at?: string | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          contacted_at?: string | null
          created_at?: string
          customer_business_name?: string | null
          customer_email: string
          customer_locality: string
          customer_name: string
          customer_phone: string
          customer_province: string
          customer_type: Database["public"]["Enums"]["store_customer_type"]
          customer_user_id: string
          id?: string
          idempotency_key?: string | null
          minimum_amount: number
          notes?: string | null
          order_number?: string
          organization_id: string
          payment_card_type?: string | null
          payment_method_id?: string | null
          payment_surcharge_amount?: number | null
          sale_id?: string | null
          source?: string
          status?: Database["public"]["Enums"]["web_order_status"]
          subtotal: number
          total: number
          updated_at?: string
        }
        Update: {
          cancelled_at?: string | null
          cancelled_by?: string | null
          completed_at?: string | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          contacted_at?: string | null
          created_at?: string
          customer_business_name?: string | null
          customer_email?: string
          customer_locality?: string
          customer_name?: string
          customer_phone?: string
          customer_province?: string
          customer_type?: Database["public"]["Enums"]["store_customer_type"]
          customer_user_id?: string
          id?: string
          idempotency_key?: string | null
          minimum_amount?: number
          notes?: string | null
          order_number?: string
          organization_id?: string
          payment_card_type?: string | null
          payment_method_id?: string | null
          payment_surcharge_amount?: number | null
          sale_id?: string | null
          source?: string
          status?: Database["public"]["Enums"]["web_order_status"]
          subtotal?: number
          total?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "web_orders_payment_method_fk"
            columns: ["payment_method_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "payment_methods"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "web_orders_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "web_orders_sale_fk"
            columns: ["sale_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      add_organization_member_by_email: {
        Args: {
          p_email: string
          p_organization_id: string
          p_role: Database["public"]["Enums"]["app_role"]
        }
        Returns: string
      }
      adjust_inventory: {
        Args: {
          p_adjustment_id?: string
          p_organization_id: string
          p_product_id: string
          p_quantity_delta: number
          p_reason: string
          p_unit_cost?: number
        }
        Returns: string
      }
      can_bootstrap_organization: { Args: never; Returns: boolean }
      cancel_expense: {
        Args: { p_expense_id: string; p_reason: string }
        Returns: string
      }
      cancel_sale: {
        Args: { p_reason: string; p_sale_id: string }
        Returns: string
      }
      close_daily_cash: {
        Args: {
          p_business_date: string
          p_counted_balances: Json
          p_notes?: string
          p_organization_id: string
        }
        Returns: Json
      }
      create_purchase_order: {
        Args: {
          p_expected_at?: string
          p_items: Json
          p_manual_surcharge?: number
          p_notes?: string
          p_ordered_at?: string
          p_organization_id: string
          p_reference?: string
          p_supplier_id: string
        }
        Returns: string
      }
      create_sale: {
        Args: {
          p_customer_id?: string
          p_discount?: number
          p_items: Json
          p_notes?: string
          p_occurred_at?: string
          p_organization_id: string
          p_payment_method_id?: string
          p_reference?: string
        }
        Returns: string
      }
      create_sale_with_payments: {
        Args: {
          p_customer_id?: string
          p_discount?: number
          p_items: Json
          p_manual_surcharge?: number
          p_notes?: string
          p_occurred_at?: string
          p_organization_id: string
          p_payments: Json
          p_reference?: string
        }
        Returns: string
      }
      create_idempotent_sale_with_payments: {
        Args: {
          p_customer_id?: string
          p_discount?: number
          p_idempotency_key: string
          p_items: Json
          p_manual_surcharge?: number
          p_notes?: string
          p_occurred_at?: string
          p_organization_id: string
          p_payments: Json
          p_reference?: string
        }
        Returns: string
      }
      create_web_order: {
        Args: { p_items: Json; p_notes?: string; p_organization_slug: string }
        Returns: Json
      }
      create_web_order_idempotent: {
        Args: {
          p_idempotency_key: string
          p_items: Json
          p_notes?: string
          p_organization_slug: string
        }
        Returns: Json
      }
      confirm_web_order_sale: {
        Args: {
          p_card_type?: string | null
          p_order_id: string
          p_payment_method_id: string
        }
        Returns: Json
      }
      finalize_import_batch: {
        Args: {
          p_batch_id: string
          p_failed?: boolean
          p_imported_rows: number
          p_summary?: Json
        }
        Returns: string
      }
      get_business_analytics: {
        Args: {
          p_category_id?: string
          p_compare_from: string
          p_compare_to: string
          p_created_by?: string
          p_from: string
          p_goal_month: string
          p_organization_id: string
          p_payment_key?: string
          p_product_id?: string
          p_to: string
          p_unassigned_only?: boolean
        }
        Returns: Json
      }
      get_cash_dashboard: {
        Args: {
          p_date_from?: string
          p_date_to?: string
          p_direction?: Database["public"]["Enums"]["cash_movement_direction"]
          p_limit?: number
          p_offset?: number
          p_organization_id: string
          p_payment_method_id?: string
          p_search?: string
          p_type?: Database["public"]["Enums"]["cash_movement_type"]
        }
        Returns: Json
      }
      get_daily_cash_closure_workspace: {
        Args: { p_organization_id: string }
        Returns: Json
      }
      get_payroll_dashboard: {
        Args: {
          p_employee_id?: string
          p_organization_id: string
          p_period_month: string
        }
        Returns: Json
      }
      get_sale_receipt: { Args: { p_sale_id: string }; Returns: Json }
      get_sales_discount_summary: {
        Args: {
          p_category_id?: string
          p_compare_from: string
          p_compare_to: string
          p_created_by?: string
          p_from: string
          p_organization_id: string
          p_payment_key?: string
          p_product_id?: string
          p_to: string
          p_unassigned_only?: boolean
        }
        Returns: Json
      }
      get_store_cart_snapshot: {
        Args: { p_organization_slug: string; p_product_ids: string[] }
        Returns: {
          category_slug: string
          cover_image_path: string
          current_stock: number
          display_price: number
          id: string
          is_available: boolean
          minimum_quantity: number
          name: string
          price_kind: string
          slug: string
          unit: string
          wholesale_available: boolean
        }[]
      }
      get_store_product_metadata: {
        Args: { p_organization_slug: string; p_product_slug: string }
        Returns: {
          seo_description: string
          seo_title: string
        }[]
      }
      initialize_cash_tracking: {
        Args: {
          p_balances: Json
          p_organization_id: string
          p_tracking_started_at: string
        }
        Returns: Json
      }
      list_daily_cash_closures: {
        Args: { p_limit?: number; p_offset?: number; p_organization_id: string }
        Returns: Json
      }
      list_operational_products: {
        Args: { p_organization_id: string }
        Returns: {
          barcode: string
          brand_name: string
          category_id: string
          category_name: string
          current_stock: number
          description: string
          id: string
          is_active: boolean
          min_stock: number
          name: string
          needs_restock: boolean
          retail_price: number
          sku: string
          unit: string
        }[]
      }
      list_operational_sales: {
        Args: {
          p_created_by?: string
          p_from?: string
          p_limit?: number
          p_offset?: number
          p_organization_id: string
          p_search?: string
          p_source?: string
          p_status?: string
          p_to?: string
        }
        Returns: {
          actor_email: string
          actor_name: string
          cancellation_reason: string
          created_by: string
          customer_name: string
          id: string
          item_count: number
          item_detail_status: string
          legacy_sale_number: string
          legacy_seller_name: string
          matching_count: number
          occurred_at: string
          payment_method_name: string
          reference: string
          source: string
          status: Database["public"]["Enums"]["sale_status"]
          total: number
        }[]
      }
      list_organization_members: {
        Args: { p_organization_id: string }
        Returns: {
          created_at: string
          display_name: string
          email: string
          is_active: boolean
          last_login_at: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }[]
      }
      list_store_products: {
        Args: {
          p_availability?: string
          p_brand_id?: string
          p_category_slug?: string
          p_limit?: number
          p_offset?: number
          p_organization_slug?: string
          p_product_slug?: string
          p_search?: string
          p_sort?: string
        }
        Returns: {
          brand_id: string
          brand_name: string
          category_id: string
          category_name: string
          category_slug: string
          cover_image_path: string
          current_stock: number
          description: string
          display_price: number
          id: string
          is_featured: boolean
          is_new: boolean
          minimum_quantity: number
          name: string
          price_kind: string
          retail_price: number
          slug: string
          total_count: number
          unit: string
          wholesale_available: boolean
        }[]
      }
      mark_payroll_settlement_paid: {
        Args: {
          p_notes?: string
          p_organization_id: string
          p_paid_at: string
          p_payment_method: string
          p_settlement_id: string
        }
        Returns: string
      }
      mark_payroll_settlement_paid_v2: {
        Args: {
          p_notes?: string
          p_organization_id: string
          p_paid_at: string
          p_payment_method_id: string
          p_settlement_id: string
        }
        Returns: string
      }
      register_payroll_advance: {
        Args: {
          p_organization_id: string
          p_employee_id: string
          p_period_month: string
          p_amount: number
          p_paid_at: string
          p_payment_method_id: string
          p_notes?: string
        }
        Returns: string
      }
      void_payroll_advance: {
        Args: {
          p_organization_id: string
          p_movement_id: string
          p_reason: string
        }
        Returns: string
      }
      void_payroll_settlement: {
        Args: {
          p_organization_id: string
          p_settlement_id: string
          p_reason: string
        }
        Returns: string
      }
      settle_and_pay_employee_payroll: {
        Args: {
          p_organization_id: string
          p_employee_id: string
          p_period_month: string
          p_paid_at: string
          p_payments: Json
          p_notes?: string
        }
        Returns: string
      }
      mark_payroll_settlement_paid_with_payments: {
        Args: {
          p_notes?: string
          p_organization_id: string
          p_paid_at: string
          p_payments: Json
          p_settlement_id: string
        }
        Returns: string
      }
      receive_purchase_order: {
        Args: {
          p_items: Json
          p_notes?: string
          p_purchase_order_id: string
          p_receipt_id?: string
        }
        Returns: string
      }
      reconcile_cash_account: {
        Args: {
          p_counted_balance: number
          p_occurred_at?: string
          p_organization_id: string
          p_payment_method_id: string
          p_reason: string
        }
        Returns: Json
      }
      record_login: { Args: never; Returns: number }
      record_manual_cash_movement: {
        Args: {
          p_amount: number
          p_concept: string
          p_direction: Database["public"]["Enums"]["cash_movement_direction"]
          p_notes?: string
          p_occurred_at: string
          p_organization_id: string
          p_payment_method_id: string
        }
        Returns: string
      }
      reorder_product_image: {
        Args: { p_direction: number; p_image_id: string }
        Returns: undefined
      }
      request_wholesale_account: {
        Args: never
        Returns: Database["public"]["Enums"]["wholesale_account_status"]
      }
      set_commission_agent_active: {
        Args: { p_id: string; p_is_active: boolean; p_organization_id: string }
        Returns: undefined
      }
      set_employee_compensation: {
        Args: {
          p_base_salary: number
          p_commission_percentage: number
          p_effective_from: string
          p_employee_id: string
          p_notes?: string
          p_organization_id: string
        }
        Returns: string
      }
      set_primary_product_image: {
        Args: { p_image_id: string; p_product_id: string }
        Returns: undefined
      }
      settle_employee_payroll: {
        Args: {
          p_employee_id: string
          p_notes?: string
          p_organization_id: string
          p_period_month: string
        }
        Returns: string
      }
      transfer_cash: {
        Args: {
          p_amount: number
          p_from_payment_method_id: string
          p_notes?: string
          p_occurred_at: string
          p_organization_id: string
          p_to_payment_method_id: string
        }
        Returns: string
      }
      transition_web_order: {
        Args: {
          p_order_id: string
          p_status: Database["public"]["Enums"]["web_order_status"]
        }
        Returns: Json
      }
      update_organization_member: {
        Args: {
          p_is_active: boolean
          p_organization_id: string
          p_role: Database["public"]["Enums"]["app_role"]
          p_user_id: string
        }
        Returns: string
      }
      upsert_commission_agent: {
        Args: {
          p_first_name?: string
          p_id?: string
          p_last_name?: string
          p_notes?: string
          p_organization_id: string
          p_phone?: string
          p_route_description?: string
        }
        Returns: string
      }
    }
    Enums: {
      app_role: "owner" | "admin" | "staff"
      cash_movement_direction: "credit" | "debit"
      cash_movement_type:
        | "initial_balance"
        | "sale"
        | "sale_reversal"
        | "expense"
        | "expense_reversal"
        | "payroll"
        | "transfer"
        | "adjustment"
        | "other_income"
        | "other_expense"
      commission_type: "total_store_sales"
      employee_status: "active" | "inactive"
      import_batch_status:
        | "processing"
        | "completed"
        | "completed_with_issues"
        | "failed"
      import_issue_severity: "warning" | "error"
      inventory_movement_kind:
        | "initial"
        | "purchase"
        | "sale"
        | "adjustment"
        | "return_in"
        | "return_out"
        | "loss"
      payroll_movement_kind: "salary" | "advance" | "bonus" | "deduction"
      payroll_settlement_status: "settled" | "paid"
      purchase_order_status:
        | "draft"
        | "sent"
        | "partial"
        | "received"
        | "cancelled"
      sale_status: "draft" | "completed" | "cancelled"
      store_customer_type: "retail" | "wholesale"
      web_order_status:
        | "pending"
        | "contacted"
        | "confirmed"
        | "preparing"
        | "ready"
        | "completed"
        | "cancelled"
      wholesale_account_status:
        | "not_requested"
        | "pending"
        | "approved"
        | "rejected"
        | "suspended"
      wholesale_visibility: "public" | "registered" | "hidden"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["owner", "admin", "staff"],
      cash_movement_direction: ["credit", "debit"],
      cash_movement_type: [
        "initial_balance",
        "sale",
        "sale_reversal",
        "expense",
        "expense_reversal",
        "payroll",
        "transfer",
        "adjustment",
        "other_income",
        "other_expense",
      ],
      commission_type: ["total_store_sales"],
      employee_status: ["active", "inactive"],
      import_batch_status: [
        "processing",
        "completed",
        "completed_with_issues",
        "failed",
      ],
      import_issue_severity: ["warning", "error"],
      inventory_movement_kind: [
        "initial",
        "purchase",
        "sale",
        "adjustment",
        "return_in",
        "return_out",
        "loss",
      ],
      payroll_movement_kind: ["salary", "advance", "bonus", "deduction"],
      payroll_settlement_status: ["settled", "paid"],
      purchase_order_status: [
        "draft",
        "sent",
        "partial",
        "received",
        "cancelled",
      ],
      sale_status: ["draft", "completed", "cancelled"],
      store_customer_type: ["retail", "wholesale"],
      web_order_status: [
        "pending",
        "contacted",
        "confirmed",
        "preparing",
        "ready",
        "completed",
        "cancelled",
      ],
      wholesale_account_status: [
        "not_requested",
        "pending",
        "approved",
        "rejected",
        "suspended",
      ],
      wholesale_visibility: ["public", "registered", "hidden"],
    },
  },
} as const
