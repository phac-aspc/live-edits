/*
  # Page Editor and Comments System Schema

  ## Overview
  This migration creates tables for storing page edits and comments for a WYSIWYG editing system
  that can be embedded in any HTML page.

  ## New Tables
  
  ### `page_edits`
  Stores the complete edit history for pages
  - `id` (uuid, primary key) - Unique identifier for each edit
  - `page_url` (text) - The URL/identifier of the page being edited
  - `html_content` (text) - The complete HTML content after edits
  - `edited_by` (text) - Initials of the user who made the edit
  - `created_at` (timestamptz) - Timestamp when the edit was saved
  
  ### `comments`
  Stores comments placed on pages
  - `id` (uuid, primary key) - Unique identifier for each comment
  - `page_url` (text) - The URL/identifier of the page
  - `comment_text` (text) - The comment content
  - `x_position` (integer) - X coordinate where comment was placed
  - `y_position` (integer) - Y coordinate where comment was placed
  - `initials` (text) - Initials of the commenter
  - `created_at` (timestamptz) - Timestamp when comment was created
  
  ## Indexes
  - Index on page_url for fast lookups
  - Index on created_at for chronological ordering
  
  ## Security
  - Enable RLS on both tables
  - Public read access (anyone can view edits and comments)
  - Public write access (anyone can add edits and comments)
  
  ## Notes
  This is designed for collaborative editing where authentication is not required,
  using initials as a simple attribution mechanism.
*/

-- Create page_edits table
CREATE TABLE IF NOT EXISTS page_edits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  page_url text NOT NULL,
  html_content text NOT NULL,
  edited_by text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Create comments table
CREATE TABLE IF NOT EXISTS comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  page_url text NOT NULL,
  comment_text text NOT NULL,
  x_position integer NOT NULL,
  y_position integer NOT NULL,
  initials text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_page_edits_page_url ON page_edits(page_url);
CREATE INDEX IF NOT EXISTS idx_page_edits_created_at ON page_edits(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comments_page_url ON comments(page_url);
CREATE INDEX IF NOT EXISTS idx_comments_created_at ON comments(created_at DESC);

-- Enable Row Level Security
ALTER TABLE page_edits ENABLE ROW LEVEL SECURITY;
ALTER TABLE comments ENABLE ROW LEVEL SECURITY;

-- Create policies for public access (since this is a collaborative tool without auth)
CREATE POLICY "Allow public read access to page edits"
  ON page_edits FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Allow public insert of page edits"
  ON page_edits FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "Allow public read access to comments"
  ON comments FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Allow public insert of comments"
  ON comments FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "Allow public delete of comments"
  ON comments FOR DELETE
  TO anon
  USING (true);
