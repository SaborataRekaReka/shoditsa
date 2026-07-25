UPDATE "friends_room_members" AS member
SET "left_at" = COALESCE(room."closed_at", now()),
    "last_seen_at" = COALESCE(room."closed_at", now())
FROM "friends_rooms" AS room
WHERE member."room_id" = room."id"
  AND room."closed_at" IS NOT NULL
  AND member."left_at" IS NULL;
--> statement-breakpoint
WITH ranked_memberships AS (
  SELECT
    member."room_id",
    member."user_id",
    row_number() OVER (
      PARTITION BY member."user_id"
      ORDER BY room."updated_at" DESC, member."joined_at" DESC, member."room_id" DESC
    ) AS position
  FROM "friends_room_members" AS member
  INNER JOIN "friends_rooms" AS room ON room."id" = member."room_id"
  WHERE member."left_at" IS NULL
    AND room."closed_at" IS NULL
)
UPDATE "friends_room_members" AS member
SET "left_at" = now(),
    "last_seen_at" = now()
FROM ranked_memberships
WHERE ranked_memberships."position" > 1
  AND member."room_id" = ranked_memberships."room_id"
  AND member."user_id" = ranked_memberships."user_id";
--> statement-breakpoint
UPDATE "friends_rooms" AS room
SET "phase" = 'finished',
    "closed_at" = now(),
    "phase_ends_at" = NULL,
    "version" = room."version" + 1,
    "updated_at" = now()
WHERE room."closed_at" IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "friends_room_members" AS member
    WHERE member."room_id" = room."id"
      AND member."left_at" IS NULL
  );
--> statement-breakpoint
WITH replacements AS (
  SELECT DISTINCT ON (member."room_id")
    member."room_id",
    member."user_id"
  FROM "friends_room_members" AS member
  INNER JOIN "friends_rooms" AS room ON room."id" = member."room_id"
  WHERE room."closed_at" IS NULL
    AND member."left_at" IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM "friends_room_members" AS owner_member
      WHERE owner_member."room_id" = room."id"
        AND owner_member."user_id" = room."owner_user_id"
        AND owner_member."left_at" IS NULL
    )
  ORDER BY member."room_id", member."joined_at", member."user_id"
)
UPDATE "friends_room_members" AS member
SET "role" = CASE
  WHEN member."user_id" = replacements."user_id" THEN 'owner'::"friends_room_member_role"
  ELSE 'player'::"friends_room_member_role"
END
FROM replacements
WHERE member."room_id" = replacements."room_id"
  AND member."left_at" IS NULL;
--> statement-breakpoint
WITH replacements AS (
  SELECT DISTINCT ON (member."room_id")
    member."room_id",
    member."user_id"
  FROM "friends_room_members" AS member
  INNER JOIN "friends_rooms" AS room ON room."id" = member."room_id"
  WHERE room."closed_at" IS NULL
    AND member."left_at" IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM "friends_room_members" AS owner_member
      WHERE owner_member."room_id" = room."id"
        AND owner_member."user_id" = room."owner_user_id"
        AND owner_member."left_at" IS NULL
    )
  ORDER BY member."room_id", member."joined_at", member."user_id"
)
UPDATE "friends_rooms" AS room
SET "owner_user_id" = replacements."user_id",
    "version" = room."version" + 1,
    "updated_at" = now()
FROM replacements
WHERE room."id" = replacements."room_id";
--> statement-breakpoint
CREATE UNIQUE INDEX "friends_room_members_one_active_user_idx" ON "friends_room_members" USING btree ("user_id") WHERE "friends_room_members"."left_at" is null;
