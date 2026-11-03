import { L } from "../i18n";
// Knowledge domains (PLAN-research.ru.md): every technology belongs to one, and a restored old building feeds the
// domain of its type. Shared by the tech tree and the heritage finds.
export type DomainId = "build" | "farm" | "craft" | "trade" | "learn" | "care";

export const DOMAINS: { id: DomainId; name: string }[] = [
  { id: "build", name: L("Строительство", "Building") },
  { id: "farm", name: L("Земледелие", "Farming") },
  { id: "craft", name: L("Ремесло", "Crafts") },
  { id: "trade", name: L("Торговля", "Trade") },
  { id: "learn", name: L("Знание", "Knowledge") },
  { id: "care", name: L("Вера и здоровье", "Faith and health") },
];

export const DOMAIN_IDS: DomainId[] = DOMAINS.map((d) => d.id);
export const isDomain = (v: unknown): v is DomainId => typeof v === "string" && (DOMAIN_IDS as string[]).includes(v);
export const domainName = (d: DomainId): string => DOMAINS.find((x) => x.id === d)!.name;
