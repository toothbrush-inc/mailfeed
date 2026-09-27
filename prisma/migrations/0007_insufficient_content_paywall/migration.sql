-- Links whose page loaded but had too little readable text are a kind of
-- paywall ("insufficient_content"), not a fetch failure. Move existing ones
-- over: FAILED links whose most recent fetch run hit the poor-content or
-- unparseable-article error, or whose stored error says so.
UPDATE "Link" l
SET "fetchStatus" = 'PAYWALL_DETECTED',
    "isPaywalled" = true,
    "paywallType" = 'insufficient_content'
WHERE l."fetchStatus" = 'FAILED'
  AND (
    l."fetchError" LIKE 'Poor content quality%'
    OR l."fetchError" = 'Could not parse article content'
    OR EXISTS (
      SELECT 1
      FROM "FetchAttempt" a
      WHERE a."linkId" = l."id"
        AND a."operationId" = (
          SELECT latest."operationId"
          FROM "FetchAttempt" latest
          WHERE latest."linkId" = l."id"
          ORDER BY latest."createdAt" DESC
          LIMIT 1
        )
        AND (a."error" LIKE 'Poor content quality%' OR a."error" = 'Could not parse article content')
    )
  );
