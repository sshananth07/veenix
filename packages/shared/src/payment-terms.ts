// Client payment terms: what triggers each payment and its share of the
// contract sum. Shared by the quotation (terms) and the project schedule
// (milestones) so both are built and validated the same way.

export type TermRow = { name: string; trigger: string; pct: number };

export const TERM_TEMPLATES: { key: string; label: string; hint: string; rows: TermRow[] }[] = [
  {
    key: "simple",
    label: "Deposit + completion",
    hint: "Small jobs",
    rows: [
      { name: "Deposit", trigger: "On acceptance of quotation", pct: 30 },
      { name: "Completion", trigger: "On completion and handover", pct: 70 },
    ],
  },
  {
    key: "three",
    label: "3 stages",
    hint: "Most residential jobs",
    rows: [
      { name: "Deposit", trigger: "On acceptance of quotation", pct: 30 },
      { name: "Progress payment", trigger: "On completion of major works", pct: 50 },
      { name: "Completion", trigger: "On completion and handover", pct: 20 },
    ],
  },
  {
    key: "five",
    label: "5 stages with retention",
    hint: "Full fit-out",
    rows: [
      { name: "Deposit", trigger: "On acceptance of quotation", pct: 30 },
      { name: "M&E complete", trigger: "M&E works done", pct: 30 },
      { name: "Ceiling & tiling done", trigger: "Ceiling and tiling complete", pct: 25 },
      { name: "Handover & keys", trigger: "Handover", pct: 10 },
      { name: "Retention release", trigger: "6 months after handover (DLP)", pct: 5 },
    ],
  },
];