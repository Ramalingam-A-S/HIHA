-- Migration: 20261009130000_create_interests.sql
-- Description: Create interests catalog, user_interests preference mapping, constraints, indexes, and Row Level Security.

-- 1. Create interests catalog table
CREATE TABLE IF NOT EXISTS public.interests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT,
  is_custom BOOLEAN NOT NULL DEFAULT false,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT interest_slug_format CHECK (slug ~ '^[a-z0-9_-]{2,60}$'),
  CONSTRAINT interest_slug_lowercase CHECK (slug = lower(slug)),
  CONSTRAINT interest_name_length CHECK (char_length(trim(name)) >= 1 AND char_length(name) <= 60),
  CONSTRAINT interest_description_length CHECK (description IS NULL OR char_length(description) <= 250)
);

CREATE INDEX IF NOT EXISTS idx_interests_category ON public.interests (category);
CREATE INDEX IF NOT EXISTS idx_interests_slug ON public.interests (slug);
CREATE INDEX IF NOT EXISTS idx_interests_created_by ON public.interests (created_by) WHERE created_by IS NOT NULL;

-- 2. Create user_interests preference mapping table
CREATE TABLE IF NOT EXISTS public.user_interests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  interest_id UUID NOT NULL REFERENCES public.interests(id) ON DELETE CASCADE,
  priority INT NOT NULL DEFAULT 2,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT user_interest_unique UNIQUE (user_id, interest_id),
  CONSTRAINT user_interest_priority_range CHECK (priority BETWEEN 1 AND 5)
);

CREATE INDEX IF NOT EXISTS idx_user_interests_user_id ON public.user_interests (user_id);
CREATE INDEX IF NOT EXISTS idx_user_interests_interest_id ON public.user_interests (interest_id);
CREATE INDEX IF NOT EXISTS idx_user_interests_user_priority ON public.user_interests (user_id, priority DESC);

-- Grants for Data API
GRANT SELECT ON public.interests TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.interests TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_interests TO authenticated;
GRANT SELECT ON public.user_interests TO anon;

-- 3. Row Level Security for interests
ALTER TABLE public.interests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Interests catalog is viewable by everyone" ON public.interests;
CREATE POLICY "Interests catalog is viewable by everyone"
  ON public.interests
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Users can create custom interests" ON public.interests;
CREATE POLICY "Users can create custom interests"
  ON public.interests
  FOR INSERT
  TO authenticated
  WITH CHECK (
    is_custom = true
    AND
    (select auth.uid()) = created_by
  );

DROP POLICY IF EXISTS "Users can update their own custom interests" ON public.interests;
CREATE POLICY "Users can update their own custom interests"
  ON public.interests
  FOR UPDATE
  TO authenticated
  USING (
    is_custom = true
    AND
    (select auth.uid()) = created_by
  )
  WITH CHECK (
    is_custom = true
    AND
    (select auth.uid()) = created_by
  );

DROP POLICY IF EXISTS "Users can delete their own custom interests" ON public.interests;
CREATE POLICY "Users can delete their own custom interests"
  ON public.interests
  FOR DELETE
  TO authenticated
  USING (
    is_custom = true
    AND
    (select auth.uid()) = created_by
  );

-- 4. Row Level Security for user_interests
ALTER TABLE public.user_interests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own preferences" ON public.user_interests;
CREATE POLICY "Users can view own preferences"
  ON public.user_interests
  FOR SELECT
  TO authenticated
  USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can add own preferences" ON public.user_interests;
CREATE POLICY "Users can add own preferences"
  ON public.user_interests
  FOR INSERT
  TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can update own preferences" ON public.user_interests;
CREATE POLICY "Users can update own preferences"
  ON public.user_interests
  FOR UPDATE
  TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can delete own preferences" ON public.user_interests;
CREATE POLICY "Users can delete own preferences"
  ON public.user_interests
  FOR DELETE
  TO authenticated
  USING ((select auth.uid()) = user_id);

