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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      watchlist: {
        Row: {
          id: number
          coin_id: string
          symbol: string
          name: string
          added_at: string
          added_by: string
          notes: string | null
          active: boolean
        }
        Insert: {
          id?: number
          coin_id: string
          symbol: string
          name: string
          added_at?: string
          added_by?: string
          notes?: string | null
          active?: boolean
        }
        Update: {
          id?: number
          coin_id?: string
          symbol?: string
          name?: string
          added_at?: string
          added_by?: string
          notes?: string | null
          active?: boolean
        }
        Relationships: []
      }
      price_alerts: {
        Row: {
          id: number
          coin_id: string
          symbol: string
          name: string
          alert_type: string
          old_value: string | null
          new_value: string | null
          score: number | null
          price: number | null
          created_at: string
        }
        Insert: {
          id?: number
          coin_id: string
          symbol: string
          name?: string
          alert_type: string
          old_value?: string | null
          new_value?: string | null
          score?: number | null
          price?: number | null
          created_at?: string
        }
        Update: {
          id?: number
          coin_id?: string
          symbol?: string
          name?: string
          alert_type?: string
          old_value?: string | null
          new_value?: string | null
          score?: number | null
          price?: number | null
          created_at?: string
        }
        Relationships: []
      }
      asset_snapshots: {
        Row: {
          coin_id: string
          created_at: string
          days_in_accumulation: number
          explanation: string | null
          id: number
          market_cap: number
          momentum: number
          name: string
          phase: string
          price: number
          price_change_30d: number | null
          price_change_7d: number | null
          score: number
          signal: string
          snapshot_date: string
          sparkline: Json | null
          symbol: string
          volatility: number | null
          volume_24h: number
          volume_change_7d: number | null
        }
        Insert: {
          coin_id: string
          created_at?: string
          days_in_accumulation?: number
          explanation?: string | null
          id?: number
          market_cap: number
          momentum?: number
          name: string
          phase: string
          price: number
          price_change_30d?: number | null
          price_change_7d?: number | null
          score: number
          signal: string
          snapshot_date: string
          sparkline?: Json | null
          symbol: string
          volatility?: number | null
          volume_24h: number
          volume_change_7d?: number | null
        }
        Update: {
          coin_id?: string
          created_at?: string
          days_in_accumulation?: number
          explanation?: string | null
          id?: number
          market_cap?: number
          momentum?: number
          name?: string
          phase?: string
          price?: number
          price_change_30d?: number | null
          price_change_7d?: number | null
          score?: number
          signal?: string
          snapshot_date?: string
          sparkline?: Json | null
          symbol?: string
          volatility?: number | null
          volume_24h?: number
          volume_change_7d?: number | null
        }
        Relationships: []
      }
      scan_runs: {
        Row: {
          assets_qualified: number
          assets_scanned: number
          created_at: string
          duration_ms: number | null
          id: number
          run_date: string
          triggered_by: string
        }
        Insert: {
          assets_qualified: number
          assets_scanned: number
          created_at?: string
          duration_ms?: number | null
          id?: number
          run_date: string
          triggered_by?: string
        }
        Update: {
          assets_qualified?: number
          assets_scanned?: number
          created_at?: string
          duration_ms?: number | null
          id?: number
          run_date?: string
          triggered_by?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
