CREATE TABLE "League" (
    "id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "country" TEXT,
    "logo" TEXT,
    "isSelected" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "League_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Team" (
    "id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "logo" TEXT,
    "isSelected" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Fixture" (
    "id" INTEGER NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "venue" TEXT,
    "leagueId" INTEGER NOT NULL,
    "homeTeamId" INTEGER NOT NULL,
    "awayTeamId" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Fixture_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SyncRun" (
    "id" SERIAL NOT NULL,
    "source" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL,
    "fixtureCount" INTEGER NOT NULL,
    CONSTRAINT "SyncRun_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SyncRun_source_key" ON "SyncRun"("source");
CREATE INDEX "Fixture_startsAt_idx" ON "Fixture"("startsAt");
CREATE INDEX "Fixture_leagueId_startsAt_idx" ON "Fixture"("leagueId", "startsAt");
CREATE INDEX "Fixture_homeTeamId_startsAt_idx" ON "Fixture"("homeTeamId", "startsAt");
CREATE INDEX "Fixture_awayTeamId_startsAt_idx" ON "Fixture"("awayTeamId", "startsAt");

ALTER TABLE "Fixture" ADD CONSTRAINT "Fixture_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Fixture" ADD CONSTRAINT "Fixture_homeTeamId_fkey" FOREIGN KEY ("homeTeamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Fixture" ADD CONSTRAINT "Fixture_awayTeamId_fkey" FOREIGN KEY ("awayTeamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;