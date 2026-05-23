export interface Border {
  id: string;
  name: string;
  nameEn: string;
  price: number; // EGP
  cardClass: string;  // Tailwind classes for the card border/shadow
  avatarClass: string; // Tailwind classes for avatar ring
  textClass: string;
}

export const BORDERS: Border[] = [
  {
    id: "default",
    name: "الافتراضي",
    nameEn: "Default",
    price: 0,
    cardClass: "border-border bg-card/40",
    avatarClass: "border-muted text-muted-foreground bg-background",
    textClass: "text-foreground",
  },
  {
    id: "crimson",
    name: "الأحمر المشتعل",
    nameEn: "Crimson Fire",
    price: 20,
    cardClass: "border-crimson-glow",
    avatarClass: "border-red-400 bg-red-950/60 text-red-300",
    textClass: "text-red-300",
  },
  {
    id: "sapphire",
    name: "الياقوت الأزرق",
    nameEn: "Sapphire",
    price: 20,
    cardClass: "border-sapphire-glow",
    avatarClass: "border-blue-400 bg-blue-950/60 text-blue-300",
    textClass: "text-blue-300",
  },
  {
    id: "emerald",
    name: "الزمرد الأخضر",
    nameEn: "Emerald",
    price: 20,
    cardClass: "border-emerald-glow",
    avatarClass: "border-emerald-400 bg-emerald-950/60 text-emerald-300",
    textClass: "text-emerald-300",
  },
  {
    id: "violet",
    name: "البنفسجي الغامض",
    nameEn: "Violet Mist",
    price: 20,
    cardClass: "border-violet-glow",
    avatarClass: "border-violet-400 bg-violet-950/60 text-violet-300",
    textClass: "text-violet-300",
  },
  {
    id: "orange",
    name: "البرتقالي الناري",
    nameEn: "Orange Flame",
    price: 20,
    cardClass: "border-orange-glow",
    avatarClass: "border-orange-400 bg-orange-950/60 text-orange-300",
    textClass: "text-orange-300",
  },
];

const STORAGE_KEY = "ghostroom_unlocked_borders";
const SELECTED_KEY = "ghostroom_selected_border";

export function getUnlockedBorders(): string[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    const parsed = saved ? JSON.parse(saved) : [];
    // 'default' is always unlocked
    if (!parsed.includes("default")) parsed.push("default");
    return parsed;
  } catch {
    return ["default"];
  }
}

export function unlockBorder(borderId: string): void {
  const current = getUnlockedBorders();
  if (!current.includes(borderId)) {
    current.push(borderId);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  }
}

export function getSelectedBorder(): string {
  return localStorage.getItem(SELECTED_KEY) || "default";
}

export function setSelectedBorder(borderId: string): void {
  localStorage.setItem(SELECTED_KEY, borderId);
}

export function getBorderById(id: string): Border {
  return BORDERS.find((b) => b.id === id) ?? BORDERS[0];
}
