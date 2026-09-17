-- Arabic labels for the permission catalogue.
--
-- 0008 seeded the catalogue with English descriptions and said plainly that the
-- Arabic a firm administrator reads while composing a role "is interface text
-- and is not designed yet". Now it is needed, and it goes where the catalogue
-- is: in the database, seeded by the same migration that adds a key.
--
-- Not a dictionary in the API or the interface. Adding a permission is already
-- a migration, so a label kept anywhere else is a second place that has to be
-- remembered — and forgotten labels do not fail, they render as a raw key on a
-- checkbox someone is deciding whether to tick. Here, a key without a label is
-- a NOT NULL violation and the migration does not apply.
--
-- Resources get their own table rather than a label repeated on every row of the
-- same resource. Six rows saying "القضايا" and one saying "قضايا" is the kind of
-- inconsistency nothing would ever flag; a foreign key to one row is not.

CREATE TABLE "permission_resources" (
	"resource" text PRIMARY KEY NOT NULL,
	"label_ar" text NOT NULL,
	-- Display order on the role editor. Cases and clients first, because they
	-- are what a firm administrator is usually deciding about.
	"sort_order" integer NOT NULL
);--> statement-breakpoint

INSERT INTO "permission_resources" ("resource", "label_ar", "sort_order") VALUES
	('cases',   'القضايا',        10),
	('clients', 'العملاء',        20),
	('tasks',   'المهام',         30),
	('users',   'المستخدمون',     40),
	('roles',   'الأدوار والصلاحيات', 50),
	('firms',   'المكتب',         60)
ON CONFLICT ("resource") DO UPDATE SET
	"label_ar" = EXCLUDED."label_ar",
	"sort_order" = EXCLUDED."sort_order";--> statement-breakpoint

-- Every existing resource must be in the table before the key is added.
ALTER TABLE "permissions" ADD CONSTRAINT "permissions_resource_permission_resources_resource_fk"
	FOREIGN KEY ("resource") REFERENCES "public"."permission_resources"("resource")
	ON DELETE no action ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "permissions" ADD COLUMN "label_ar" text;--> statement-breakpoint

-- Verb-noun phrasing, matching the audit feed: a label names the thing a role
-- lets someone do, not a sentence about who does it.
UPDATE "permissions" SET "label_ar" = labels.label_ar
FROM (VALUES
	('firms.view',     'عرض بيانات المكتب'),
	('firms.manage',   'تعديل بيانات المكتب'),
	('users.view',     'عرض المستخدمين'),
	('users.manage',   'إدارة المستخدمين'),
	('roles.view',     'عرض الأدوار والصلاحيات'),
	('roles.manage',   'إدارة الأدوار والصلاحيات'),
	('clients.view',   'عرض العملاء'),
	('clients.manage', 'إدارة العملاء'),
	('cases.view',     'عرض القضايا'),
	('cases.create',   'إنشاء القضايا'),
	('cases.edit',     'تعديل القضايا'),
	('cases.assign',   'إسناد القضايا'),
	('tasks.view',     'عرض المهام'),
	('tasks.create',   'إنشاء المهام'),
	('tasks.edit',     'تعديل المهام وإنجازها'),
	('tasks.assign',   'إسناد المهام')
) AS labels(key, label_ar)
WHERE "permissions"."key" = labels.key;--> statement-breakpoint

-- Fails if any key above was missed — which is the point. A catalogue row
-- without a label must not survive this migration.
ALTER TABLE "permissions" ALTER COLUMN "label_ar" SET NOT NULL;--> statement-breakpoint

GRANT SELECT ON TABLE "permission_resources" TO legal_app;
