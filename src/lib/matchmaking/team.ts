import { Prisma } from "@prisma/client";

import type { MatchmakingPlayer, TeamAssignment } from "@/lib/matchmaking/types";

function combinations<T>(items: T[], size: number) {
  const result: T[][] = [];

  function walk(start: number, current: T[]) {
    if (current.length === size) {
      result.push([...current]);
      return;
    }

    for (let index = start; index < items.length; index += 1) {
      current.push(items[index]);
      walk(index + 1, current);
      current.pop();
    }
  }

  walk(0, []);
  return result;
}

function sumMatchingPower(players: MatchmakingPlayer[]) {
  return players.reduce((sum, player) => sum.add(player.matchingPower), new Prisma.Decimal(0));
}

function averageXp(players: MatchmakingPlayer[]) {
  return players.reduce((sum, player) => sum + player.areaXp, 0) / players.length;
}

function teammateRepeatPenalty(team: MatchmakingPlayer[]) {
  let penalty = 0;

  for (let i = 0; i < team.length; i += 1) {
    for (let j = i + 1; j < team.length; j += 1) {
      if (team[i].recentTeammateIds.has(team[j].userId) || team[j].recentTeammateIds.has(team[i].userId)) {
        penalty += 1;
      }
    }
  }

  return penalty;
}

export function splitIntoBalancedTeams(players: MatchmakingPlayer[]): TeamAssignment {
  if (players.length !== 8) {
    throw new Error("Exactly 8 players are required.");
  }

  const seen = new Set(players.map((player) => player.userId));
  if (seen.size !== 8) {
    throw new Error("Duplicate users are not allowed.");
  }

  const [first, ...rest] = players;
  let best: TeamAssignment | null = null;

  for (const combination of combinations(rest, 3)) {
    const teamA = [first, ...combination];
    const teamAIds = new Set(teamA.map((player) => player.userId));
    const teamB = players.filter((player) => !teamAIds.has(player.userId));
    const matchingPowerDifference = sumMatchingPower(teamA).sub(sumMatchingPower(teamB)).abs();
    const averageXpDifference = Math.abs(averageXp(teamA) - averageXp(teamB));
    const repeatPenalty = teammateRepeatPenalty(teamA) + teammateRepeatPenalty(teamB);

    if (
      !best ||
      matchingPowerDifference.lt(best.matchingPowerDifference) ||
      (matchingPowerDifference.equals(best.matchingPowerDifference) &&
        (averageXpDifference < best.averageXpDifference ||
          (averageXpDifference === best.averageXpDifference && repeatPenalty < best.teammateRepeatPenalty)))
    ) {
      best = {
        teamA,
        teamB,
        matchingPowerDifference,
        averageXpDifference,
        teammateRepeatPenalty: repeatPenalty,
      };
    }
  }

  if (!best) {
    throw new Error("Could not build teams.");
  }

  return best;
}
