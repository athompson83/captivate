/**
 * Hand-maintained database types.
 *
 * These mirror supabase/migrations/*.sql. Regenerate with:
 *   npx supabase gen types typescript --project-id <ref> > src/lib/supabase/database.types.ts
 * when a service-role connection is available; until then this file is the
 * source of truth for the client and is kept in step with the migrations.
 */

export type Json = string | number | boolean | null | { [k: string]: Json | undefined } | Json[];

type Timestamps = { created_at: string; updated_at: string };

export type ProfileRow = Timestamps & {
  id: string;
  display_name: string;
  avatar_url: string | null;
  theme_pref: "system" | "light" | "dark";
  onboarded_at: string | null;
};

export type FolderRow = Timestamps & {
  id: string;
  owner_id: string;
  name: string;
  color: "neutral" | "gold" | "orchid" | "teal" | "rose" | "blue" | "green";
  position: number;
};

export type PresentationRow = Timestamps & {
  id: string;
  owner_id: string;
  folder_id: string | null;
  title: string;
  description: string;
  theme_id: string;
  theme_overrides: Json | null;
  aspect_ratio: "16:9" | "16:10" | "4:3";
  journey: Json;
  tags: string[];
  is_favorite: boolean;
  thumbnail_url: string | null;
  schema_version: number;
  last_opened_at: string | null;
  deleted_at: string | null;
  /** Planned running time. 0 = the author has not stated one. */
  target_seconds: number;
  /** View-only link token. Null = not shared. */
  share_token: string | null;
};

export type SectionRow = Timestamps & {
  id: string;
  presentation_id: string;
  title: string;
  label: string;
  purpose: string;
  position: number;
};

/** A narrative moment. The pre-generation unit; `sections` are its movements. */
export type MomentRow = Timestamps & {
  id: string;
  presentation_id: string;
  movement_id: string | null;
  position: number;
  title: string;
  role: string;
  purpose: string;
  takeaway: string;
  estimated_seconds: number;
  evidence: Json;
  visual_intent: string;
  instructions: string;
  locked: boolean;
};

export type SceneRow = Timestamps & {
  id: string;
  presentation_id: string;
  section_id: string | null;
  position: number;
  title: string;
  content: Json;
  placement: Json | null;
  moment_id: string | null;
  speaker_notes: string;
  duration_seconds: number | null;
  flow_role: "main" | "detail";
  schema_version: number;
};

export type LectureNoteRow = Timestamps & {
  id: string;
  owner_id: string;
  presentation_id: string | null;
  section_id: string | null;
  scene_id: string | null;
  title: string;
  body: string;
  position: number;
};

export type AssetRow = {
  id: string;
  owner_id: string;
  presentation_id: string | null;
  storage_path: string;
  kind: "image" | "video" | "audio" | "file";
  mime_type: string;
  byte_size: number;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  alt_text: string;
  original_filename: string;
  created_at: string;
  /** Where this image came from. Everything below is null for an upload. */
  source: "upload" | "stock" | "generated";
  provider: string | null;
  provider_asset_id: string | null;
  original_page_url: string | null;
  creator_name: string | null;
  creator_page_url: string | null;
  license_ref: string | null;
  verified_at: string | null;
  model: string | null;
  prompt: string | null;
  quality: string | null;
  generation_ms: number | null;
};

export type RecordingRow = Timestamps & {
  id: string;
  owner_id: string;
  presentation_id: string | null;
  title: string;
  storage_path: string | null;
  mime_type: string;
  byte_size: number;
  duration_seconds: number;
  status: "recording" | "uploading" | "ready" | "failed" | "local_only";
  has_camera: boolean;
  has_microphone: boolean;
  scene_timeline: Json;
  transcript: Json;
  error_message: string | null;
};

/** A phone-remote pairing. The Realtime topic is derived from `id`. */
export type PresentationSessionRow = {
  id: string;
  owner_id: string;
  presentation_id: string;
  status: "active" | "ended";
  created_at: string;
  expires_at: string;
  ended_at: string | null;
};

