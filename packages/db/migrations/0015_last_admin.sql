-- Every firm keeps an administrator.
--
-- docs/decisions/0004-permissions.md promised this and 0008 pointed at it; it
-- was deferred until roles existed to be protected. They do now.
--
-- ── The invariant ────────────────────────────────────────────────────────────
--
-- At the end of any transaction, every firm has at least one user who is not
-- disabled, holds a role that is not archived, and that role carries
-- `roles.manage`. A firm that loses its last such person can no longer change
-- who administers it — not through the interface, and not through a script,
-- because the application's role holds no privilege that bypasses this.
--
-- Four ways to lose the last administrator, and a trigger on each:
--
--   * user_roles        DELETE — the role is taken away from them
--   * role_permissions  DELETE — `roles.manage` is taken out of the role
--   * roles             UPDATE — the role is archived
--   * users             UPDATE — the person is disabled
--
-- ── Why it is deferred to commit ─────────────────────────────────────────────
--
-- CONSTRAINT TRIGGER ... DEFERRABLE INITIALLY DEFERRED. The check runs when the
-- transaction commits, not on each statement, and that is what makes ordinary
-- edits possible. Setting a role's permission set is "delete them all, insert
-- the new set"; moving the only administrator from one role to another is a
-- delete and an insert. Checked per statement, both would fail half way through
-- despite ending in a valid state. Checked at commit, only a transaction that
-- actually ends with no administrator is refused.
--
-- ── Why it does not fire on every deletion ───────────────────────────────────
--
-- Each trigger fires only for a change that could have removed an administrator
-- — the WHEN clauses and the checks inside the function. Without that, a firm
-- that has no administrator yet (one being set up, or one this migration finds
-- already in that state) could not remove any role from anyone, since the count
-- would be zero whatever was deleted. The trigger protects an invariant; it
-- does not establish one. Onboarding has to create the first administrator.
--
-- ── Error code ───────────────────────────────────────────────────────────────
--
-- Raised with SQLSTATE 'LA001', a code of our own rather than a generic
-- check_violation, so the API can recognise it without parsing the message and
-- turn it into a specific answer. The message is English and for logs; the
-- interface says it in Arabic.

CREATE OR REPLACE FUNCTION firm_has_administrator(firm uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM users u
    JOIN user_roles ur
      ON ur.firm_id = u.firm_id AND ur.user_id = u.id
    JOIN roles r
      ON r.firm_id = ur.firm_id AND r.id = ur.role_id AND r.archived_at IS NULL
    JOIN role_permissions rp
      ON rp.firm_id = r.firm_id AND rp.role_id = r.id AND rp.permission_key = 'roles.manage'
    WHERE u.firm_id = firm AND u.disabled_at IS NULL
  )
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION assert_firm_keeps_administrator()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  firm uuid := COALESCE(NEW.firm_id, OLD.firm_id);
  relevant boolean := true;
BEGIN
  -- Only a change that could have removed an administrator is worth checking.
  -- The state read here is the state at commit, since the trigger is deferred.
  IF TG_TABLE_NAME = 'user_roles' THEN
    relevant := EXISTS (
      SELECT 1 FROM role_permissions rp
      WHERE rp.firm_id = OLD.firm_id AND rp.role_id = OLD.role_id
        AND rp.permission_key = 'roles.manage'
    );
  ELSIF TG_TABLE_NAME = 'roles' THEN
    relevant := EXISTS (
      SELECT 1 FROM role_permissions rp
      WHERE rp.firm_id = NEW.firm_id AND rp.role_id = NEW.id
        AND rp.permission_key = 'roles.manage'
    );
  END IF;
  -- role_permissions: the WHEN clause already restricts to roles.manage.
  -- users: disabling anyone is worth the one indexed query.

  IF relevant AND NOT firm_has_administrator(firm) THEN
    RAISE EXCEPTION 'firm % would be left with no user holding roles.manage', firm
      USING ERRCODE = 'LA001',
            HINT = 'Grant roles.manage to another active user first.';
  END IF;

  RETURN NULL;
END
$$;--> statement-breakpoint

CREATE CONSTRAINT TRIGGER "user_roles_keep_administrator"
  AFTER DELETE ON "user_roles"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION assert_firm_keeps_administrator();--> statement-breakpoint

CREATE CONSTRAINT TRIGGER "role_permissions_keep_administrator"
  AFTER DELETE ON "role_permissions"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (OLD.permission_key = 'roles.manage')
  EXECUTE FUNCTION assert_firm_keeps_administrator();--> statement-breakpoint

CREATE CONSTRAINT TRIGGER "roles_keep_administrator"
  AFTER UPDATE OF "archived_at" ON "roles"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (OLD.archived_at IS NULL AND NEW.archived_at IS NOT NULL)
  EXECUTE FUNCTION assert_firm_keeps_administrator();--> statement-breakpoint

CREATE CONSTRAINT TRIGGER "users_keep_administrator"
  AFTER UPDATE OF "disabled_at" ON "users"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (OLD.disabled_at IS NULL AND NEW.disabled_at IS NOT NULL)
  EXECUTE FUNCTION assert_firm_keeps_administrator();
