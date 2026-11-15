-- The Deliobot account an installation was last confirmed for; connected apps need one when REQUIRE_DELIO is "1".
ALTER TABLE installations ADD COLUMN delio_workspace TEXT;
ALTER TABLE installations ADD COLUMN delio_verified_at INTEGER;
