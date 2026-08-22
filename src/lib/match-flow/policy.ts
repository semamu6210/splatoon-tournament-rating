import type { MatchPlayer, MatchResultReport, Team } from "@prisma/client";

export const RESULT_CONFIRMATION_POLICY = {
  mode: "SIX_REPORTS_WITH_BOTH_TEAMS",
  requiredReports: 6,
  minimumReportsPerTeam: 2,
} as const;

export function summarizeResultReports(reports: MatchResultReport[]) {
  return {
    A: reports.filter((report) => report.reportedWinnerTeam === "A").length,
    B: reports.filter((report) => report.reportedWinnerTeam === "B").length,
  } satisfies Record<Team, number>;
}

export function autoConfirmWinner(
  reports: MatchResultReport[],
  players: Array<Pick<MatchPlayer, "userId" | "team">>,
) {
  for (const winnerTeam of ["A", "B"] as const satisfies Team[]) {
    const matchingReports = reports.filter((report) => report.reportedWinnerTeam === winnerTeam);
    const reporterTeams = matchingReports.map((report) => {
      return players.find((player) => player.userId === report.userId)?.team;
    });
    const teamAReports = reporterTeams.filter((team) => team === "A").length;
    const teamBReports = reporterTeams.filter((team) => team === "B").length;

    if (
      matchingReports.length >= RESULT_CONFIRMATION_POLICY.requiredReports &&
      teamAReports >= RESULT_CONFIRMATION_POLICY.minimumReportsPerTeam &&
      teamBReports >= RESULT_CONFIRMATION_POLICY.minimumReportsPerTeam
    ) {
      return winnerTeam;
    }
  }

  return null;
}
