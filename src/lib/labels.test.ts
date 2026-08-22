import { describe, expect, it } from "vitest";

import {
  teamLabel,
  tournamentPhaseStatusLabel,
  tournamentPhaseTypeLabel,
  tournamentStatusLabel,
  userRoleLabel,
  voteTypeLabel,
} from "@/lib/labels";

describe("Japanese labels", () => {
  it("maps tournament statuses to Japanese labels", () => {
    expect(tournamentStatusLabel.DRAFT).toBe("下書き");
    expect(tournamentStatusLabel.REGISTRATION).toBe("参加受付中");
    expect(tournamentStatusLabel.ACTIVE).toBe("開催中");
    expect(tournamentStatusLabel.FINISHED).toBe("終了");
  });

  it("maps phase statuses and types to Japanese labels", () => {
    expect(tournamentPhaseTypeLabel.QUALIFIER).toBe("予選");
    expect(tournamentPhaseTypeLabel.MAIN_EVENT).toBe("本戦");
    expect(tournamentPhaseStatusLabel.PENDING).toBe("開始前");
    expect(tournamentPhaseStatusLabel.ACTIVE).toBe("進行中");
    expect(tournamentPhaseStatusLabel.COMPLETED).toBe("終了");
  });

  it("maps votes, teams, and roles to Japanese labels", () => {
    expect(voteTypeLabel.STRONG).toBe("1票目");
    expect(voteTypeLabel.WEAK).toBe("2票目");
    expect(teamLabel.A).toBe("チームA");
    expect(teamLabel.B).toBe("チームB");
    expect(userRoleLabel.PLAYER).toBe("参加者");
    expect(userRoleLabel.ADMIN).toBe("管理者");
    expect(userRoleLabel.OWNER).toBe("オーナー");
  });
});
