// PRD.md §6: generic eight, no Singapore-specific splits for v1.
export const CATEGORIES = [
  "Food & Dining",
  "Groceries",
  "Transport",
  "Household",
  "Utilities",
  "Healthcare",
  "Entertainment",
  "Shopping",
  "Other",
] as const;

export type Category = (typeof CATEGORIES)[number];