-- 5. Seed Predefined Interests Catalog (Idempotent)
INSERT INTO public.interests (slug, name, category, description, is_custom) VALUES
  -- Technology & Science
  ('artificial-intelligence', 'Artificial Intelligence', 'technology-science', 'Machine learning, neural networks, ethics in AI, and applications', false),
  ('programming-software', 'Programming & Software', 'technology-science', 'Software engineering, open-source architectures, languages, and tools', false),
  ('robotics-automation', 'Robotics & Automation', 'technology-science', 'Autonomous systems, hardware control, mechatronics, and sensing', false),
  ('electronics-hardware', 'Electronics & Hardware', 'technology-science', 'Circuit design, embedded microcontrollers, and computing hardware', false),
  ('space-astrophysics', 'Space & Astrophysics', 'technology-science', 'Astronomical observation, cosmology, space exploration, and satellites', false),

  -- Education & Learning
  ('mathematics', 'Mathematics', 'education-learning', 'Pure and applied mathematics, statistics, graph theory, and proofs', false),
  ('history-archaeology', 'History & Archaeology', 'education-learning', 'Global civilizations, historical analysis, and archival discoveries', false),
  ('languages-linguistics', 'Languages & Linguistics', 'education-learning', 'Language acquisition, historical linguistics, grammar, and communication', false),
  ('philosophy-ethics', 'Philosophy & Ethics', 'education-learning', 'Moral philosophy, epistemology, logic, and societal values', false),

  -- Art & Design
  ('digital-art', 'Digital Art & Illustration', 'art-design', 'Visual arts, graphic illustration, digital painting, and visual identity', false),
  ('filmmaking', 'Filmmaking & Cinematography', 'art-design', 'Visual storytelling, directing, editing, sound design, and screenwriting', false),
  ('music-production', 'Music Production', 'art-design', 'Audio composition, synthesis, acoustic design, and recording arts', false),
  ('architecture-urbanism', 'Architecture & Urbanism', 'art-design', 'Built environment, sustainable architecture, and human-scale urban design', false),
  ('typography-ui', 'Typography & UI Design', 'art-design', 'Digital design systems, typography hierarchy, and accessible UX design', false),

  -- Sports & Fitness
  ('strength-conditioning', 'Strength & Conditioning', 'sports-fitness', 'Resistance training, physical resilience, and biomechanics', false),
  ('running-athletics', 'Running & Athletics', 'sports-fitness', 'Endurance training, track and field, and aerobic conditioning', false),
  ('cycling-outdoors', 'Cycling & Outdoor Adventure', 'sports-fitness', 'Bicycling, trail navigation, mountaineering, and hiking', false),
  ('team-sports', 'Team Sports', 'sports-fitness', 'Collaborative athletics, match analysis, and community sports', false),

  -- Entertainment & Gaming
  ('game-development', 'Game Design & Development', 'entertainment-gaming', 'Interactive systems, gameplay mechanics, level design, and game engines', false),
  ('interactive-storytelling', 'Interactive Storytelling', 'entertainment-gaming', 'Branching narratives, worldbuilding, and immersive game media', false),
  ('animation', 'Animation & Motion', 'entertainment-gaming', '2D/3D motion graphics, character animation, and visual effects', false),
  ('tabletop-games', 'Tabletop & Strategy Games', 'entertainment-gaming', 'Board games, card strategies, and cooperative puzzle systems', false),

  -- Personal Stories & Lifestyle
  ('intentional-living', 'Intentional Living', 'personal-stories-lifestyle', 'Digital minimalism, productivity balance, and conscious daily choices', false),
  ('culinary-arts', 'Culinary Arts & Cooking', 'personal-stories-lifestyle', 'Gastronomy, home cooking technique, fermentation, and food culture', false),
  ('sustainable-travel', 'Sustainable Travel', 'personal-stories-lifestyle', 'Low-impact journeying, cultural immersion, and local exploration', false),
  ('diy-crafting', 'DIY & Crafting', 'personal-stories-lifestyle', 'Handmade craftsmanship, repair culture, and functional woodworking', false),

  -- Social Causes & Community
  ('environmental-conservation', 'Environmental Conservation', 'social-causes-community', 'Ecology, renewable systems, biodiversity, and conservation efforts', false),
  ('digital-rights-privacy', 'Digital Rights & Privacy', 'social-causes-community', 'User agency, open internet protocols, surveillance defense, and privacy rights', false),
  ('civic-collaboration', 'Civic Collaboration', 'social-causes-community', 'Local mutual aid, community resilience, and democratic governance', false),
  ('open-source-commons', 'Open Source Commons', 'social-causes-community', 'Public digital goods, copyleft licensing, and collective knowledge', false),

  -- Business & Careers
  ('product-engineering', 'Product Engineering', 'business-careers', 'Problem discovery, user research, agile delivery, and platform scalability', false),
  ('ethical-entrepreneurship', 'Ethical Entrepreneurship', 'business-careers', 'Sustainable revenue models, worker empowerment, and transparent commerce', false),
  ('career-transitions', 'Career Transitions', 'business-careers', 'Skill pivoting, mentorship, technical craftsmanship, and lifelong learning', false),
  ('cooperative-business', 'Cooperative Business', 'business-careers', 'Worker-owned enterprises, platform cooperatives, and equitable labor', false),

  -- Health & Well-being
  ('mental-health-mindfulness', 'Mental Health & Mindfulness', 'health-wellbeing', 'Stress reduction, cognitive behavioral habits, and reflective practices', false),
  ('sleep-science', 'Sleep Science & Circadian Health', 'health-wellbeing', 'Restorative sleep architecture, circadian rhythm alignment, and recovery', false),
  ('nutrition-biochemistry', 'Nutrition & Metabolic Health', 'health-wellbeing', 'Nutritional science, metabolic health markers, and balanced nourishment', false),
  ('preventive-health', 'Preventive Health & Longevity', 'health-wellbeing', 'Long-term health span, physical mobility, and evidence-based self-care', false)
ON CONFLICT (slug) DO NOTHING;
