-- StayOS is now HotelOne: move the shared public-demo logins to @hotelone.demo
-- (same people, same passwords and hotels).
--
-- Sign-up was open, so someone may already have registered one of the new
-- addresses. Move such an account aside first (only when the demo login it
-- would collide with exists), so the demo login can take its address and the
-- seed never mistakes a stranger's account for demo staff.
UPDATE "users" AS squat
SET "email" = squat."email" || '.taken-' || squat."id"
WHERE squat."email" LIKE '%@hotelone.demo'
  AND EXISTS (
    SELECT 1 FROM "users" AS demo WHERE demo."email" = replace(squat."email", '@hotelone.demo', '@stayos.demo')
  );

UPDATE "users" AS u
SET "email" = replace(u."email", '@stayos.demo', '@hotelone.demo')
WHERE u."email" LIKE '%@stayos.demo'
  AND NOT EXISTS (
    SELECT 1 FROM "users" AS v WHERE v."email" = replace(u."email", '@stayos.demo', '@hotelone.demo')
  );
