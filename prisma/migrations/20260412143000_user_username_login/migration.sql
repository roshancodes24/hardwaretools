-- Login identifier: unique username (email remains optional contact field).

ALTER TABLE "User" ADD COLUMN "username" TEXT;

UPDATE "User" SET username = LOWER(SPLIT_PART(email, '@', 1))
WHERE "username" IS NULL AND email IS NOT NULL;

UPDATE "User" SET username = 'user_' || REPLACE(id, '-', '_')
WHERE "username" IS NULL;

ALTER TABLE "User" ALTER COLUMN "username" SET NOT NULL;

CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
