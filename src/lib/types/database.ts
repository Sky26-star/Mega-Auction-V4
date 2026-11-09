// src/lib/types/database.ts
// Database TypeScript Definitions for Mega Auction V1

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          username: string;
          display_name: string;
          avatar_url: string | null;
          /** Private server authorization flag; never include in ordinary projections. */
          is_admin: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          username: string;
          display_name: string;
          avatar_url?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          display_name?: string;
          avatar_url?: string | null;
        };
      };
      // Other table placeholders...
      [key: string]: unknown;
    };
    Views: Record<string, unknown>;
    Functions: {
      get_room_public_profiles: {
        Args: { p_room_ids: string[] };
        Returns: Array<{
          room_id: string;
          id: string;
          username: string;
          display_name: string;
          avatar_url: string | null;
        }>;
      };
      get_room_preview_by_code: {
        Args: { p_code: string };
        Returns: Array<{
          room_id: string;
          code: string;
          name: string;
          host_id: string;
          status: string;
          settings: Json;
          player_set_name: string | null;
          host_profile_id: string;
          host_username: string;
          host_display_name: string;
          host_avatar_url: string | null;
        }>;
      };
    };
    Enums: Record<string, unknown>;
  };
}
