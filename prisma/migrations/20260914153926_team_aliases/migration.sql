-- AlterTable
ALTER TABLE "Team" ADD COLUMN     "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[];
