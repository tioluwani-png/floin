export type Database = {
  public: {
    Tables: {
      businesses: {
        Row: {
          id: string
          user_id: string
          name: string
          type: 'product' | 'service' | 'hybrid'
          currency: string
          channels: string[]
          logo_base64: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          name: string
          type: 'product' | 'service' | 'hybrid'
          currency?: string
          channels?: string[]
          logo_base64?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          name?: string
          type?: 'product' | 'service' | 'hybrid'
          currency?: string
          channels?: string[]
          logo_base64?: string | null
          created_at?: string
        }
      }
      sales_entries: {
        Row: {
          id: string
          business_id: string
          date: string
          channel: string
          units: number
          amount: number
          delivery_fee: number
          note: string | null
          created_at: string
        }
        Insert: {
          id?: string
          business_id: string
          date: string
          channel: string
          units: number
          amount: number
          delivery_fee?: number
          note?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          business_id?: string
          date?: string
          channel?: string
          units?: number
          amount?: number
          delivery_fee?: number
          note?: string | null
          created_at?: string
        }
      }
      expense_months: {
        Row: {
          id: string
          business_id: string
          month_year: string
          production: number
          logistics: number
          marketing: number
          packaging: number
          software: number
          amenities: number
          notes: string | null
          created_at: string
        }
        Insert: {
          id?: string
          business_id: string
          month_year: string
          production?: number
          logistics?: number
          marketing?: number
          packaging?: number
          software?: number
          amenities?: number
          notes?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          business_id?: string
          month_year?: string
          production?: number
          logistics?: number
          marketing?: number
          packaging?: number
          software?: number
          amenities?: number
          notes?: string | null
          created_at?: string
        }
      }
      expense_others: {
        Row: {
          id: string
          expense_month_id: string
          label: string
          amount: number
        }
        Insert: {
          id?: string
          expense_month_id: string
          label: string
          amount: number
        }
        Update: {
          id?: string
          expense_month_id?: string
          label?: string
          amount?: number
        }
      }
      products: {
        Row: {
          id: string
          business_id: string
          name: string
          price: number
          created_at: string
        }
        Insert: {
          id?: string
          business_id: string
          name: string
          price: number
          created_at?: string
        }
        Update: {
          id?: string
          business_id?: string
          name?: string
          price?: number
          created_at?: string
        }
      }
    }
  }
}

// Convenience types
export type Business = Database['public']['Tables']['businesses']['Row']
export type SalesEntry = Database['public']['Tables']['sales_entries']['Row']
export type ExpenseMonth = Database['public']['Tables']['expense_months']['Row']
export type ExpenseOther = Database['public']['Tables']['expense_others']['Row']
export type Product = Database['public']['Tables']['products']['Row']
