import type { ItemEmblemKey } from "./pick.js";

/**
 * Simbolos vetoriais ORIGINAIS (classes genericas de arma/item) numa caixa 200x200, centro em (100,100).
 * Papeis: body = metal/corpo, accent = detalhe de cor, dark = recorte escuro, light = brilho,
 * glow = nucleo luminoso (energia), line = so traco.
 */
export type PartRole = "body" | "accent" | "dark" | "light" | "glow" | "line";

export interface SymbolPart {
  d: string;
  role: PartRole;
  rule?: "nonzero" | "evenodd";
}

export interface SymbolDef {
  parts: SymbolPart[];
  /** Rotacao em graus aplicada ao conjunto (armas verticais ficam na diagonal). */
  rotate?: number;
  /** Escala relativa (1 = ocupa ~100% da caixa util). */
  scale?: number;
}

const circle = (cx: number, cy: number, r: number): string =>
  `M${cx - r} ${cy} a${r} ${r} 0 1 0 ${2 * r} 0 a${r} ${r} 0 1 0 ${-2 * r} 0 Z`;

export const SYMBOLS: Record<ItemEmblemKey, SymbolDef> = {
  sword: {
    rotate: 45,
    parts: [
      { d: "M100 6 L114 36 L114 126 L86 126 L86 36 Z", role: "body" },
      { d: "M97.5 34 L102.5 34 L102.5 118 L97.5 118 Z", role: "dark" },
      { d: "M58 126 L142 126 L142 140 L58 140 Z", role: "accent" },
      { d: "M93 140 L107 140 L107 168 L93 168 Z", role: "dark" },
      { d: circle(100, 178, 11), role: "accent" },
    ],
  },
  axe: {
    rotate: 30,
    parts: [
      { d: "M93 26 L107 26 L107 192 L93 192 Z", role: "dark" },
      { d: "M107 30 C166 22 186 66 176 112 C156 100 132 96 107 98 Z", role: "body" },
      { d: "M93 48 L66 38 L66 86 L93 80 Z", role: "body" },
      { d: "M93 150 L107 150 L107 160 L93 160 Z", role: "accent" },
      { d: "M120 48 C148 46 160 66 162 88", role: "line" },
    ],
  },
  hammer: {
    rotate: 35,
    parts: [
      { d: "M92 72 L108 72 L108 192 L92 192 Z", role: "dark" },
      { d: "M44 20 L156 20 L156 76 L44 76 Z", role: "body" },
      { d: "M66 20 L78 20 L78 76 L66 76 Z", role: "accent" },
      { d: "M122 20 L134 20 L134 76 L122 76 Z", role: "accent" },
      { d: "M92 150 L108 150 L108 162 L92 162 Z", role: "accent" },
    ],
  },
  staff: {
    rotate: 30,
    parts: [
      { d: "M95 70 L105 70 L105 196 L95 196 Z", role: "dark" },
      { d: "M68 14 C60 54 80 76 100 76 C120 76 140 54 132 14 C126 46 114 62 100 62 C86 62 74 46 68 14 Z", role: "body" },
      { d: circle(100, 38, 17), role: "glow" },
      { d: "M90 120 L110 120 L110 130 L90 130 Z", role: "accent" },
    ],
  },
  shield: {
    parts: [
      { d: "M100 10 L170 34 L170 100 C170 144 136 174 100 192 C64 174 30 144 30 100 L30 34 Z", role: "body" },
      { d: "M100 32 L151 50 L151 100 C151 132 127 154 100 168 C73 154 49 132 49 100 L49 50 Z", role: "accent" },
      { d: "M94 54 L106 54 L106 152 L94 152 Z", role: "dark" },
      { d: "M66 90 L134 90 L134 102 L66 102 Z", role: "dark" },
    ],
  },
  bow: {
    parts: [
      { d: "M138 10 C46 50 46 150 138 190 L138 174 C90 144 90 56 138 26 Z", role: "body" },
      { d: "M136 18 L140 18 L140 182 L136 182 Z", role: "line" },
      { d: "M44 98 L172 98 L172 102 L44 102 Z", role: "dark" },
      { d: "M172 90 L194 100 L172 110 Z", role: "accent" },
      { d: "M44 98 L30 88 L52 98 Z M44 102 L30 112 L52 102 Z", role: "accent" },
    ],
  },
  gun: {
    parts: [
      { d: "M24 58 L172 58 L172 98 L24 98 Z", role: "body" },
      { d: "M172 66 L194 66 L194 90 L172 90 Z", role: "dark" },
      { d: "M52 98 L104 98 L84 170 L32 170 Z", role: "dark" },
      { d: "M110 98 L110 118 C110 136 144 136 144 118 L144 98", role: "line" },
      { d: "M38 48 L58 48 L58 58 L38 58 Z", role: "accent" },
      { d: "M60 70 L150 70 L150 78 L60 78 Z", role: "dark" },
    ],
  },
  scythe: {
    rotate: 20,
    parts: [
      { d: "M94 18 L106 18 L106 194 L94 194 Z", role: "dark" },
      { d: "M100 20 C154 10 196 44 192 100 C176 66 142 52 100 58 Z", role: "body" },
      { d: "M88 118 L112 118 L112 130 L88 130 Z", role: "accent" },
      { d: "M104 28 C140 24 168 42 180 70", role: "line" },
    ],
  },
  spear: {
    rotate: 40,
    parts: [
      { d: "M95 68 L105 68 L105 198 L95 198 Z", role: "dark" },
      { d: "M100 4 C124 30 128 52 112 70 L88 70 C72 52 76 30 100 4 Z", role: "body" },
      { d: "M98 22 L102 22 L102 64 L98 64 Z", role: "dark" },
      { d: "M90 74 L110 74 L118 98 L82 98 Z", role: "accent" },
    ],
  },
  dagger: {
    rotate: 40,
    parts: [
      { d: "M100 14 C122 50 118 92 110 120 L90 120 C82 92 78 50 100 14 Z", role: "body" },
      { d: "M98 40 L102 40 L102 112 L98 112 Z", role: "dark" },
      { d: "M68 120 L132 120 L132 132 L68 132 Z", role: "accent" },
      { d: "M93 132 L107 132 L107 168 L93 168 Z", role: "dark" },
      { d: circle(100, 176, 9), role: "accent" },
    ],
  },
  energy_blade: {
    rotate: 40,
    parts: [
      { d: "M88 18 C88 -2 112 -2 112 18 L112 120 L88 120 Z", role: "glow" },
      { d: "M84 120 L116 120 L116 134 L84 134 Z", role: "body" },
      { d: "M90 134 L110 134 L110 194 L90 194 Z", role: "dark" },
      { d: "M90 148 L110 148 L110 156 L90 156 Z", role: "accent" },
      { d: "M90 172 L110 172 L110 180 L90 180 Z", role: "accent" },
    ],
  },
  armor: {
    parts: [
      { d: "M62 50 L138 50 L148 112 C148 152 124 176 100 188 C76 176 52 152 52 112 Z", role: "body" },
      { d: "M18 58 C18 36 44 26 64 36 L64 78 C44 82 24 76 18 58 Z", role: "accent" },
      { d: "M182 58 C182 36 156 26 136 36 L136 78 C156 82 176 76 182 58 Z", role: "accent" },
      { d: "M80 20 L120 20 L112 50 L88 50 Z", role: "body" },
      { d: "M97 58 L103 58 L103 166 L97 166 Z", role: "dark" },
      { d: "M70 96 L130 96 L130 104 L70 104 Z", role: "dark" },
    ],
  },
  ring: {
    parts: [
      { d: `${circle(100, 126, 60)} ${circle(100, 126, 42)}`, role: "body", rule: "evenodd" },
      { d: "M100 14 L126 42 L100 72 L74 42 Z", role: "glow" },
      { d: "M84 74 L116 74 L112 84 L88 84 Z", role: "accent" },
    ],
  },
  book: {
    parts: [
      { d: "M40 28 L160 28 L160 172 L40 172 Z", role: "body" },
      { d: "M40 28 L58 28 L58 172 L40 172 Z", role: "accent" },
      { d: "M70 44 L148 44 L148 156 L70 156 Z", role: "dark" },
      { d: "M109 74 L132 100 L109 126 L86 100 Z", role: "glow" },
      { d: "M118 172 L118 196 L128 188 L138 196 L138 172 Z", role: "accent" },
    ],
  },
  orb: {
    parts: [
      { d: "M58 150 C66 174 134 174 142 150 L152 180 L48 180 Z", role: "accent" },
      { d: circle(100, 92, 64), role: "body" },
      { d: circle(100, 92, 48), role: "dark" },
      { d: "M66 70 C72 52 92 42 108 44 C90 52 80 64 76 82 Z", role: "light" },
      { d: "M112 112 C124 108 134 100 138 88 C138 108 128 122 112 126 Z", role: "glow" },
    ],
  },
  potion: {
    parts: [
      { d: "M84 22 L116 22 L116 58 L84 58 Z", role: "body" },
      { d: "M86 6 L114 6 L114 24 L86 24 Z", role: "accent" },
      { d: "M84 58 L116 58 C116 74 162 92 162 132 C162 170 134 190 100 190 C66 190 38 170 38 132 C38 92 84 74 84 58 Z", role: "body" },
      { d: "M50 128 C70 120 86 138 100 130 C116 122 132 138 150 128 C152 168 130 180 100 180 C70 180 48 168 50 128 Z", role: "accent" },
      { d: circle(84, 152, 7), role: "light" },
      { d: circle(116, 160, 5), role: "light" },
    ],
  },
  crown: {
    parts: [
      { d: "M28 150 L28 66 L66 104 L100 46 L134 104 L172 66 L172 150 Z", role: "body" },
      { d: "M28 150 L172 150 L172 174 L28 174 Z", role: "accent" },
      { d: circle(100, 122, 11), role: "glow" },
      { d: circle(60, 130, 7), role: "light" },
      { d: circle(140, 130, 7), role: "light" },
      { d: circle(28, 62, 8), role: "accent" },
      { d: circle(100, 40, 8), role: "accent" },
      { d: circle(172, 62, 8), role: "accent" },
    ],
  },
  gem: {
    parts: [
      { d: "M62 30 L138 30 L176 76 L100 184 L24 76 Z", role: "body" },
      { d: "M24 76 L176 76 L100 184 Z", role: "accent" },
      { d: "M62 30 L78 76 L100 30 L122 76 L138 30", role: "line" },
      { d: "M78 76 L100 184 L122 76", role: "line" },
      { d: "M44 52 L58 44 L52 62 Z", role: "light" },
    ],
  },
};
