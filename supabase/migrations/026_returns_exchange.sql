-- Migration: Returns & Exchange System
-- Foundation architecture for return/exchange flow

-- Create return_requests table
CREATE TABLE IF NOT EXISTS return_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Relationships
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    order_item_id UUID NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    
    -- Request type and status
    type TEXT NOT NULL CHECK (type IN ('return', 'exchange')),
    status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN (
        'requested',
        'under_review',
        'approved',
        'rejected',
        'pickup_scheduled',
        'picked_up',
        'in_transit',
        'received',
        'inspection',
        'refund_issued',
        'exchange_shipped',
        'completed',
        'cancelled'
    )),
    
    -- User input
    reason TEXT NOT NULL,
    reason_details TEXT,
    images TEXT[], -- Array of storage URLs
    
    -- Admin review
    admin_notes TEXT,
    reviewed_by UUID REFERENCES auth.users(id),
    reviewed_at TIMESTAMPTZ,
    rejection_reason TEXT,
    
    -- Pickup/shipping details
    pickup_address JSONB,
    pickup_scheduled_at TIMESTAMPTZ,
    pickup_tracking_id TEXT,
    
    -- For exchanges (store desired product/size as text; no FK due to size being JSONB)
    exchange_product_id UUID REFERENCES products(id),
    exchange_size TEXT,
    exchange_order_id UUID REFERENCES orders(id),
    
    -- Financial tracking
    refund_amount_paise INTEGER NOT NULL DEFAULT 0,
    refund_method TEXT NOT NULL DEFAULT 'original' CHECK (refund_method IN ('original', 'store_credit', 'bank_transfer')),
    refund_processed_at TIMESTAMPTZ,
    
    -- Item condition on receipt
    received_condition TEXT CHECK (received_condition IN ('excellent', 'good', 'damaged', 'missing_parts')),
    restocking_fee_paise INTEGER DEFAULT 0,
    
    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ
);

-- Return request history for audit trail
CREATE TABLE IF NOT EXISTS return_request_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    return_request_id UUID NOT NULL REFERENCES return_requests(id) ON DELETE CASCADE,
    previous_status TEXT,
    new_status TEXT NOT NULL,
    changed_by UUID REFERENCES auth.users(id),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_return_requests_order_id ON return_requests(order_id);
CREATE INDEX IF NOT EXISTS idx_return_requests_user_id ON return_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_return_requests_status ON return_requests(status);
CREATE INDEX IF NOT EXISTS idx_return_requests_created_at ON return_requests(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_return_requests_status_created ON return_requests(status, created_at);
CREATE INDEX IF NOT EXISTS idx_return_history_request_id ON return_request_history(return_request_id);

-- RLS: Enable row level security
ALTER TABLE return_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE return_request_history ENABLE ROW LEVEL SECURITY;

-- RLS: Users can only see their own return requests
CREATE POLICY return_requests_user_own ON return_requests
    FOR SELECT
    TO authenticated
    USING (user_id = auth.uid());

-- RLS: Admins can see and modify all return requests
CREATE POLICY return_requests_admin_all ON return_requests
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

-- RLS: Users can insert their own return requests (but only for their orders)
CREATE POLICY return_requests_user_insert ON return_requests
    FOR INSERT
    TO authenticated
    WITH CHECK (
        user_id = auth.uid() AND
        EXISTS (
            SELECT 1 FROM orders
            WHERE orders.id = order_id
            AND orders.user_id = auth.uid()
        )
    );

-- RLS: Users can update only to cancel their pending requests
CREATE POLICY return_requests_user_update ON return_requests
    FOR UPDATE
    TO authenticated
    USING (user_id = auth.uid() AND status IN ('requested', 'under_review'))
    WITH CHECK (user_id = auth.uid());

-- RLS: History visible to admins and involved user
CREATE POLICY return_history_user_view ON return_request_history
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM return_requests
            WHERE return_requests.id = return_request_history.return_request_id
            AND return_requests.user_id = auth.uid()
        )
        OR
        EXISTS (
            SELECT 1 FROM admin_users
            WHERE admin_users.id = auth.uid()
        )
    );

-- Function to auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_return_requests_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update updated_at
DROP TRIGGER IF EXISTS trigger_return_requests_updated_at ON return_requests;
CREATE TRIGGER trigger_return_requests_updated_at
    BEFORE UPDATE ON return_requests
    FOR EACH ROW
    EXECUTE FUNCTION update_return_requests_updated_at();

-- Function to log status changes
CREATE OR REPLACE FUNCTION log_return_status_change()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.status IS DISTINCT FROM NEW.status THEN
        INSERT INTO return_request_history (
            return_request_id,
            previous_status,
            new_status,
            changed_by,
            notes,
            created_at
        ) VALUES (
            NEW.id,
            OLD.status,
            NEW.status,
            auth.uid(),
            COALESCE(NEW.admin_notes, 'Status changed'),
            now()
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to log status changes
DROP TRIGGER IF EXISTS trigger_return_status_change ON return_requests;
CREATE TRIGGER trigger_return_status_change
    AFTER UPDATE ON return_requests
    FOR EACH ROW
    EXECUTE FUNCTION log_return_status_change();

-- Comments for documentation
COMMENT ON TABLE return_requests IS 'Return and exchange requests - user initiated, admin managed';
COMMENT ON COLUMN return_requests.images IS 'Array of Supabase storage URLs for damage/product photos';
COMMENT ON COLUMN return_requests.refund_amount_paise IS 'Final refund amount after any restocking fees';
COMMENT ON COLUMN return_requests.received_condition IS 'Warehouse quality check result';
