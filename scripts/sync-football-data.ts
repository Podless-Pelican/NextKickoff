import "dotenv/config";
import { syncFootballData } from "../src/lib/football-data";
import { prisma } from "../src/lib/prisma";

syncFootballData()
  .then((result) => {
    console.log(
      `Stored ${result.matchCount} fixtures and ${result.teamCount} clubs from ${result.competitions} competitions ` +
        `(${result.mode}, ${result.apiRequests} API request(s), ${result.daysAhead} days ahead).`,
    );
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
