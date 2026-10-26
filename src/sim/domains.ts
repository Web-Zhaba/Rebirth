// Knowledge domains (PLAN-research.ru.md): every technology belongs to one, and a restored old building feeds the
// domain of its type. Shared by the tech tree and the heritage finds.
export type DomainId = "build" | "farm" | "craft" | "trade" | "learn" | "care";

export const DOMAINS: { id: DomainId; name: string }[] = [
  { id: "build", name: "Строительство" },
  { id: "farm", name: "Земледелие" },
  { id: "craft", name: "Ремесло" },
  { id: "trade", name: "Торговля" },
  { id: "learn", name: "Знание" },
  { id: "care", name: "Вера и здоровье" },
];

export const DOMAIN_IDS: DomainId[] = DOMAINS.map((d) => d.id);
export const isDomain = (v: unknown): v is DomainId => typeof v === "string" && (DOMAIN_IDS as string[]).includes(v);
export const domainName = (d: DomainId): string => DOMAINS.find((x) => x.id === d)!.name;
