"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";

function id(formData: FormData, field: string) {
  const value = Number(formData.get(field));
  return Number.isInteger(value) && value > 0 ? value : null;
}

function flag(formData: FormData) {
  return formData.get("isSelected") === "true";
}

export async function toggleTeam(formData: FormData) {
  const teamId = id(formData, "teamId");
  if (!teamId) return;

  await prisma.team.update({ where: { id: teamId }, data: { isSelected: flag(formData) } });
  revalidatePath("/");
}

export async function toggleCompetition(formData: FormData) {
  const competitionId = id(formData, "competitionId");
  if (!competitionId) return;

  await prisma.competition.update({
    where: { id: competitionId },
    data: { isSelected: flag(formData) },
  });
  revalidatePath("/");
}

export async function toggleLeagueTeams(formData: FormData) {
  const competitionId = id(formData, "competitionId");
  if (!competitionId) return;

  await prisma.team.updateMany({ where: { competitionId }, data: { isSelected: flag(formData) } });
  revalidatePath("/");
}

export async function clearSelections() {
  await prisma.team.updateMany({ where: { isSelected: true }, data: { isSelected: false } });
  await prisma.competition.updateMany({ where: { isSelected: true }, data: { isSelected: false } });
  revalidatePath("/");
}
