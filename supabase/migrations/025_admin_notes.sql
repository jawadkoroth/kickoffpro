-- Migration: Admin Notes System
-- Internal-only notes for order operations, visible only to admins

-- Create admin_notes table
CREATE TABLE IF NOT EXISTS admin_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    admin_id UUID NOT NULL,
    admin_email TEXT NOT NULL,
    content TEXT NOT NULL CHECK (char_length(content) <= 1000),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_admin_notes_order_id ON admin_notes(order_id);
CREATE INDEX IF NOT EXISTS idx_admin_notes_created_at ON admin_notes(created_at DESC);

-- RLS: Enable row level security
ALTER TABLE admin_notes ENABLE ROW LEVEL SECURITY;

-- RLS: Admin-only access policy
-- Only admins can view, insert, update notes
CREATE POLICY admin_notes_admin_all ON admin_notes
    FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM admin_users
            WHERE admin_users.id = auth.uid()
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM admin_users
            WHERE admin_users.id = auth.uid()
        )
    );

-- Function to auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_admin_notes_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update updated_at
DROP TRIGGER IF EXISTS trigger_admin_notes_updated_at ON admin_notes;
CREATE TRIGGER trigger_admin_notes_updated_at
    BEFORE UPDATE ON admin_notes
    FOR EACH ROW
    EXECUTE FUNCTION update_admin_notes_updated_at();

-- Comment for documentation
COMMENT ON TABLE admin_notes IS 'Internal admin notes for orders - admin only, never exposed to customers';
COMMENT ON COLUMN admin_notes.content IS 'Note content, max 1000 characters';
COMMENT ON COLUMN admin_notes.admin_email IS 'Email of admin who created the note (for display)';
