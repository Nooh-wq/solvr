-- QA Phase 2 fix — drop `super_admin_read` RLS policy from every table
-- that carries it. The policy grants unbounded cross-tenant SELECT for
-- any session with app.role='SUPER_ADMIN', overriding tenant_isolation
-- because Postgres RLS policies of the same command type OR-combine
-- permissively.
--
-- Every tenant provisions its own "Super Admin" role, so every tenant's
-- own Super Admin gets a session with app.role='SUPER_ADMIN' — the
-- policy leaks tenant data across the boundary for them, not just for
-- host-tenant super admins as originally intended.
--
-- Host-tenant Super Admin cross-tenant paths (superAnalytics.ts, the
-- Inngest crons) already use the bare `prisma` root client, which
-- bypasses RLS entirely and does not depend on this policy. Dropping
-- it therefore closes the leak with no legitimate consumer regression.
--
-- Idempotent: `DROP POLICY IF EXISTS` swallows a missing policy.

DROP POLICY IF EXISTS super_admin_read ON tickets;
DROP POLICY IF EXISTS super_admin_read ON custom_field_definitions;
DROP POLICY IF EXISTS super_admin_read ON custom_field_options;
DROP POLICY IF EXISTS super_admin_read ON custom_field_values;
DROP POLICY IF EXISTS super_admin_read ON organization_settings;
DROP POLICY IF EXISTS super_admin_read ON subject_avatars;
DROP POLICY IF EXISTS super_admin_read ON subject_preferences;
DROP POLICY IF EXISTS super_admin_read ON ticket_forms;
DROP POLICY IF EXISTS super_admin_read ON ticket_form_fields;
DROP POLICY IF EXISTS super_admin_read ON ticket_form_categories;
