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

export interface ProfileRow extends Timestamps {
  id: string;
  display_name: string;
  avatar_url: string | null;
  theme_pref: "system" | "light" | "dark";
  onboarded_at: string | null;
}

export interface FolderRow extends Timestamps {
  id: string;
  owner_id: string;
  name: string;
  color: "neutral" | "gold" | "orchid" | "teal" | "rose" | "blue" | "green";
  position: number;
}

export interface PresentationRow extends Timestamps {
  id: string;
  owner_id: string;
  folder_id: string | null;
  title: string;
  description: string;
  theme_id: string;
  theme_overrides: Json | null;
  aspect_ratio: "16:9" | "16:10" | "4:3";
  tags: string[];
  is_favorite: boolean;
  thumbnail_url: string | null;
  schema_version: number;
  last_opened_at: string | null;
  deleted_at: string | null;
}

export interface SectionRow extends Timestamps {
  id: string;
  presentation_id: string;
  title: string;
  position: number;
}

export interface SceneRow extends Timestamps {
  id: string;
  presentation_id: string;
  section_id: string | null;
  position: number;
  title: string;
  content: Json;
  speaker_notes: string;
  duration_seconds: number | null;
  schema_version: number;
}

export interface LectureNoteRow extends Timestamps {
  id: string;
  owner_id: string;
  presentation_id: string | null;
  section_id: string | null;
  scene_id: string | null;
  title: string;
  body: string;
  position: number;
}

export interface AssetRow {
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
}

export interface RecordingRow extends Timestamps {
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
  error_message: string | null;
}

export interface AiGenerationRow {
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
}

type Table<Row, Insert = Partial<Row>, Update = Partial<Row>> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

export interface Database {
  public: {
    Tables: {
      profiles: Table<ProfileRow>;
      folders: Table<FolderRow>;
      presentations: Table<PresentationRow>;
      sections: Table<SectionRow>;
      scenes: Table<SceneRow>;
      lecture_notes: Table<LectureNoteRow>;
      assets: Table<AssetRow>;
      recordings: Table<RecordingRow>;
      ai_generations: Table<AiGenerationRow>;
    };
    Views: Record<never, never>;
    Functions: {
      captivate_owns_presentation: {
        Args: { p_id: string };
        Returns: boolean;
      };
    };
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
  };
}
