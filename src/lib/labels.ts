import type {
  MatchStatus,
  QueueStatus,
  Team,
  TournamentPhaseStatus,
  TournamentPhaseType,
  TournamentStatus,
  UserRole,
  VoteType,
} from "@prisma/client";

export const tournamentStatusLabel: Record<TournamentStatus, string> = {
  DRAFT: "下書き",
  REGISTRATION: "参加受付中",
  ACTIVE: "開催中",
  FINISHED: "終了",
};

export const tournamentPhaseTypeLabel: Record<TournamentPhaseType, string> = {
  QUALIFIER: "予選",
  MAIN_EVENT: "本戦",
};

export const tournamentPhaseStatusLabel: Record<TournamentPhaseStatus, string> = {
  PENDING: "開始前",
  ACTIVE: "進行中",
  COMPLETED: "終了",
};

export const queueStatusLabel: Record<QueueStatus | "NOT_QUEUED", string> = {
  NOT_QUEUED: "未参加",
  WAITING: "マッチング待機中",
  MATCHED: "マッチング成立",
  CANCELLED: "キャンセル",
};

export const matchStatusLabel: Record<MatchStatus, string> = {
  CREATED: "試合作成済み",
  PLAYING: "試合中",
  RESULT_REPORTING: "勝敗報告中",
  VOTE_REPORTING: "投票受付中",
  CONFIRMED: "確定",
  CANCELLED: "キャンセル",
};

export const voteTypeLabel: Record<VoteType, string> = {
  STRONG: "1票目",
  WEAK: "2票目",
};

export const teamLabel: Record<Team, string> = {
  A: "チームA",
  B: "チームB",
};

export const userRoleLabel: Record<UserRole, string> = {
  PLAYER: "参加者",
  ADMIN: "管理者",
  OWNER: "オーナー",
};

export const rankingVisibilityLabel = {
  OWN_BLOCK_ONLY: "自分のブロックのみ",
  OWN_AND_OTHER_BLOCKS: "ブロック別のみ",
  OVERALL_ONLY: "全体のみ",
  ALL: "全体とブロック別",
} as const;

export const advancementModeLabel = {
  OVERALL: "全体順位",
  BLOCK: "ブロック別",
} as const;

export const stageSelectionModeLabel = {
  RANDOM: "使用ステージからランダム",
  ADMIN: "管理者が指定",
} as const;

export const matchRuleLabel = {
  AREA: "ガチエリア",
  YAGURA: "ガチヤグラ",
  HOKO: "ガチホコ",
  ASARI: "ガチアサリ",
} as const;
