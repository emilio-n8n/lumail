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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      api_keys: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          key_hash: string
          last_used_at: string | null
          last_used_ip: string | null
          name: string
          prefix: string
          revoked_at: string | null
          scopes: Json
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          key_hash: string
          last_used_at?: string | null
          last_used_ip?: string | null
          name: string
          prefix: string
          revoked_at?: string | null
          scopes?: Json
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          key_hash?: string
          last_used_at?: string | null
          last_used_ip?: string | null
          name?: string
          prefix?: string
          revoked_at?: string | null
          scopes?: Json
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "api_keys_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_recipients: {
        Row: {
          campaign_id: string
          contact_id: string
          created_at: string
          id: string
          message_id: string | null
          status: Database["public"]["Enums"]["message_status"]
          workspace_id: string
        }
        Insert: {
          campaign_id: string
          contact_id: string
          created_at?: string
          id?: string
          message_id?: string | null
          status?: Database["public"]["Enums"]["message_status"]
          workspace_id: string
        }
        Update: {
          campaign_id?: string
          contact_id?: string
          created_at?: string
          id?: string
          message_id?: string | null
          status?: Database["public"]["Enums"]["message_status"]
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_recipients_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_recipients_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_recipients_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      campaigns: {
        Row: {
          completed_at: string | null
          created_at: string
          created_by: string | null
          document: Json
          from_email: string | null
          from_name: string | null
          html: string
          id: string
          name: string
          preheader: string | null
          recipients_count: number
          reply_to: string | null
          scheduled_at: string | null
          segment_id: string | null
          sent_at: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["campaign_status"]
          subject: string
          template_id: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          document?: Json
          from_email?: string | null
          from_name?: string | null
          html?: string
          id?: string
          name: string
          preheader?: string | null
          recipients_count?: number
          reply_to?: string | null
          scheduled_at?: string | null
          segment_id?: string | null
          sent_at?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["campaign_status"]
          subject?: string
          template_id?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          document?: Json
          from_email?: string | null
          from_name?: string | null
          html?: string
          id?: string
          name?: string
          preheader?: string | null
          recipients_count?: number
          reply_to?: string | null
          scheduled_at?: string | null
          segment_id?: string | null
          sent_at?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["campaign_status"]
          subject?: string
          template_id?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaigns_segment_id_fkey"
            columns: ["segment_id"]
            isOneToOne: false
            referencedRelation: "segments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaigns_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaigns_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_events: {
        Row: {
          campaign_id: string | null
          contact_id: string | null
          event_type: Database["public"]["Enums"]["event_type"]
          id: string
          ip: string | null
          message_id: string | null
          metadata: Json
          node_id: string | null
          occurred_at: string
          url: string | null
          user_agent: string | null
          workflow_id: string | null
          workspace_id: string
        }
        Insert: {
          campaign_id?: string | null
          contact_id?: string | null
          event_type: Database["public"]["Enums"]["event_type"]
          id?: string
          ip?: string | null
          message_id?: string | null
          metadata?: Json
          node_id?: string | null
          occurred_at?: string
          url?: string | null
          user_agent?: string | null
          workflow_id?: string | null
          workspace_id: string
        }
        Update: {
          campaign_id?: string | null
          contact_id?: string | null
          event_type?: Database["public"]["Enums"]["event_type"]
          id?: string
          ip?: string | null
          message_id?: string | null
          metadata?: Json
          node_id?: string | null
          occurred_at?: string
          url?: string | null
          user_agent?: string | null
          workflow_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_events_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_tags: {
        Row: {
          contact_id: string
          created_at: string
          id: string
          tag_id: string
          workspace_id: string
        }
        Insert: {
          contact_id: string
          created_at?: string
          id?: string
          tag_id: string
          workspace_id: string
        }
        Update: {
          contact_id?: string
          created_at?: string
          id?: string
          tag_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_tags_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_tags_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts: {
        Row: {
          attributes: Json
          bounced_at: string | null
          company: string | null
          created_at: string
          custom_fields: Json
          email: string
          first_name: string | null
          id: string
          last_activity_at: string | null
          last_name: string | null
          phone: string | null
          source: string | null
          status: Database["public"]["Enums"]["contact_status"]
          unsubscribed_at: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          attributes?: Json
          bounced_at?: string | null
          company?: string | null
          created_at?: string
          custom_fields?: Json
          email: string
          first_name?: string | null
          id?: string
          last_activity_at?: string | null
          last_name?: string | null
          phone?: string | null
          source?: string | null
          status?: Database["public"]["Enums"]["contact_status"]
          unsubscribed_at?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          attributes?: Json
          bounced_at?: string | null
          company?: string | null
          created_at?: string
          custom_fields?: Json
          email?: string
          first_name?: string | null
          id?: string
          last_activity_at?: string | null
          last_name?: string | null
          phone?: string | null
          source?: string | null
          status?: Database["public"]["Enums"]["contact_status"]
          unsubscribed_at?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contacts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      custom_field_definitions: {
        Row: {
          created_at: string
          field_type: string
          id: string
          key: string
          label: string
          options: Json
          workspace_id: string
        }
        Insert: {
          created_at?: string
          field_type?: string
          id?: string
          key: string
          label: string
          options?: Json
          workspace_id: string
        }
        Update: {
          created_at?: string
          field_type?: string
          id?: string
          key?: string
          label?: string
          options?: Json
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "custom_field_definitions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      domains: {
        Row: {
          created_at: string
          dkim_public_key: string
          dkim_selector: string
          id: string
          is_default: boolean
          name: string
          status: Database["public"]["Enums"]["domain_status"]
          updated_at: string
          verification_token: string
          verified_at: string | null
          workspace_id: string
        }
        Insert: {
          created_at?: string
          dkim_public_key?: string
          dkim_selector?: string
          id?: string
          is_default?: boolean
          name: string
          status?: Database["public"]["Enums"]["domain_status"]
          updated_at?: string
          verification_token?: string
          verified_at?: string | null
          workspace_id: string
        }
        Update: {
          created_at?: string
          dkim_public_key?: string
          dkim_selector?: string
          id?: string
          is_default?: boolean
          name?: string
          status?: Database["public"]["Enums"]["domain_status"]
          updated_at?: string
          verification_token?: string
          verified_at?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "domains_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      email_messages: {
        Row: {
          attempts: number
          bounced_at: string | null
          campaign_id: string | null
          contact_id: string | null
          created_at: string
          delivered_at: string | null
          error: string | null
          first_clicked_at: string | null
          first_opened_at: string | null
          from_email: string
          from_name: string | null
          html: string
          id: string
          kind: string
          metadata: Json
          provider: string | null
          provider_message_id: string | null
          queued_at: string
          reply_to: string | null
          sent_at: string | null
          status: Database["public"]["Enums"]["message_status"]
          subject: string
          template_id: string | null
          text_body: string | null
          to_email: string
          to_name: string | null
          unsubscribe_token: string | null
          workflow_id: string | null
          workflow_run_id: string | null
          workspace_id: string
        }
        Insert: {
          attempts?: number
          bounced_at?: string | null
          campaign_id?: string | null
          contact_id?: string | null
          created_at?: string
          delivered_at?: string | null
          error?: string | null
          first_clicked_at?: string | null
          first_opened_at?: string | null
          from_email: string
          from_name?: string | null
          html?: string
          id?: string
          kind?: string
          metadata?: Json
          provider?: string | null
          provider_message_id?: string | null
          queued_at?: string
          reply_to?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["message_status"]
          subject: string
          template_id?: string | null
          text_body?: string | null
          to_email: string
          to_name?: string | null
          unsubscribe_token?: string | null
          workflow_id?: string | null
          workflow_run_id?: string | null
          workspace_id: string
        }
        Update: {
          attempts?: number
          bounced_at?: string | null
          campaign_id?: string | null
          contact_id?: string | null
          created_at?: string
          delivered_at?: string | null
          error?: string | null
          first_clicked_at?: string | null
          first_opened_at?: string | null
          from_email?: string
          from_name?: string | null
          html?: string
          id?: string
          kind?: string
          metadata?: Json
          provider?: string | null
          provider_message_id?: string | null
          queued_at?: string
          reply_to?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["message_status"]
          subject?: string
          template_id?: string | null
          text_body?: string | null
          to_email?: string
          to_name?: string | null
          unsubscribe_token?: string | null
          workflow_id?: string | null
          workflow_run_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_messages_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_messages_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_messages_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_messages_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      invites: {
        Row: {
          accepted_at: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string | null
          role: Database["public"]["Enums"]["app_role"]
          status: Database["public"]["Enums"]["invite_status"]
          token_hash: string
          workspace_id: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          email: string
          expires_at: string
          id?: string
          invited_by?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          status?: Database["public"]["Enums"]["invite_status"]
          token_hash: string
          workspace_id: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          status?: Database["public"]["Enums"]["invite_status"]
          token_hash?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "invites_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      memberships: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "memberships_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_color: string
          created_at: string
          email: string
          full_name: string | null
          id: string
          last_seen_at: string | null
          updated_at: string
        }
        Insert: {
          avatar_color?: string
          created_at?: string
          email: string
          full_name?: string | null
          id: string
          last_seen_at?: string | null
          updated_at?: string
        }
        Update: {
          avatar_color?: string
          created_at?: string
          email?: string
          full_name?: string | null
          id?: string
          last_seen_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      scheduled_jobs: {
        Row: {
          attempts: number
          created_at: string
          id: string
          kind: string
          last_error: string | null
          locked_at: string | null
          max_attempts: number
          payload: Json
          run_at: string
          status: Database["public"]["Enums"]["job_status"]
          updated_at: string
          workspace_id: string | null
        }
        Insert: {
          attempts?: number
          created_at?: string
          id?: string
          kind: string
          last_error?: string | null
          locked_at?: string | null
          max_attempts?: number
          payload?: Json
          run_at?: string
          status?: Database["public"]["Enums"]["job_status"]
          updated_at?: string
          workspace_id?: string | null
        }
        Update: {
          attempts?: number
          created_at?: string
          id?: string
          kind?: string
          last_error?: string | null
          locked_at?: string | null
          max_attempts?: number
          payload?: Json
          run_at?: string
          status?: Database["public"]["Enums"]["job_status"]
          updated_at?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "scheduled_jobs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      segment_memberships: {
        Row: {
          added_by: string
          contact_id: string
          created_at: string
          id: string
          segment_id: string
          workspace_id: string
        }
        Insert: {
          added_by?: string
          contact_id: string
          created_at?: string
          id?: string
          segment_id: string
          workspace_id: string
        }
        Update: {
          added_by?: string
          contact_id?: string
          created_at?: string
          id?: string
          segment_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "segment_memberships_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "segment_memberships_segment_id_fkey"
            columns: ["segment_id"]
            isOneToOne: false
            referencedRelation: "segments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "segment_memberships_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      segments: {
        Row: {
          cached_count: number | null
          conditions: Json
          created_at: string
          description: string | null
          id: string
          include_manually_added: boolean
          last_calculated_at: string | null
          match_mode: string
          name: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          cached_count?: number | null
          conditions?: Json
          created_at?: string
          description?: string | null
          id?: string
          include_manually_added?: boolean
          last_calculated_at?: string | null
          match_mode?: string
          name: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          cached_count?: number | null
          conditions?: Json
          created_at?: string
          description?: string | null
          id?: string
          include_manually_added?: boolean
          last_calculated_at?: string | null
          match_mode?: string
          name?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "segments_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      tags: {
        Row: {
          color: string
          created_at: string
          id: string
          name: string
          workspace_id: string
        }
        Insert: {
          color?: string
          created_at?: string
          id?: string
          name: string
          workspace_id: string
        }
        Update: {
          color?: string
          created_at?: string
          id?: string
          name?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tags_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      templates: {
        Row: {
          category: Database["public"]["Enums"]["template_category"]
          created_at: string
          created_by: string | null
          document: Json
          html: string
          id: string
          is_transactional: boolean
          name: string
          preheader: string | null
          subject: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          category?: Database["public"]["Enums"]["template_category"]
          created_at?: string
          created_by?: string | null
          document?: Json
          html?: string
          id?: string
          is_transactional?: boolean
          name: string
          preheader?: string | null
          subject?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          category?: Database["public"]["Enums"]["template_category"]
          created_at?: string
          created_by?: string | null
          document?: Json
          html?: string
          id?: string
          is_transactional?: boolean
          name?: string
          preheader?: string | null
          subject?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "templates_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_deliveries: {
        Row: {
          attempts: number
          completed_at: string | null
          created_at: string
          error: string | null
          event: string
          id: string
          payload: Json
          response_body: string | null
          response_code: number | null
          status: Database["public"]["Enums"]["job_status"]
          webhook_id: string
          workspace_id: string
        }
        Insert: {
          attempts?: number
          completed_at?: string | null
          created_at?: string
          error?: string | null
          event: string
          id?: string
          payload?: Json
          response_body?: string | null
          response_code?: number | null
          status?: Database["public"]["Enums"]["job_status"]
          webhook_id: string
          workspace_id: string
        }
        Update: {
          attempts?: number
          completed_at?: string | null
          created_at?: string
          error?: string | null
          event?: string
          id?: string
          payload?: Json
          response_body?: string | null
          response_code?: number | null
          status?: Database["public"]["Enums"]["job_status"]
          webhook_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "webhook_deliveries_webhook_id_fkey"
            columns: ["webhook_id"]
            isOneToOne: false
            referencedRelation: "webhooks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "webhook_deliveries_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      webhooks: {
        Row: {
          created_at: string
          description: string | null
          events: Json
          id: string
          is_active: boolean
          last_delivery_at: string | null
          last_error: string | null
          last_status: number | null
          secret: string
          updated_at: string
          url: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          events?: Json
          id?: string
          is_active?: boolean
          last_delivery_at?: string | null
          last_error?: string | null
          last_status?: number | null
          secret: string
          updated_at?: string
          url: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          events?: Json
          id?: string
          is_active?: boolean
          last_delivery_at?: string | null
          last_error?: string | null
          last_status?: number | null
          secret?: string
          updated_at?: string
          url?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "webhooks_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_enrollments: {
        Row: {
          completed_at: string | null
          contact_id: string
          context: Json
          created_at: string
          current_node_id: string | null
          id: string
          next_run_at: string | null
          status: Database["public"]["Enums"]["run_status"]
          workflow_id: string
          workspace_id: string
        }
        Insert: {
          completed_at?: string | null
          contact_id: string
          context?: Json
          created_at?: string
          current_node_id?: string | null
          id?: string
          next_run_at?: string | null
          status?: Database["public"]["Enums"]["run_status"]
          workflow_id: string
          workspace_id: string
        }
        Update: {
          completed_at?: string | null
          contact_id?: string
          context?: Json
          created_at?: string
          current_node_id?: string | null
          id?: string
          next_run_at?: string | null
          status?: Database["public"]["Enums"]["run_status"]
          workflow_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_enrollments_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_enrollments_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_enrollments_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_node_runs: {
        Row: {
          completed_at: string | null
          error: string | null
          id: string
          node_id: string
          node_type: string
          result: Json
          run_id: string
          started_at: string
          status: Database["public"]["Enums"]["run_status"]
          workflow_id: string
          workspace_id: string
        }
        Insert: {
          completed_at?: string | null
          error?: string | null
          id?: string
          node_id: string
          node_type: string
          result?: Json
          run_id: string
          started_at?: string
          status?: Database["public"]["Enums"]["run_status"]
          workflow_id: string
          workspace_id: string
        }
        Update: {
          completed_at?: string | null
          error?: string | null
          id?: string
          node_id?: string
          node_type?: string
          result?: Json
          run_id?: string
          started_at?: string
          status?: Database["public"]["Enums"]["run_status"]
          workflow_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_node_runs_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "workflow_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_node_runs_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_node_runs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_runs: {
        Row: {
          completed_at: string | null
          contact_id: string
          context: Json
          current_node_id: string | null
          enrollment_id: string | null
          error: string | null
          id: string
          started_at: string
          status: Database["public"]["Enums"]["run_status"]
          workflow_id: string
          workspace_id: string
        }
        Insert: {
          completed_at?: string | null
          contact_id: string
          context?: Json
          current_node_id?: string | null
          enrollment_id?: string | null
          error?: string | null
          id?: string
          started_at?: string
          status?: Database["public"]["Enums"]["run_status"]
          workflow_id: string
          workspace_id: string
        }
        Update: {
          completed_at?: string | null
          contact_id?: string
          context?: Json
          current_node_id?: string | null
          enrollment_id?: string | null
          error?: string | null
          id?: string
          started_at?: string
          status?: Database["public"]["Enums"]["run_status"]
          workflow_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_runs_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_runs_enrollment_id_fkey"
            columns: ["enrollment_id"]
            isOneToOne: false
            referencedRelation: "workflow_enrollments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_runs_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_runs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workflows: {
        Row: {
          activated_at: string | null
          created_at: string
          created_by: string | null
          definition: Json
          description: string | null
          id: string
          last_run_at: string | null
          name: string
          runs_count: number
          status: Database["public"]["Enums"]["workflow_status"]
          trigger: Json
          updated_at: string
          workspace_id: string
        }
        Insert: {
          activated_at?: string | null
          created_at?: string
          created_by?: string | null
          definition?: Json
          description?: string | null
          id?: string
          last_run_at?: string | null
          name: string
          runs_count?: number
          status?: Database["public"]["Enums"]["workflow_status"]
          trigger?: Json
          updated_at?: string
          workspace_id: string
        }
        Update: {
          activated_at?: string | null
          created_at?: string
          created_by?: string | null
          definition?: Json
          description?: string | null
          id?: string
          last_run_at?: string | null
          name?: string
          runs_count?: number
          status?: Database["public"]["Enums"]["workflow_status"]
          trigger?: Json
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflows_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          created_at: string
          from_name: string | null
          id: string
          name: string
          settings: Json
          slug: string
          timezone: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          from_name?: string | null
          id?: string
          name: string
          settings?: Json
          slug: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          from_name?: string | null
          id?: string
          name?: string
          settings?: Json
          slug?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      can_admin_workspace: { Args: { _workspace_id: string }; Returns: boolean }
      can_read_workspace: { Args: { _workspace_id: string }; Returns: boolean }
      can_write_workspace: { Args: { _workspace_id: string }; Returns: boolean }
      current_user_id: { Args: never; Returns: string }
      current_workspace_access: { Args: never; Returns: boolean }
      current_workspace_id: { Args: never; Returns: string }
      has_workspace_role: {
        Args: {
          _roles: Database["public"]["Enums"]["app_role"][]
          _workspace_id: string
        }
        Returns: boolean
      }
      lumail_exec: {
        Args: {
          p_claims: Json
          p_returns: boolean
          p_role: string
          p_sql: string
        }
        Returns: Json
      }
    }
    Enums: {
      app_role: "owner" | "admin" | "member"
      campaign_status:
        | "draft"
        | "scheduled"
        | "sending"
        | "sent"
        | "paused"
        | "cancelled"
      contact_status:
        | "subscribed"
        | "unsubscribed"
        | "bounced"
        | "complained"
        | "archived"
      domain_status: "pending" | "verified" | "failed"
      event_type:
        | "created"
        | "updated"
        | "tag_added"
        | "tag_removed"
        | "segment_added"
        | "segment_removed"
        | "queued"
        | "sent"
        | "delivered"
        | "opened"
        | "clicked"
        | "bounced"
        | "complained"
        | "unsubscribed"
        | "purchased"
        | "workflow_enrolled"
        | "workflow_completed"
        | "custom"
      invite_status: "pending" | "accepted" | "revoked" | "expired"
      job_status:
        | "pending"
        | "processing"
        | "completed"
        | "failed"
        | "cancelled"
      message_status:
        | "queued"
        | "sent"
        | "delivered"
        | "opened"
        | "clicked"
        | "bounced"
        | "complained"
        | "unsubscribed"
        | "failed"
      run_status: "running" | "waiting" | "completed" | "failed" | "cancelled"
      template_category:
        | "newsletter"
        | "welcome"
        | "product_update"
        | "transactional"
        | "promotion"
        | "onboarding"
      workflow_status: "draft" | "active" | "paused" | "archived"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      app_role: ["owner", "admin", "member"],
      campaign_status: [
        "draft",
        "scheduled",
        "sending",
        "sent",
        "paused",
        "cancelled",
      ],
      contact_status: [
        "subscribed",
        "unsubscribed",
        "bounced",
        "complained",
        "archived",
      ],
      domain_status: ["pending", "verified", "failed"],
      event_type: [
        "created",
        "updated",
        "tag_added",
        "tag_removed",
        "segment_added",
        "segment_removed",
        "queued",
        "sent",
        "delivered",
        "opened",
        "clicked",
        "bounced",
        "complained",
        "unsubscribed",
        "purchased",
        "workflow_enrolled",
        "workflow_completed",
        "custom",
      ],
      invite_status: ["pending", "accepted", "revoked", "expired"],
      job_status: ["pending", "processing", "completed", "failed", "cancelled"],
      message_status: [
        "queued",
        "sent",
        "delivered",
        "opened",
        "clicked",
        "bounced",
        "complained",
        "unsubscribed",
        "failed",
      ],
      run_status: ["running", "waiting", "completed", "failed", "cancelled"],
      template_category: [
        "newsletter",
        "welcome",
        "product_update",
        "transactional",
        "promotion",
        "onboarding",
      ],
      workflow_status: ["draft", "active", "paused", "archived"],
    },
  },
} as const
