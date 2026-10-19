const BACKGROUNDS = ["#dceeff", "#fce3d9", "#e6e2ff", "#d8f3e8", "#ffedca", "#d9f0f3", "#f5dfeb", "#e7edcf"];
const HAIR_COLORS = ["#382c35", "#594236", "#202b3b", "#704536", "#29252d", "#854d32", "#3c344f"];
const CLOTHING_COLORS = ["#267c8a", "#6553a4", "#d06a55", "#35745a", "#35598c", "#b14f72", "#c18a32"];

export interface ExpertAvatarAppearance {
  background: string;
  hair: string;
  clothing: string;
  skin: string;
  initial: string;
  hairStyle: number;
  glasses: boolean;
  accessory: boolean;
}

function hash(value: string): number {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

export function expertAvatarAppearance(expertId: string, name: string): ExpertAvatarAppearance {
  const seed = hash(expertId || name || "expert");
  const first = Array.from(name.trim())[0] || "专";
  return {
    background: BACKGROUNDS[seed % BACKGROUNDS.length]!,
    hair: HAIR_COLORS[(seed >>> 3) % HAIR_COLORS.length]!,
    clothing: CLOTHING_COLORS[(seed >>> 6) % CLOTHING_COLORS.length]!,
    skin: ["#f2c8a8", "#dca47f", "#f5d6bd", "#c88968"][(seed >>> 9) % 4]!,
    initial: first,
    hairStyle: (seed >>> 12) % 4,
    glasses: Boolean(seed & 0x10000),
    accessory: Boolean(seed & 0x20000),
  };
}
