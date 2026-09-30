CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin','editor','translator','member')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS articles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), title TEXT NOT NULL, category TEXT NOT NULL,
  format TEXT NOT NULL DEFAULT 'Bài viết', body TEXT NOT NULL DEFAULT '', snippet TEXT NOT NULL DEFAULT '',
  tags JSONB NOT NULL DEFAULT '[]'::jsonb, citations TEXT NOT NULL DEFAULT '',
  visibility TEXT NOT NULL DEFAULT 'Công khai' CHECK (visibility IN ('Công khai','Chỉ thành viên','Lưu trữ cá nhân')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  author_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, cover_file_id UUID,
  version INTEGER NOT NULL DEFAULT 1, views INTEGER NOT NULL DEFAULT 0, saved INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS article_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), article_id UUID NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  version INTEGER NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, citations TEXT NOT NULL DEFAULT '',
  editor_id UUID REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), owner_id UUID REFERENCES users(id) ON DELETE SET NULL,
  name TEXT NOT NULL, mime_type TEXT NOT NULL, size_bytes BIGINT NOT NULL, data BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS bookmarks (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  article_id UUID NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (user_id, article_id)
);
CREATE TABLE IF NOT EXISTS translations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), source_file_id UUID REFERENCES files(id) ON DELETE CASCADE,
  chapter TEXT NOT NULL DEFAULT '', source_text TEXT NOT NULL DEFAULT '', translated_text TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '', progress INTEGER NOT NULL DEFAULT 0,
  editor_id UUID REFERENCES users(id) ON DELETE SET NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  name TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_articles_updated ON articles(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_articles_category ON articles(category);
CREATE INDEX IF NOT EXISTS idx_articles_status ON articles(status);
CREATE INDEX IF NOT EXISTS idx_files_owner ON files(owner_id);
CREATE INDEX IF NOT EXISTS idx_feedback_created ON feedback(created_at DESC);
