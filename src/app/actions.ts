"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";

export async function toggleLeagueSelection(formData: FormData) {
  const leagueId = Number(formData.get("leagueId"));
  const isSelected = formData.get("isSelected") === "true";

  await prisma.league.update({ where: { id: leagueId }, data: { isSelected } });
  revalidatePath("/");
}

export async function toggleTeamSelection(formData: FormData) {
  const teamId = Number(formData.get("teamId"));
  const isSelected = formData.get("isSelected") === "true";

  await prisma.team.update({ where: { id: teamId }, data: { isSelected } });
  revalidatePath("/");
}