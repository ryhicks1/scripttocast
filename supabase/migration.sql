-- ScriptToCast — full Supabase schema.
--
-- Idempotent: safe to run more than once against the same project. Policies are
-- dropped and recreated because Postgres has no CREATE POLICY IF NOT EXISTS.
--
-- Row-level security is enabled on every table here. The app's page components
-- query Supabase with the user-scoped (anon key + session) client, so RLS is the
-- real access control, not a formality. The anon key ships to every browser: if
-- RLS is off, anyone holding it can read every row in these tables directly.

-- ---------------------------------------------------------------------------
-- s2c_projects — saved analyses
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.s2c_projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'Untitled',
  -- The AnalysisResult JSON: project metadata, roles, self-tape instructions,
  -- form questions. Derived from the uploaded script, never the script itself.
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Placeholder, currently always []. Do NOT repurpose this to store uploaded
  -- scripts. Raw documents are deliberately never persisted — they exist only
  -- in memory for the duration of an /api/analyze request. Storing them here
  -- would put customer IP at rest in a database that is not designed for it.
  documents JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The dashboard lists a user's projects newest first.
CREATE INDEX IF NOT EXISTS s2c_projects_user_created_idx
  ON public.s2c_projects (user_id, created_at DESC);

ALTER TABLE public.s2c_projects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own projects" ON public.s2c_projects;
CREATE POLICY "Users read own projects"
  ON public.s2c_projects FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users insert own projects" ON public.s2c_projects;
CREATE POLICY "Users insert own projects"
  ON public.s2c_projects FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users update own projects" ON public.s2c_projects;
CREATE POLICY "Users update own projects"
  ON public.s2c_projects FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users delete own projects" ON public.s2c_projects;
CREATE POLICY "Users delete own projects"
  ON public.s2c_projects FOR DELETE USING (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- user_settings — per-user branding for generated PDFs
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.user_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_name TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  contact_website TEXT,
  brand_color TEXT DEFAULT '#00BFA5',
  header_text TEXT,
  footer_text TEXT,
  logo_path TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id)
);

ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own settings" ON public.user_settings;
CREATE POLICY "Users can read own settings"
  ON public.user_settings FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own settings" ON public.user_settings;
CREATE POLICY "Users can insert own settings"
  ON public.user_settings FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own settings" ON public.user_settings;
CREATE POLICY "Users can update own settings"
  ON public.user_settings FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own settings" ON public.user_settings;
CREATE POLICY "Users can delete own settings"
  ON public.user_settings FOR DELETE USING (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- logos storage bucket
-- ---------------------------------------------------------------------------
-- Public read: logos are embedded in generated PDFs via getPublicUrl(). Only
-- user-uploaded company logos belong here. Never scripts or breakdowns.

INSERT INTO storage.buckets (id, name, public) VALUES ('logos', 'logos', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Users upload own logos" ON storage.objects;
CREATE POLICY "Users upload own logos"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'logos' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "Users update own logos" ON storage.objects;
CREATE POLICY "Users update own logos"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'logos' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "Users delete own logos" ON storage.objects;
CREATE POLICY "Users delete own logos"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'logos' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "Public logo read" ON storage.objects;
CREATE POLICY "Public logo read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'logos');