export type AiGenerationRow = {
  id: string;
  owner_id: string;
  presentation_id: string | null;
  kind: string;
  prompt: string;
  status: "pending" | "succeeded" | "failed" | "invalid_output";
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
  /** What this call cost, reserved at an estimate and reconciled after. */
  cost_usd: number;
  /** How long the provider took. Not tokens — an image response has none. */
  duration_ms: number | null;
};

type Table<Row, Insert = Partial<Row>, Update = Partial<Row>> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

export type BillingCustomerRow = {
  user_id: string;
  stripe_customer_id: string;
  created_at: string;
};

export type SubscriptionRow = {
  user_id: string;
  stripe_subscription_id: string;
  status: string;
  price_id: string;
  /**
   * The tier this subscription grants, resolved from `price_id` at the moment
   * the webhook wrote the row. Stored rather than re-derived: a Stripe price is
   * immutable, so a price change means a new price and a rotated variable, and
   * re-deriving would then resolve the old price to nothing and silently move
   * its holder to the lowest paid tier. Null only for rows written before
   * `0022_plan_budgets.sql`.
   */
  plan: "basic" | "pro" | null;
  billing_interval: "month" | "year";
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  updated_from_event_at: string;
  updated_at: string;
};

/** An entitlement granted rather than bought — see `0019_plan_grants.sql`. */
export type PlanGrantRow = {
  user_id: string;
  plan: "pro" | "unlimited";
  note: string;
  granted_at: string;
  expires_at: string | null;
};

export type StripeEventRow = {
  id: string;
  type: string;
  received_at: string;
};

export type Database = {
  public: {
    Tables: {
      profiles: Table<ProfileRow>;
      folders: Table<FolderRow>;
      presentations: Table<PresentationRow>;
      sections: Table<SectionRow>;
      scenes: Table<SceneRow>;
      moments: Table<MomentRow>;
      lecture_notes: Table<LectureNoteRow>;
      assets: Table<AssetRow>;
      recordings: Table<RecordingRow>;
      ai_generations: Table<AiGenerationRow>;
      presentation_sessions: Table<PresentationSessionRow>;
      billing_customers: Table<BillingCustomerRow>;
      subscriptions: Table<SubscriptionRow>;
      plan_grants: Table<PlanGrantRow>;
      stripe_events: Table<StripeEventRow>;
    };
    Views: Record<never, never>;
    Functions: {
      captivate_owns_presentation: {
        Args: { p_id: string };
        Returns: boolean;
      };
      captivate_set_scene_placements: {
        Args: { p_presentation_id: string; p_placements: Json };
        Returns: number;
      };
      captivate_replace_moments: {
        Args: { p_presentation_id: string; p_moments: Json };
        Returns: number;
      };
      captivate_shared_presentation: {
        Args: { p_token: string };
        Returns: Json;
      };
      captivate_shared_asset: {
        Args: { p_asset_id: string };
        Returns: { storage_path: string; mime_type: string }[];
      };
      captivate_remote_topic_open: {
        Args: { p_topic: string };
        Returns: boolean;
      };
      captivate_count_generations: {
        Args: {
          p_count_kinds: string[];
          p_window_minutes: number;
        };
        Returns: number;
      };
      captivate_reserve_generation: {
        Args: {
          p_kind: string;
          p_group: string;
          p_prompt: string;
          p_presentation_id: string | null;
        };
        Returns: {
          id: string | null;
          refusal: string | null;
          limit_max: number | null;
          limit_minutes: number | null;
        }[];
      };
      captivate_current_plan: {
        Args: Record<string, never>;
        Returns: string;
      };
      captivate_complete_generation: {
        Args: {
          p_id: string;
          p_status: string;
          p_model: string | null;
          p_input_tokens: number | null;
          p_output_tokens: number | null;
          p_error: string | null;
        };
        Returns: boolean;
      };
      captivate_reserve_image_generation: {
        Args: {
          p_prompt: string;
          p_presentation_id: string | null;
        };
        Returns: { id: string | null; refusal: string | null; daily_max: number | null }[];
      };
      captivate_settle_image_generation: {
        Args: {
          p_id: string;
          p_status: string;
          p_model: string | null;
          p_generation_ms: number | null;
          p_error: string | null;
        };
        Returns: boolean;
      };
      captivate_asset_object_is_shared: {
        Args: { p_storage_path: string };
        Returns: boolean;
      };
    };
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
  };
};
