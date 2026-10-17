-- Demo hotels already in a database keep their seeded text, so rename the
-- product in their public descriptions here (the seed only runs when asked).
UPDATE "properties"
SET "description" = replace("description", 'StayOS', 'HotelOne')
WHERE "isDemo" = true AND "description" LIKE '%StayOS%';
