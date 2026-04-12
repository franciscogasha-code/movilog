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
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      ai_anomalies: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          affected_entities: Json | null
          alert_level: Database["public"]["Enums"]["alert_level"]
          anomaly_type: string
          area: Database["public"]["Enums"]["kpi_area"]
          branch_id: string | null
          created_at: string
          description: string
          first_detected_at: string | null
          id: string
          is_acknowledged: boolean | null
          is_recurring: boolean | null
          occurrence_count: number | null
          severity: Database["public"]["Enums"]["anomaly_severity"]
          supporting_data: Json | null
          title: string
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          affected_entities?: Json | null
          alert_level?: Database["public"]["Enums"]["alert_level"]
          anomaly_type: string
          area: Database["public"]["Enums"]["kpi_area"]
          branch_id?: string | null
          created_at?: string
          description: string
          first_detected_at?: string | null
          id?: string
          is_acknowledged?: boolean | null
          is_recurring?: boolean | null
          occurrence_count?: number | null
          severity?: Database["public"]["Enums"]["anomaly_severity"]
          supporting_data?: Json | null
          title: string
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          affected_entities?: Json | null
          alert_level?: Database["public"]["Enums"]["alert_level"]
          anomaly_type?: string
          area?: Database["public"]["Enums"]["kpi_area"]
          branch_id?: string | null
          created_at?: string
          description?: string
          first_detected_at?: string | null
          id?: string
          is_acknowledged?: boolean | null
          is_recurring?: boolean | null
          occurrence_count?: number | null
          severity?: Database["public"]["Enums"]["anomaly_severity"]
          supporting_data?: Json | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_anomalies_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_recommendations: {
        Row: {
          action_notes: string | null
          actioned_at: string | null
          actioned_by: string | null
          anomaly_id: string | null
          area: Database["public"]["Enums"]["kpi_area"]
          branch_id: string | null
          created_at: string
          description: string
          expected_impact: string | null
          expires_at: string | null
          id: string
          status: Database["public"]["Enums"]["recommendation_status"]
          supporting_data: Json | null
          title: string
        }
        Insert: {
          action_notes?: string | null
          actioned_at?: string | null
          actioned_by?: string | null
          anomaly_id?: string | null
          area: Database["public"]["Enums"]["kpi_area"]
          branch_id?: string | null
          created_at?: string
          description: string
          expected_impact?: string | null
          expires_at?: string | null
          id?: string
          status?: Database["public"]["Enums"]["recommendation_status"]
          supporting_data?: Json | null
          title: string
        }
        Update: {
          action_notes?: string | null
          actioned_at?: string | null
          actioned_by?: string | null
          anomaly_id?: string | null
          area?: Database["public"]["Enums"]["kpi_area"]
          branch_id?: string | null
          created_at?: string
          description?: string
          expected_impact?: string | null
          expires_at?: string | null
          id?: string
          status?: Database["public"]["Enums"]["recommendation_status"]
          supporting_data?: Json | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_recommendations_anomaly_id_fkey"
            columns: ["anomaly_id"]
            isOneToOne: false
            referencedRelation: "ai_anomalies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_recommendations_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      availability_consultations: {
        Row: {
          auto_close_at: string | null
          created_at: string
          created_by: string
          id: string
          product_id: string | null
          requesting_branch_id: string
          status: Database["public"]["Enums"]["consultation_status"]
          updated_at: string
        }
        Insert: {
          auto_close_at?: string | null
          created_at?: string
          created_by: string
          id?: string
          product_id?: string | null
          requesting_branch_id: string
          status?: Database["public"]["Enums"]["consultation_status"]
          updated_at?: string
        }
        Update: {
          auto_close_at?: string | null
          created_at?: string
          created_by?: string
          id?: string
          product_id?: string | null
          requesting_branch_id?: string
          status?: Database["public"]["Enums"]["consultation_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "availability_consultations_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "availability_consultations_requesting_branch_id_fkey"
            columns: ["requesting_branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_deposits: {
        Row: {
          amount: number
          bank_name: string | null
          created_at: string
          deposit_date: string
          driver_id: string
          id: string
          notes: string | null
          receipt_url: string | null
          trip_id: string | null
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          amount: number
          bank_name?: string | null
          created_at?: string
          deposit_date?: string
          driver_id: string
          id?: string
          notes?: string | null
          receipt_url?: string | null
          trip_id?: string | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          amount?: number
          bank_name?: string | null
          created_at?: string
          deposit_date?: string
          driver_id?: string
          id?: string
          notes?: string | null
          receipt_url?: string | null
          trip_id?: string | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bank_deposits_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_deposits_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      branch_request_items: {
        Row: {
          client_address: string | null
          client_name: string | null
          created_at: string
          id: string
          item_purpose: Database["public"]["Enums"]["item_purpose"]
          notes: string | null
          product_id: string
          quantity_accepted: number | null
          quantity_picked: number | null
          quantity_received: number | null
          quantity_requested: number
          quantity_shipped: number | null
          rejection_reason_type:
            | Database["public"]["Enums"]["rejection_reason_type"]
            | null
          request_id: string
        }
        Insert: {
          client_address?: string | null
          client_name?: string | null
          created_at?: string
          id?: string
          item_purpose?: Database["public"]["Enums"]["item_purpose"]
          notes?: string | null
          product_id: string
          quantity_accepted?: number | null
          quantity_picked?: number | null
          quantity_received?: number | null
          quantity_requested: number
          quantity_shipped?: number | null
          rejection_reason_type?:
            | Database["public"]["Enums"]["rejection_reason_type"]
            | null
          request_id: string
        }
        Update: {
          client_address?: string | null
          client_name?: string | null
          created_at?: string
          id?: string
          item_purpose?: Database["public"]["Enums"]["item_purpose"]
          notes?: string | null
          product_id?: string
          quantity_accepted?: number | null
          quantity_picked?: number | null
          quantity_received?: number | null
          quantity_requested?: number
          quantity_shipped?: number | null
          rejection_reason_type?:
            | Database["public"]["Enums"]["rejection_reason_type"]
            | null
          request_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "branch_request_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "branch_request_items_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "branch_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      branch_requests: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          admin_closed_at: string | null
          admin_closed_by: string | null
          bims_invoice_number: string | null
          bims_sale_reference: string | null
          client_address: string | null
          client_name: string | null
          closed_at: string | null
          closed_by: string | null
          courier_billing_mode: string | null
          created_at: string
          created_by: string
          current_custody_holder_id: string | null
          current_location_branch_id: string | null
          delivery_payer: string | null
          delivery_target: Database["public"]["Enums"]["delivery_target"]
          expected_next_event: string | null
          expected_next_event_deadline: string | null
          id: string
          logistic_closed_at: string | null
          logistic_closed_by: string | null
          notes: string | null
          parent_request_id: string | null
          priority: string | null
          rejected_at: string | null
          rejected_by: string | null
          rejection_reason: string | null
          rejection_reason_type:
            | Database["public"]["Enums"]["rejection_reason_type"]
            | null
          request_number: number
          request_type: Database["public"]["Enums"]["request_type"]
          requesting_branch_id: string
          shipping_cost: number | null
          shipping_destination_paid: number | null
          shipping_method: Database["public"]["Enums"]["shipping_method"]
          shipping_origin_paid: number | null
          shipping_paid_by: string | null
          source_branch_id: string
          status: Database["public"]["Enums"]["request_status"]
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          admin_closed_at?: string | null
          admin_closed_by?: string | null
          bims_invoice_number?: string | null
          bims_sale_reference?: string | null
          client_address?: string | null
          client_name?: string | null
          closed_at?: string | null
          closed_by?: string | null
          courier_billing_mode?: string | null
          created_at?: string
          created_by: string
          current_custody_holder_id?: string | null
          current_location_branch_id?: string | null
          delivery_payer?: string | null
          delivery_target?: Database["public"]["Enums"]["delivery_target"]
          expected_next_event?: string | null
          expected_next_event_deadline?: string | null
          id?: string
          logistic_closed_at?: string | null
          logistic_closed_by?: string | null
          notes?: string | null
          parent_request_id?: string | null
          priority?: string | null
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          rejection_reason_type?:
            | Database["public"]["Enums"]["rejection_reason_type"]
            | null
          request_number?: number
          request_type?: Database["public"]["Enums"]["request_type"]
          requesting_branch_id: string
          shipping_cost?: number | null
          shipping_destination_paid?: number | null
          shipping_method?: Database["public"]["Enums"]["shipping_method"]
          shipping_origin_paid?: number | null
          shipping_paid_by?: string | null
          source_branch_id: string
          status?: Database["public"]["Enums"]["request_status"]
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          admin_closed_at?: string | null
          admin_closed_by?: string | null
          bims_invoice_number?: string | null
          bims_sale_reference?: string | null
          client_address?: string | null
          client_name?: string | null
          closed_at?: string | null
          closed_by?: string | null
          courier_billing_mode?: string | null
          created_at?: string
          created_by?: string
          current_custody_holder_id?: string | null
          current_location_branch_id?: string | null
          delivery_payer?: string | null
          delivery_target?: Database["public"]["Enums"]["delivery_target"]
          expected_next_event?: string | null
          expected_next_event_deadline?: string | null
          id?: string
          logistic_closed_at?: string | null
          logistic_closed_by?: string | null
          notes?: string | null
          parent_request_id?: string | null
          priority?: string | null
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          rejection_reason_type?:
            | Database["public"]["Enums"]["rejection_reason_type"]
            | null
          request_number?: number
          request_type?: Database["public"]["Enums"]["request_type"]
          requesting_branch_id?: string
          shipping_cost?: number | null
          shipping_destination_paid?: number | null
          shipping_method?: Database["public"]["Enums"]["shipping_method"]
          shipping_origin_paid?: number | null
          shipping_paid_by?: string | null
          source_branch_id?: string
          status?: Database["public"]["Enums"]["request_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "branch_requests_current_location_branch_id_fkey"
            columns: ["current_location_branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "branch_requests_parent_request_id_fkey"
            columns: ["parent_request_id"]
            isOneToOne: false
            referencedRelation: "branch_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "branch_requests_requesting_branch_id_fkey"
            columns: ["requesting_branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "branch_requests_shipping_paid_by_fkey"
            columns: ["shipping_paid_by"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "branch_requests_source_branch_id_fkey"
            columns: ["source_branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      branches: {
        Row: {
          address: string | null
          city: string | null
          code: string
          created_at: string
          id: string
          is_active: boolean | null
          is_central_warehouse: boolean | null
          name: string
          phone: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          city?: string | null
          code: string
          created_at?: string
          id?: string
          is_active?: boolean | null
          is_central_warehouse?: boolean | null
          name: string
          phone?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          city?: string | null
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean | null
          is_central_warehouse?: boolean | null
          name?: string
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      committed_stock: {
        Row: {
          branch_id: string
          branch_request_id: string | null
          created_at: string
          created_by: string
          expires_at: string | null
          fulfillment_order_id: string | null
          id: string
          is_expired: boolean | null
          product_id: string
          quantity: number
          release_reason: string | null
          released_at: string | null
          released_by: string | null
          reserve_reason: Database["public"]["Enums"]["reserve_reason"]
          reserve_type: Database["public"]["Enums"]["reserve_type"]
          updated_at: string
        }
        Insert: {
          branch_id: string
          branch_request_id?: string | null
          created_at?: string
          created_by: string
          expires_at?: string | null
          fulfillment_order_id?: string | null
          id?: string
          is_expired?: boolean | null
          product_id: string
          quantity: number
          release_reason?: string | null
          released_at?: string | null
          released_by?: string | null
          reserve_reason: Database["public"]["Enums"]["reserve_reason"]
          reserve_type?: Database["public"]["Enums"]["reserve_type"]
          updated_at?: string
        }
        Update: {
          branch_id?: string
          branch_request_id?: string | null
          created_at?: string
          created_by?: string
          expires_at?: string | null
          fulfillment_order_id?: string | null
          id?: string
          is_expired?: boolean | null
          product_id?: string
          quantity?: number
          release_reason?: string | null
          released_at?: string | null
          released_by?: string | null
          reserve_reason?: Database["public"]["Enums"]["reserve_reason"]
          reserve_type?: Database["public"]["Enums"]["reserve_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "committed_stock_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "committed_stock_branch_request_id_fkey"
            columns: ["branch_request_id"]
            isOneToOne: false
            referencedRelation: "branch_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "committed_stock_fulfillment_order_id_fkey"
            columns: ["fulfillment_order_id"]
            isOneToOne: false
            referencedRelation: "fulfillment_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "committed_stock_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      consultation_messages: {
        Row: {
          consultation_id: string
          created_at: string
          id: string
          message: string
          sender_id: string
        }
        Insert: {
          consultation_id: string
          created_at?: string
          id?: string
          message: string
          sender_id: string
        }
        Update: {
          consultation_id?: string
          created_at?: string
          id?: string
          message?: string
          sender_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "consultation_messages_consultation_id_fkey"
            columns: ["consultation_id"]
            isOneToOne: false
            referencedRelation: "availability_consultations"
            referencedColumns: ["id"]
          },
        ]
      }
      consultation_products: {
        Row: {
          consultation_id: string
          created_at: string
          id: string
          notes: string | null
          product_id: string
        }
        Insert: {
          consultation_id: string
          created_at?: string
          id?: string
          notes?: string | null
          product_id: string
        }
        Update: {
          consultation_id?: string
          created_at?: string
          id?: string
          notes?: string | null
          product_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "consultation_products_consultation_id_fkey"
            columns: ["consultation_id"]
            isOneToOne: false
            referencedRelation: "availability_consultations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consultation_products_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      consultation_requests: {
        Row: {
          branch_request_id: string
          consultation_id: string
          created_at: string
          id: string
        }
        Insert: {
          branch_request_id: string
          consultation_id: string
          created_at?: string
          id?: string
        }
        Update: {
          branch_request_id?: string
          consultation_id?: string
          created_at?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "consultation_requests_branch_request_id_fkey"
            columns: ["branch_request_id"]
            isOneToOne: false
            referencedRelation: "branch_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consultation_requests_consultation_id_fkey"
            columns: ["consultation_id"]
            isOneToOne: false
            referencedRelation: "availability_consultations"
            referencedColumns: ["id"]
          },
        ]
      }
      consultation_targets: {
        Row: {
          branch_id: string
          consultation_id: string
          created_at: string
          id: string
          responded_at: string | null
          responded_by: string | null
          response_colors: string | null
          response_note: string | null
          response_quantity: number | null
        }
        Insert: {
          branch_id: string
          consultation_id: string
          created_at?: string
          id?: string
          responded_at?: string | null
          responded_by?: string | null
          response_colors?: string | null
          response_note?: string | null
          response_quantity?: number | null
        }
        Update: {
          branch_id?: string
          consultation_id?: string
          created_at?: string
          id?: string
          responded_at?: string | null
          responded_by?: string | null
          response_colors?: string | null
          response_note?: string | null
          response_quantity?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "consultation_targets_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consultation_targets_consultation_id_fkey"
            columns: ["consultation_id"]
            isOneToOne: false
            referencedRelation: "availability_consultations"
            referencedColumns: ["id"]
          },
        ]
      }
      deposit_collection_links: {
        Row: {
          amount: number
          collection_id: string
          created_at: string
          deposit_id: string
          id: string
        }
        Insert: {
          amount: number
          collection_id: string
          created_at?: string
          deposit_id: string
          id?: string
        }
        Update: {
          amount?: number
          collection_id?: string
          created_at?: string
          deposit_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "deposit_collection_links_collection_id_fkey"
            columns: ["collection_id"]
            isOneToOne: false
            referencedRelation: "driver_collections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deposit_collection_links_deposit_id_fkey"
            columns: ["deposit_id"]
            isOneToOne: false
            referencedRelation: "bank_deposits"
            referencedColumns: ["id"]
          },
        ]
      }
      directed_inventories: {
        Row: {
          assigned_to: string | null
          branch_id: string
          completed_at: string | null
          completed_by: string | null
          created_at: string
          data_source: string | null
          description: string | null
          id: string
          inventory_scope: string | null
          notes: string | null
          reviewed_by: string | null
          scheduled_date: string | null
          scope_filter: Json | null
          started_at: string | null
          status: Database["public"]["Enums"]["directed_inventory_status"]
          title: string
          updated_at: string
          upload_file_url: string | null
        }
        Insert: {
          assigned_to?: string | null
          branch_id: string
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          data_source?: string | null
          description?: string | null
          id?: string
          inventory_scope?: string | null
          notes?: string | null
          reviewed_by?: string | null
          scheduled_date?: string | null
          scope_filter?: Json | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["directed_inventory_status"]
          title: string
          updated_at?: string
          upload_file_url?: string | null
        }
        Update: {
          assigned_to?: string | null
          branch_id?: string
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          data_source?: string | null
          description?: string | null
          id?: string
          inventory_scope?: string | null
          notes?: string | null
          reviewed_by?: string | null
          scheduled_date?: string | null
          scope_filter?: Json | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["directed_inventory_status"]
          title?: string
          updated_at?: string
          upload_file_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "directed_inventories_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      directed_inventory_items: {
        Row: {
          counted_at: string | null
          counted_by: string | null
          counted_quantity: number | null
          created_at: string
          difference: number | null
          expected_quantity: number | null
          id: string
          inventory_id: string
          notes: string | null
          product_id: string
        }
        Insert: {
          counted_at?: string | null
          counted_by?: string | null
          counted_quantity?: number | null
          created_at?: string
          difference?: number | null
          expected_quantity?: number | null
          id?: string
          inventory_id: string
          notes?: string | null
          product_id: string
        }
        Update: {
          counted_at?: string | null
          counted_by?: string | null
          counted_quantity?: number | null
          created_at?: string
          difference?: number | null
          expected_quantity?: number | null
          id?: string
          inventory_id?: string
          notes?: string | null
          product_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "directed_inventory_items_inventory_id_fkey"
            columns: ["inventory_id"]
            isOneToOne: false
            referencedRelation: "directed_inventories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "directed_inventory_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_collections: {
        Row: {
          amount: number
          check_number: string | null
          client_name: string | null
          created_at: string
          driver_id: string
          fulfillment_order_id: string | null
          id: string
          notes: string | null
          payment_method: string
          transfer_reference: string | null
          trip_id: string
        }
        Insert: {
          amount: number
          check_number?: string | null
          client_name?: string | null
          created_at?: string
          driver_id: string
          fulfillment_order_id?: string | null
          id?: string
          notes?: string | null
          payment_method?: string
          transfer_reference?: string | null
          trip_id: string
        }
        Update: {
          amount?: number
          check_number?: string | null
          client_name?: string | null
          created_at?: string
          driver_id?: string
          fulfillment_order_id?: string | null
          id?: string
          notes?: string | null
          payment_method?: string
          transfer_reference?: string | null
          trip_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "driver_collections_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driver_collections_fulfillment_order_id_fkey"
            columns: ["fulfillment_order_id"]
            isOneToOne: false
            referencedRelation: "fulfillment_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driver_collections_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_settlements: {
        Row: {
          admin_deposit_instruction: string | null
          admin_deposit_proof_url: string | null
          advance_amount: number | null
          advance_reconciled: boolean | null
          created_at: string
          documents_returned: Json | null
          driver_id: string
          id: string
          net_amount: number | null
          notes: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string | null
          total_collections: number | null
          total_fuel: number | null
          total_other_expenses: number | null
          total_per_diem: number | null
          trip_id: string
          updated_at: string
        }
        Insert: {
          admin_deposit_instruction?: string | null
          admin_deposit_proof_url?: string | null
          advance_amount?: number | null
          advance_reconciled?: boolean | null
          created_at?: string
          documents_returned?: Json | null
          driver_id: string
          id?: string
          net_amount?: number | null
          notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string | null
          total_collections?: number | null
          total_fuel?: number | null
          total_other_expenses?: number | null
          total_per_diem?: number | null
          trip_id: string
          updated_at?: string
        }
        Update: {
          admin_deposit_instruction?: string | null
          admin_deposit_proof_url?: string | null
          advance_amount?: number | null
          advance_reconciled?: boolean | null
          created_at?: string
          documents_returned?: Json | null
          driver_id?: string
          id?: string
          net_amount?: number | null
          notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string | null
          total_collections?: number | null
          total_fuel?: number | null
          total_other_expenses?: number | null
          total_per_diem?: number | null
          trip_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "driver_settlements_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driver_settlements_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      drivers: {
        Row: {
          assigned_branch_id: string | null
          assigned_vehicle_id: string | null
          created_at: string
          id: string
          is_active: boolean | null
          license_expiry: string | null
          license_number: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          assigned_branch_id?: string | null
          assigned_vehicle_id?: string | null
          created_at?: string
          id?: string
          is_active?: boolean | null
          license_expiry?: string | null
          license_number?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          assigned_branch_id?: string | null
          assigned_vehicle_id?: string | null
          created_at?: string
          id?: string
          is_active?: boolean | null
          license_expiry?: string | null
          license_number?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "drivers_assigned_branch_id_fkey"
            columns: ["assigned_branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "drivers_assigned_vehicle_id_fkey"
            columns: ["assigned_vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      fuel_records: {
        Row: {
          created_at: string
          date: string
          driver_id: string
          id: string
          liters: number
          mileage_at_fill: number | null
          notes: string | null
          payment_method: string | null
          price_per_liter: number | null
          receipt_photo_url: string | null
          station_name: string | null
          total_amount: number
          trip_id: string | null
          vehicle_id: string
        }
        Insert: {
          created_at?: string
          date?: string
          driver_id: string
          id?: string
          liters: number
          mileage_at_fill?: number | null
          notes?: string | null
          payment_method?: string | null
          price_per_liter?: number | null
          receipt_photo_url?: string | null
          station_name?: string | null
          total_amount: number
          trip_id?: string | null
          vehicle_id: string
        }
        Update: {
          created_at?: string
          date?: string
          driver_id?: string
          id?: string
          liters?: number
          mileage_at_fill?: number | null
          notes?: string | null
          payment_method?: string | null
          price_per_liter?: number | null
          receipt_photo_url?: string | null
          station_name?: string | null
          total_amount?: number
          trip_id?: string | null
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fuel_records_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fuel_records_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fuel_records_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      fulfillment_items: {
        Row: {
          created_at: string
          fulfillment_id: string
          id: string
          product_id: string
          quantity_accepted: number | null
          quantity_dispatched: number
          quantity_received: number | null
          quantity_rejected: number | null
          rejection_reason: string | null
          request_item_id: string | null
        }
        Insert: {
          created_at?: string
          fulfillment_id: string
          id?: string
          product_id: string
          quantity_accepted?: number | null
          quantity_dispatched: number
          quantity_received?: number | null
          quantity_rejected?: number | null
          rejection_reason?: string | null
          request_item_id?: string | null
        }
        Update: {
          created_at?: string
          fulfillment_id?: string
          id?: string
          product_id?: string
          quantity_accepted?: number | null
          quantity_dispatched?: number
          quantity_received?: number | null
          quantity_rejected?: number | null
          rejection_reason?: string | null
          request_item_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fulfillment_items_fulfillment_id_fkey"
            columns: ["fulfillment_id"]
            isOneToOne: false
            referencedRelation: "fulfillment_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fulfillment_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fulfillment_items_request_item_id_fkey"
            columns: ["request_item_id"]
            isOneToOne: false
            referencedRelation: "branch_request_items"
            referencedColumns: ["id"]
          },
        ]
      }
      fulfillment_orders: {
        Row: {
          bims_confirmation_deadline: string | null
          bims_invoice_number: string | null
          bims_transfer_number: string | null
          bims_transfer_verified: boolean | null
          branch_request_id: string | null
          commercial_exception_at: string | null
          commercial_exception_status: string | null
          commercial_resolution_notes: string | null
          commercial_resolution_type: string | null
          commercial_resolved_at: string | null
          commercial_resolved_by: string | null
          created_at: string
          current_custody_holder_id: string | null
          current_location_branch_id: string | null
          destination_branch_id: string | null
          destination_client_address: string | null
          destination_client_name: string | null
          dispatched_at: string | null
          dispatched_by: string | null
          expected_next_event: string | null
          expected_next_event_deadline: string | null
          id: string
          notes: string | null
          package_count: number | null
          received_at: string | null
          received_at_branch: string | null
          received_by: string | null
          received_by_branch: string | null
          shipping_method: Database["public"]["Enums"]["shipping_method"]
          source_branch_id: string
          status: Database["public"]["Enums"]["fulfillment_status"]
          trip_id: string | null
          updated_at: string
        }
        Insert: {
          bims_confirmation_deadline?: string | null
          bims_invoice_number?: string | null
          bims_transfer_number?: string | null
          bims_transfer_verified?: boolean | null
          branch_request_id?: string | null
          commercial_exception_at?: string | null
          commercial_exception_status?: string | null
          commercial_resolution_notes?: string | null
          commercial_resolution_type?: string | null
          commercial_resolved_at?: string | null
          commercial_resolved_by?: string | null
          created_at?: string
          current_custody_holder_id?: string | null
          current_location_branch_id?: string | null
          destination_branch_id?: string | null
          destination_client_address?: string | null
          destination_client_name?: string | null
          dispatched_at?: string | null
          dispatched_by?: string | null
          expected_next_event?: string | null
          expected_next_event_deadline?: string | null
          id?: string
          notes?: string | null
          package_count?: number | null
          received_at?: string | null
          received_at_branch?: string | null
          received_by?: string | null
          received_by_branch?: string | null
          shipping_method: Database["public"]["Enums"]["shipping_method"]
          source_branch_id: string
          status?: Database["public"]["Enums"]["fulfillment_status"]
          trip_id?: string | null
          updated_at?: string
        }
        Update: {
          bims_confirmation_deadline?: string | null
          bims_invoice_number?: string | null
          bims_transfer_number?: string | null
          bims_transfer_verified?: boolean | null
          branch_request_id?: string | null
          commercial_exception_at?: string | null
          commercial_exception_status?: string | null
          commercial_resolution_notes?: string | null
          commercial_resolution_type?: string | null
          commercial_resolved_at?: string | null
          commercial_resolved_by?: string | null
          created_at?: string
          current_custody_holder_id?: string | null
          current_location_branch_id?: string | null
          destination_branch_id?: string | null
          destination_client_address?: string | null
          destination_client_name?: string | null
          dispatched_at?: string | null
          dispatched_by?: string | null
          expected_next_event?: string | null
          expected_next_event_deadline?: string | null
          id?: string
          notes?: string | null
          package_count?: number | null
          received_at?: string | null
          received_at_branch?: string | null
          received_by?: string | null
          received_by_branch?: string | null
          shipping_method?: Database["public"]["Enums"]["shipping_method"]
          source_branch_id?: string
          status?: Database["public"]["Enums"]["fulfillment_status"]
          trip_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fulfillment_orders_branch_request_id_fkey"
            columns: ["branch_request_id"]
            isOneToOne: false
            referencedRelation: "branch_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fulfillment_orders_current_location_branch_id_fkey"
            columns: ["current_location_branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fulfillment_orders_destination_branch_id_fkey"
            columns: ["destination_branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fulfillment_orders_source_branch_id_fkey"
            columns: ["source_branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fulfillment_orders_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      kpi_definitions: {
        Row: {
          aggregation: Database["public"]["Enums"]["kpi_aggregation"]
          area: Database["public"]["Enums"]["kpi_area"]
          code: string
          created_at: string
          date_column: string | null
          decimal_places: number | null
          description: string | null
          display_order: number | null
          filter_conditions: Json | null
          format: string | null
          id: string
          is_active: boolean | null
          name: string
          source_table: string
          unit: string | null
          updated_at: string
          value_column: string | null
        }
        Insert: {
          aggregation: Database["public"]["Enums"]["kpi_aggregation"]
          area: Database["public"]["Enums"]["kpi_area"]
          code: string
          created_at?: string
          date_column?: string | null
          decimal_places?: number | null
          description?: string | null
          display_order?: number | null
          filter_conditions?: Json | null
          format?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          source_table: string
          unit?: string | null
          updated_at?: string
          value_column?: string | null
        }
        Update: {
          aggregation?: Database["public"]["Enums"]["kpi_aggregation"]
          area?: Database["public"]["Enums"]["kpi_area"]
          code?: string
          created_at?: string
          date_column?: string | null
          decimal_places?: number | null
          description?: string | null
          display_order?: number | null
          filter_conditions?: Json | null
          format?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          source_table?: string
          unit?: string | null
          updated_at?: string
          value_column?: string | null
        }
        Relationships: []
      }
      kpi_targets: {
        Row: {
          branch_id: string | null
          created_at: string
          critical_threshold: number | null
          id: string
          kpi_id: string
          period_end: string
          period_start: string
          target_value: number
          updated_at: string
          warning_threshold: number | null
          weight: number | null
        }
        Insert: {
          branch_id?: string | null
          created_at?: string
          critical_threshold?: number | null
          id?: string
          kpi_id: string
          period_end: string
          period_start: string
          target_value: number
          updated_at?: string
          warning_threshold?: number | null
          weight?: number | null
        }
        Update: {
          branch_id?: string | null
          created_at?: string
          critical_threshold?: number | null
          id?: string
          kpi_id?: string
          period_end?: string
          period_start?: string
          target_value?: number
          updated_at?: string
          warning_threshold?: number | null
          weight?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "kpi_targets_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kpi_targets_kpi_id_fkey"
            columns: ["kpi_id"]
            isOneToOne: false
            referencedRelation: "kpi_definitions"
            referencedColumns: ["id"]
          },
        ]
      }
      kpi_values: {
        Row: {
          achievement_percentage: number | null
          branch_id: string | null
          calculated_at: string
          change_percentage: number | null
          id: string
          kpi_id: string
          period_date: string
          previous_value: number | null
          target_value: number | null
          value: number
        }
        Insert: {
          achievement_percentage?: number | null
          branch_id?: string | null
          calculated_at?: string
          change_percentage?: number | null
          id?: string
          kpi_id: string
          period_date: string
          previous_value?: number | null
          target_value?: number | null
          value: number
        }
        Update: {
          achievement_percentage?: number | null
          branch_id?: string | null
          calculated_at?: string
          change_percentage?: number | null
          id?: string
          kpi_id?: string
          period_date?: string
          previous_value?: number | null
          target_value?: number | null
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "kpi_values_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kpi_values_kpi_id_fkey"
            columns: ["kpi_id"]
            isOneToOne: false
            referencedRelation: "kpi_definitions"
            referencedColumns: ["id"]
          },
        ]
      }
      logistics_incidents: {
        Row: {
          admin_decision_at: string | null
          admin_decision_by: string | null
          admin_disposition: string | null
          admin_disposition_notes: string | null
          assigned_to: string | null
          branch_id: string
          branch_request_id: string | null
          created_at: string
          current_custody_holder_id: string | null
          current_location_branch_id: string | null
          damage_cause: Database["public"]["Enums"]["damage_cause"] | null
          damage_origin: Database["public"]["Enums"]["damage_origin"] | null
          description: string | null
          detection_context:
            | Database["public"]["Enums"]["detection_context"]
            | null
          fulfillment_order_id: string | null
          id: string
          incident_origin: string | null
          incident_type: Database["public"]["Enums"]["incident_type"]
          inventory_id: string | null
          pending_shipment_to_admin: boolean | null
          photo_urls: Json | null
          product_id: string | null
          quantity_affected: number | null
          reported_by: string
          resolution: string | null
          resolved_at: string | null
          resolved_by: string | null
          responsible_user_id: string | null
          shipment_reminder_24th: boolean | null
          shipment_reminder_9th: boolean | null
          status: Database["public"]["Enums"]["incident_status"]
          title: string
          trip_id: string | null
          updated_at: string
        }
        Insert: {
          admin_decision_at?: string | null
          admin_decision_by?: string | null
          admin_disposition?: string | null
          admin_disposition_notes?: string | null
          assigned_to?: string | null
          branch_id: string
          branch_request_id?: string | null
          created_at?: string
          current_custody_holder_id?: string | null
          current_location_branch_id?: string | null
          damage_cause?: Database["public"]["Enums"]["damage_cause"] | null
          damage_origin?: Database["public"]["Enums"]["damage_origin"] | null
          description?: string | null
          detection_context?:
            | Database["public"]["Enums"]["detection_context"]
            | null
          fulfillment_order_id?: string | null
          id?: string
          incident_origin?: string | null
          incident_type: Database["public"]["Enums"]["incident_type"]
          inventory_id?: string | null
          pending_shipment_to_admin?: boolean | null
          photo_urls?: Json | null
          product_id?: string | null
          quantity_affected?: number | null
          reported_by: string
          resolution?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          responsible_user_id?: string | null
          shipment_reminder_24th?: boolean | null
          shipment_reminder_9th?: boolean | null
          status?: Database["public"]["Enums"]["incident_status"]
          title: string
          trip_id?: string | null
          updated_at?: string
        }
        Update: {
          admin_decision_at?: string | null
          admin_decision_by?: string | null
          admin_disposition?: string | null
          admin_disposition_notes?: string | null
          assigned_to?: string | null
          branch_id?: string
          branch_request_id?: string | null
          created_at?: string
          current_custody_holder_id?: string | null
          current_location_branch_id?: string | null
          damage_cause?: Database["public"]["Enums"]["damage_cause"] | null
          damage_origin?: Database["public"]["Enums"]["damage_origin"] | null
          description?: string | null
          detection_context?:
            | Database["public"]["Enums"]["detection_context"]
            | null
          fulfillment_order_id?: string | null
          id?: string
          incident_origin?: string | null
          incident_type?: Database["public"]["Enums"]["incident_type"]
          inventory_id?: string | null
          pending_shipment_to_admin?: boolean | null
          photo_urls?: Json | null
          product_id?: string | null
          quantity_affected?: number | null
          reported_by?: string
          resolution?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          responsible_user_id?: string | null
          shipment_reminder_24th?: boolean | null
          shipment_reminder_9th?: boolean | null
          status?: Database["public"]["Enums"]["incident_status"]
          title?: string
          trip_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "logistics_incidents_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "logistics_incidents_branch_request_id_fkey"
            columns: ["branch_request_id"]
            isOneToOne: false
            referencedRelation: "branch_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "logistics_incidents_current_location_branch_id_fkey"
            columns: ["current_location_branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "logistics_incidents_fulfillment_order_id_fkey"
            columns: ["fulfillment_order_id"]
            isOneToOne: false
            referencedRelation: "fulfillment_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "logistics_incidents_inventory_id_fkey"
            columns: ["inventory_id"]
            isOneToOne: false
            referencedRelation: "directed_inventories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "logistics_incidents_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "logistics_incidents_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      operational_events: {
        Row: {
          category: Database["public"]["Enums"]["event_category"]
          created_at: string
          event_description: string | null
          event_type: string
          expected_next_event: string | null
          expected_next_event_deadline: string | null
          id: string
          latitude: number | null
          longitude: number | null
          metadata: Json | null
          new_custody_holder_id: string | null
          new_location_branch_id: string | null
          new_status: string | null
          previous_custody_holder_id: string | null
          previous_location_branch_id: string | null
          previous_status: string | null
          reference_id: string
          reference_type: string
          triggered_by: string
        }
        Insert: {
          category: Database["public"]["Enums"]["event_category"]
          created_at?: string
          event_description?: string | null
          event_type: string
          expected_next_event?: string | null
          expected_next_event_deadline?: string | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          metadata?: Json | null
          new_custody_holder_id?: string | null
          new_location_branch_id?: string | null
          new_status?: string | null
          previous_custody_holder_id?: string | null
          previous_location_branch_id?: string | null
          previous_status?: string | null
          reference_id: string
          reference_type: string
          triggered_by: string
        }
        Update: {
          category?: Database["public"]["Enums"]["event_category"]
          created_at?: string
          event_description?: string | null
          event_type?: string
          expected_next_event?: string | null
          expected_next_event_deadline?: string | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          metadata?: Json | null
          new_custody_holder_id?: string | null
          new_location_branch_id?: string | null
          new_status?: string | null
          previous_custody_holder_id?: string | null
          previous_location_branch_id?: string | null
          previous_status?: string | null
          reference_id?: string
          reference_type?: string
          triggered_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "operational_events_new_location_branch_id_fkey"
            columns: ["new_location_branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operational_events_previous_location_branch_id_fkey"
            columns: ["previous_location_branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      per_diem_records: {
        Row: {
          amount: number
          approved_at: string | null
          approved_by: string | null
          concept: string
          created_at: string
          date: string
          driver_id: string
          id: string
          notes: string | null
          receipt_photo_url: string | null
          trip_id: string | null
        }
        Insert: {
          amount: number
          approved_at?: string | null
          approved_by?: string | null
          concept: string
          created_at?: string
          date?: string
          driver_id: string
          id?: string
          notes?: string | null
          receipt_photo_url?: string | null
          trip_id?: string | null
        }
        Update: {
          amount?: number
          approved_at?: string | null
          approved_by?: string | null
          concept?: string
          created_at?: string
          date?: string
          driver_id?: string
          id?: string
          notes?: string | null
          receipt_photo_url?: string | null
          trip_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "per_diem_records_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "per_diem_records_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          barcode: string | null
          bims_code: string | null
          bims_warehouse_id: string | null
          buy_price: number | null
          category: string | null
          created_at: string
          description: string | null
          id: string
          image_url: string | null
          is_active: boolean | null
          name: string
          price_lists: Json | null
          price_scales: Json | null
          sell_price: number | null
          sku: string | null
          stock_by_warehouse: Json | null
          total_stock: number | null
          unit: string | null
          updated_at: string
          volume_cm3: number | null
          weight_kg: number | null
        }
        Insert: {
          barcode?: string | null
          bims_code?: string | null
          bims_warehouse_id?: string | null
          buy_price?: number | null
          category?: string | null
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean | null
          name: string
          price_lists?: Json | null
          price_scales?: Json | null
          sell_price?: number | null
          sku?: string | null
          stock_by_warehouse?: Json | null
          total_stock?: number | null
          unit?: string | null
          updated_at?: string
          volume_cm3?: number | null
          weight_kg?: number | null
        }
        Update: {
          barcode?: string | null
          bims_code?: string | null
          bims_warehouse_id?: string | null
          buy_price?: number | null
          category?: string | null
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean | null
          name?: string
          price_lists?: Json | null
          price_scales?: Json | null
          sell_price?: number | null
          sku?: string | null
          stock_by_warehouse?: Json | null
          total_stock?: number | null
          unit?: string | null
          updated_at?: string
          volume_cm3?: number | null
          weight_kg?: number | null
        }
        Relationships: []
      }
      profile_branch_access: {
        Row: {
          branch_id: string
          created_at: string
          id: string
          profile_id: string
        }
        Insert: {
          branch_id: string
          created_at?: string
          id?: string
          profile_id: string
        }
        Update: {
          branch_id?: string
          created_at?: string
          id?: string
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profile_branch_access_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_branch_access_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          all_branches_access: boolean
          avatar_url: string | null
          created_at: string
          default_branch_id: string | null
          full_name: string
          id: string
          is_active: boolean | null
          phone: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          all_branches_access?: boolean
          avatar_url?: string | null
          created_at?: string
          default_branch_id?: string | null
          full_name: string
          id?: string
          is_active?: boolean | null
          phone?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          all_branches_access?: boolean
          avatar_url?: string | null
          created_at?: string
          default_branch_id?: string | null
          full_name?: string
          id?: string
          is_active?: boolean | null
          phone?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_default_branch_id_fkey"
            columns: ["default_branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      shipment_packages: {
        Row: {
          contact_phone: string | null
          created_at: string
          destination_description: string | null
          fulfillment_order_id: string
          id: string
          invoice_reference: string | null
          label_printed: boolean | null
          label_type: Database["public"]["Enums"]["package_label_type"]
          package_number: number
          printed_at: string | null
          recipient_name: string | null
          sending_area: string | null
          sending_branch_code: string | null
          transfer_reference: string | null
        }
        Insert: {
          contact_phone?: string | null
          created_at?: string
          destination_description?: string | null
          fulfillment_order_id: string
          id?: string
          invoice_reference?: string | null
          label_printed?: boolean | null
          label_type?: Database["public"]["Enums"]["package_label_type"]
          package_number?: number
          printed_at?: string | null
          recipient_name?: string | null
          sending_area?: string | null
          sending_branch_code?: string | null
          transfer_reference?: string | null
        }
        Update: {
          contact_phone?: string | null
          created_at?: string
          destination_description?: string | null
          fulfillment_order_id?: string
          id?: string
          invoice_reference?: string | null
          label_printed?: boolean | null
          label_type?: Database["public"]["Enums"]["package_label_type"]
          package_number?: number
          printed_at?: string | null
          recipient_name?: string | null
          sending_area?: string | null
          sending_branch_code?: string | null
          transfer_reference?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shipment_packages_fulfillment_order_id_fkey"
            columns: ["fulfillment_order_id"]
            isOneToOne: false
            referencedRelation: "fulfillment_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      special_stock: {
        Row: {
          branch_id: string
          created_at: string
          created_by: string
          disposition: Database["public"]["Enums"]["stock_disposition"] | null
          disposition_date: string | null
          id: string
          incident_id: string | null
          notes: string | null
          product_id: string
          quantity: number
          stock_type: string
          updated_at: string
        }
        Insert: {
          branch_id: string
          created_at?: string
          created_by: string
          disposition?: Database["public"]["Enums"]["stock_disposition"] | null
          disposition_date?: string | null
          id?: string
          incident_id?: string | null
          notes?: string | null
          product_id: string
          quantity: number
          stock_type: string
          updated_at?: string
        }
        Update: {
          branch_id?: string
          created_at?: string
          created_by?: string
          disposition?: Database["public"]["Enums"]["stock_disposition"] | null
          disposition_date?: string | null
          id?: string
          incident_id?: string | null
          notes?: string | null
          product_id?: string
          quantity?: number
          stock_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "special_stock_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "special_stock_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: false
            referencedRelation: "logistics_incidents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "special_stock_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      sync_logs: {
        Row: {
          completed_at: string | null
          created_at: string
          duration_seconds: number | null
          entity: string
          errors: Json | null
          id: string
          started_at: string
          status: string
          total_failed: number | null
          total_inserted: number | null
          total_processed: number | null
          total_received: number | null
          total_skipped: number | null
          total_updated: number | null
          triggered_by: string | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          duration_seconds?: number | null
          entity: string
          errors?: Json | null
          id?: string
          started_at?: string
          status?: string
          total_failed?: number | null
          total_inserted?: number | null
          total_processed?: number | null
          total_received?: number | null
          total_skipped?: number | null
          total_updated?: number | null
          triggered_by?: string | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          duration_seconds?: number | null
          entity?: string
          errors?: Json | null
          id?: string
          started_at?: string
          status?: string
          total_failed?: number | null
          total_inserted?: number | null
          total_processed?: number | null
          total_received?: number | null
          total_skipped?: number | null
          total_updated?: number | null
          triggered_by?: string | null
        }
        Relationships: []
      }
      tracked_documents: {
        Row: {
          archived_at: string | null
          bims_reference: string | null
          branch_request_id: string | null
          created_at: string
          current_holder_id: string | null
          current_holder_role: Database["public"]["Enums"]["app_role"] | null
          current_location_branch_id: string | null
          document_number: string
          document_type: Database["public"]["Enums"]["document_type"]
          expected_next_event: string | null
          expected_next_event_deadline: string | null
          fulfillment_order_id: string | null
          id: string
          issued_at: string | null
          notes: string | null
          signed_at: string | null
          status: Database["public"]["Enums"]["document_status"]
          trip_id: string | null
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          bims_reference?: string | null
          branch_request_id?: string | null
          created_at?: string
          current_holder_id?: string | null
          current_holder_role?: Database["public"]["Enums"]["app_role"] | null
          current_location_branch_id?: string | null
          document_number: string
          document_type: Database["public"]["Enums"]["document_type"]
          expected_next_event?: string | null
          expected_next_event_deadline?: string | null
          fulfillment_order_id?: string | null
          id?: string
          issued_at?: string | null
          notes?: string | null
          signed_at?: string | null
          status?: Database["public"]["Enums"]["document_status"]
          trip_id?: string | null
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          bims_reference?: string | null
          branch_request_id?: string | null
          created_at?: string
          current_holder_id?: string | null
          current_holder_role?: Database["public"]["Enums"]["app_role"] | null
          current_location_branch_id?: string | null
          document_number?: string
          document_type?: Database["public"]["Enums"]["document_type"]
          expected_next_event?: string | null
          expected_next_event_deadline?: string | null
          fulfillment_order_id?: string | null
          id?: string
          issued_at?: string | null
          notes?: string | null
          signed_at?: string | null
          status?: Database["public"]["Enums"]["document_status"]
          trip_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tracked_documents_branch_request_id_fkey"
            columns: ["branch_request_id"]
            isOneToOne: false
            referencedRelation: "branch_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tracked_documents_current_location_branch_id_fkey"
            columns: ["current_location_branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tracked_documents_fulfillment_order_id_fkey"
            columns: ["fulfillment_order_id"]
            isOneToOne: false
            referencedRelation: "fulfillment_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tracked_documents_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      trips: {
        Row: {
          actual_arrival: string | null
          actual_departure: string | null
          created_at: string
          cutoff_ended_at: string | null
          cutoff_started_at: string | null
          driver_id: string
          end_mileage: number | null
          end_mileage_photo_url: string | null
          id: string
          notes: string | null
          origin_branch_id: string
          planned_arrival: string | null
          planned_departure: string | null
          planned_stops: Json | null
          settled_at: string | null
          settled_by: string | null
          settlement_status: string | null
          start_mileage: number | null
          start_mileage_photo_url: string | null
          status: Database["public"]["Enums"]["trip_status"]
          trip_number: number
          trip_type: Database["public"]["Enums"]["trip_type"]
          updated_at: string
          vehicle_id: string
        }
        Insert: {
          actual_arrival?: string | null
          actual_departure?: string | null
          created_at?: string
          cutoff_ended_at?: string | null
          cutoff_started_at?: string | null
          driver_id: string
          end_mileage?: number | null
          end_mileage_photo_url?: string | null
          id?: string
          notes?: string | null
          origin_branch_id: string
          planned_arrival?: string | null
          planned_departure?: string | null
          planned_stops?: Json | null
          settled_at?: string | null
          settled_by?: string | null
          settlement_status?: string | null
          start_mileage?: number | null
          start_mileage_photo_url?: string | null
          status?: Database["public"]["Enums"]["trip_status"]
          trip_number?: number
          trip_type?: Database["public"]["Enums"]["trip_type"]
          updated_at?: string
          vehicle_id: string
        }
        Update: {
          actual_arrival?: string | null
          actual_departure?: string | null
          created_at?: string
          cutoff_ended_at?: string | null
          cutoff_started_at?: string | null
          driver_id?: string
          end_mileage?: number | null
          end_mileage_photo_url?: string | null
          id?: string
          notes?: string | null
          origin_branch_id?: string
          planned_arrival?: string | null
          planned_departure?: string | null
          planned_stops?: Json | null
          settled_at?: string | null
          settled_by?: string | null
          settlement_status?: string | null
          start_mileage?: number | null
          start_mileage_photo_url?: string | null
          status?: Database["public"]["Enums"]["trip_status"]
          trip_number?: number
          trip_type?: Database["public"]["Enums"]["trip_type"]
          updated_at?: string
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trips_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trips_origin_branch_id_fkey"
            columns: ["origin_branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trips_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_module_access: {
        Row: {
          created_at: string
          id: string
          is_enabled: boolean
          module_key: string
          profile_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_enabled?: boolean
          module_key: string
          profile_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_enabled?: boolean
          module_key?: string
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_module_access_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          branch_id: string | null
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          branch_id?: string | null
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          branch_id?: string | null
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicle_loans: {
        Row: {
          actual_return_date: string | null
          approved_by: string | null
          borrowing_branch_id: string
          created_at: string
          expected_return_date: string | null
          id: string
          lending_branch_id: string
          notes: string | null
          reason: string | null
          requested_by: string
          return_mileage: number | null
          start_date: string | null
          start_mileage: number | null
          status: Database["public"]["Enums"]["vehicle_loan_status"]
          updated_at: string
          vehicle_id: string
        }
        Insert: {
          actual_return_date?: string | null
          approved_by?: string | null
          borrowing_branch_id: string
          created_at?: string
          expected_return_date?: string | null
          id?: string
          lending_branch_id: string
          notes?: string | null
          reason?: string | null
          requested_by: string
          return_mileage?: number | null
          start_date?: string | null
          start_mileage?: number | null
          status?: Database["public"]["Enums"]["vehicle_loan_status"]
          updated_at?: string
          vehicle_id: string
        }
        Update: {
          actual_return_date?: string | null
          approved_by?: string | null
          borrowing_branch_id?: string
          created_at?: string
          expected_return_date?: string | null
          id?: string
          lending_branch_id?: string
          notes?: string | null
          reason?: string | null
          requested_by?: string
          return_mileage?: number | null
          start_date?: string | null
          start_mileage?: number | null
          status?: Database["public"]["Enums"]["vehicle_loan_status"]
          updated_at?: string
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_loans_borrowing_branch_id_fkey"
            columns: ["borrowing_branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_loans_lending_branch_id_fkey"
            columns: ["lending_branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_loans_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicle_maintenance: {
        Row: {
          completed_date: string | null
          cost: number | null
          created_at: string
          description: string
          id: string
          maintenance_type: string
          mileage_at_service: number | null
          next_maintenance_date: string | null
          next_maintenance_mileage: number | null
          notes: string | null
          provider: string | null
          scheduled_date: string | null
          status: string | null
          updated_at: string
          vehicle_id: string
        }
        Insert: {
          completed_date?: string | null
          cost?: number | null
          created_at?: string
          description: string
          id?: string
          maintenance_type: string
          mileage_at_service?: number | null
          next_maintenance_date?: string | null
          next_maintenance_mileage?: number | null
          notes?: string | null
          provider?: string | null
          scheduled_date?: string | null
          status?: string | null
          updated_at?: string
          vehicle_id: string
        }
        Update: {
          completed_date?: string | null
          cost?: number | null
          created_at?: string
          description?: string
          id?: string
          maintenance_type?: string
          mileage_at_service?: number | null
          next_maintenance_date?: string | null
          next_maintenance_mileage?: number | null
          notes?: string | null
          provider?: string | null
          scheduled_date?: string | null
          status?: string | null
          updated_at?: string
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_maintenance_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicles: {
        Row: {
          assigned_branch_id: string | null
          brand: string | null
          created_at: string
          current_mileage: number | null
          id: string
          insurance_expiry: string | null
          is_active: boolean | null
          model: string | null
          notes: string | null
          plate: string
          status: Database["public"]["Enums"]["vehicle_status"]
          updated_at: string
          vtv_expiry: string | null
          year: number | null
        }
        Insert: {
          assigned_branch_id?: string | null
          brand?: string | null
          created_at?: string
          current_mileage?: number | null
          id?: string
          insurance_expiry?: string | null
          is_active?: boolean | null
          model?: string | null
          notes?: string | null
          plate: string
          status?: Database["public"]["Enums"]["vehicle_status"]
          updated_at?: string
          vtv_expiry?: string | null
          year?: number | null
        }
        Update: {
          assigned_branch_id?: string | null
          brand?: string | null
          created_at?: string
          current_mileage?: number | null
          id?: string
          insurance_expiry?: string | null
          is_active?: boolean | null
          model?: string | null
          notes?: string | null
          plate?: string
          status?: Database["public"]["Enums"]["vehicle_status"]
          updated_at?: string
          vtv_expiry?: string | null
          year?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "vehicles_assigned_branch_id_fkey"
            columns: ["assigned_branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      can_access_branch: {
        Args: { _branch_id: string; _user_id: string }
        Returns: boolean
      }
      fn_can_view_consultation: {
        Args: { _consultation_id: string; _user_id: string }
        Returns: boolean
      }
      fn_close_expired_consultations: { Args: never; Returns: number }
      fn_respond_consultation_target: {
        Args: {
          p_colors?: string
          p_note?: string
          p_quantity?: number
          p_target_id: string
        }
        Returns: Json
      }
      fn_transition_request_status: {
        Args: {
          p_new_status: string
          p_reason?: string
          p_rejection_reason_type?: string
          p_request_id: string
        }
        Returns: Json
      }
      fn_validate_driver_pickup: {
        Args: { p_fulfillment_id: string }
        Returns: Json
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      has_role_in_branch: {
        Args: {
          _branch_id: string
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_owner: { Args: { _user_id: string }; Returns: boolean }
    }
    Enums: {
      alert_level:
        | "branch_operational"
        | "escalable"
        | "logistics_admin_decision"
      anomaly_severity: "info" | "warning" | "critical"
      app_role:
        | "admin"
        | "supervisor"
        | "warehouse_operator"
        | "driver"
        | "collector"
        | "branch_manager"
        | "branch_operator"
        | "viewer"
        | "owner"
      consultation_status: "open" | "responded" | "converted" | "expired"
      damage_cause:
        | "collaborator"
        | "customer"
        | "sealed_package"
        | "product_defect"
      damage_origin:
        | "transfer_reception"
        | "collaborator"
        | "customer"
        | "sealed_package"
        | "product_defect"
      delivery_target: "branch" | "client"
      detection_context:
        | "transfer_reception"
        | "supplier_reception"
        | "internal"
      directed_inventory_status:
        | "planned"
        | "in_progress"
        | "completed"
        | "cancelled"
      document_status:
        | "issued"
        | "with_driver"
        | "delivered_to_client"
        | "signed_by_client"
        | "with_admin"
        | "sent_to_collector"
        | "received_by_collector"
        | "presented_to_client"
        | "collection_scheduled"
        | "collection_completed"
        | "archived"
      document_type:
        | "invoice"
        | "remission"
        | "signed_invoice"
        | "credit_note"
        | "delivery_receipt"
      event_category:
        | "request"
        | "fulfillment"
        | "document"
        | "trip"
        | "inventory"
        | "incident"
        | "vehicle"
        | "collection"
        | "stock"
      fulfillment_status:
        | "pending"
        | "picking"
        | "waiting_for_cut"
        | "waiting_for_courier"
        | "dispatched"
        | "in_transit"
        | "delivered"
        | "pending_physical_confirmation"
        | "received"
        | "partial"
        | "completed"
        | "cancelled"
      incident_status:
        | "open"
        | "under_review"
        | "resolved"
        | "escalated"
        | "closed"
      incident_type:
        | "damaged"
        | "missing"
        | "surplus"
        | "wrong_product"
        | "expired"
        | "admin_stock"
        | "fair_stock"
      item_purpose: "client" | "reposition"
      kpi_aggregation:
        | "count"
        | "sum"
        | "average"
        | "percentage"
        | "ratio"
        | "min"
        | "max"
      kpi_area:
        | "logistics"
        | "warehouse"
        | "fleet"
        | "collections"
        | "inventory"
        | "fulfillment"
        | "general"
      package_label_type: "inter_branch" | "customer" | "courier"
      recommendation_status: "pending" | "accepted" | "rejected" | "expired"
      rejection_reason_type:
        | "no_stock_real"
        | "stock_difference"
        | "product_not_found"
        | "stock_reserved"
        | "not_convenient_rotation"
        | "other"
      request_status:
        | "pending"
        | "accepted"
        | "rejected"
        | "picking"
        | "dispatched"
        | "in_transit"
        | "delivered"
        | "received"
        | "logistic_closed"
        | "closed"
      request_type:
        | "client"
        | "reposition"
        | "mixed"
        | "online"
        | "redistribution"
      reserve_reason: "branch_request" | "client_order" | "pending_fulfillment"
      reserve_type: "soft" | "hard"
      shipping_method: "own_fleet" | "courier" | "pickup" | "delivery"
      stock_disposition:
        | "ajuste_inventario"
        | "reclamo_proveedor"
        | "descuento_colaborador"
        | "imputacion_salon"
        | "imputacion_sucursal"
        | "perdida_empresa"
        | "venta_feria"
        | "reconteo_pendiente"
        | "other"
      trip_status: "planned" | "in_progress" | "completed" | "cancelled"
      trip_type: "urban_cutoff" | "interurban_planned"
      vehicle_loan_status:
        | "requested"
        | "approved"
        | "active"
        | "returned"
        | "cancelled"
      vehicle_status:
        | "available"
        | "in_route"
        | "maintenance"
        | "out_of_service"
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
      alert_level: [
        "branch_operational",
        "escalable",
        "logistics_admin_decision",
      ],
      anomaly_severity: ["info", "warning", "critical"],
      app_role: [
        "admin",
        "supervisor",
        "warehouse_operator",
        "driver",
        "collector",
        "branch_manager",
        "branch_operator",
        "viewer",
        "owner",
      ],
      consultation_status: ["open", "responded", "converted", "expired"],
      damage_cause: [
        "collaborator",
        "customer",
        "sealed_package",
        "product_defect",
      ],
      damage_origin: [
        "transfer_reception",
        "collaborator",
        "customer",
        "sealed_package",
        "product_defect",
      ],
      delivery_target: ["branch", "client"],
      detection_context: [
        "transfer_reception",
        "supplier_reception",
        "internal",
      ],
      directed_inventory_status: [
        "planned",
        "in_progress",
        "completed",
        "cancelled",
      ],
      document_status: [
        "issued",
        "with_driver",
        "delivered_to_client",
        "signed_by_client",
        "with_admin",
        "sent_to_collector",
        "received_by_collector",
        "presented_to_client",
        "collection_scheduled",
        "collection_completed",
        "archived",
      ],
      document_type: [
        "invoice",
        "remission",
        "signed_invoice",
        "credit_note",
        "delivery_receipt",
      ],
      event_category: [
        "request",
        "fulfillment",
        "document",
        "trip",
        "inventory",
        "incident",
        "vehicle",
        "collection",
        "stock",
      ],
      fulfillment_status: [
        "pending",
        "picking",
        "waiting_for_cut",
        "waiting_for_courier",
        "dispatched",
        "in_transit",
        "delivered",
        "pending_physical_confirmation",
        "received",
        "partial",
        "completed",
        "cancelled",
      ],
      incident_status: [
        "open",
        "under_review",
        "resolved",
        "escalated",
        "closed",
      ],
      incident_type: [
        "damaged",
        "missing",
        "surplus",
        "wrong_product",
        "expired",
        "admin_stock",
        "fair_stock",
      ],
      item_purpose: ["client", "reposition"],
      kpi_aggregation: [
        "count",
        "sum",
        "average",
        "percentage",
        "ratio",
        "min",
        "max",
      ],
      kpi_area: [
        "logistics",
        "warehouse",
        "fleet",
        "collections",
        "inventory",
        "fulfillment",
        "general",
      ],
      package_label_type: ["inter_branch", "customer", "courier"],
      recommendation_status: ["pending", "accepted", "rejected", "expired"],
      rejection_reason_type: [
        "no_stock_real",
        "stock_difference",
        "product_not_found",
        "stock_reserved",
        "not_convenient_rotation",
        "other",
      ],
      request_status: [
        "pending",
        "accepted",
        "rejected",
        "picking",
        "dispatched",
        "in_transit",
        "delivered",
        "received",
        "logistic_closed",
        "closed",
      ],
      request_type: [
        "client",
        "reposition",
        "mixed",
        "online",
        "redistribution",
      ],
      reserve_reason: ["branch_request", "client_order", "pending_fulfillment"],
      reserve_type: ["soft", "hard"],
      shipping_method: ["own_fleet", "courier", "pickup", "delivery"],
      stock_disposition: [
        "ajuste_inventario",
        "reclamo_proveedor",
        "descuento_colaborador",
        "imputacion_salon",
        "imputacion_sucursal",
        "perdida_empresa",
        "venta_feria",
        "reconteo_pendiente",
        "other",
      ],
      trip_status: ["planned", "in_progress", "completed", "cancelled"],
      trip_type: ["urban_cutoff", "interurban_planned"],
      vehicle_loan_status: [
        "requested",
        "approved",
        "active",
        "returned",
        "cancelled",
      ],
      vehicle_status: [
        "available",
        "in_route",
        "maintenance",
        "out_of_service",
      ],
    },
  },
} as const
