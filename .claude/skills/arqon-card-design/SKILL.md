---
name: arqon-card-design
description: Criar ou editar skins de carta, efeitos (foil, holo, astral), tokens de tema e views de embed do Arqon (src/canvas e src/ui). Use ao adicionar uma skin, mudar o visual de uma carta, atualizar goldens, mexer em fontes/licencas OFL ou montar embeds que exibem cartas.
---

# Arqon: design de cartas e embeds

Modulo de arte em `src/canvas/`. Uma carta e um WebP 480x700 (qualidade 88), desenhado por camadas de uma `CardSkin`.
O contrato fica em `src/canvas/skins/types.ts` (nao alterar sem combinar: `CardSkin`, `CardLayer`, `CardRenderContext`, `ThemeTokens`, `AssetBag`).

## Mapa

| Caminho | Papel |
| --- | --- |
| `src/canvas/skins/*.ts` | `classic`, `anime-neon`, `game-hud`, `cinema-noir`; `registry.ts` (`registerSkin`, `getSkin`, `selectSkin`) |
| `src/canvas/theme/tokens.ts` | `resolveTheme(tier, variant)`, `COLORS`, `SKIN_COLORS`, `rgba()`, `mix()`, `lighten()` |
| `src/canvas/theme/tiers.ts` | modulacao numerica por tier (borda, brilho, clareamento) |
| `src/canvas/effects/*.ts` | `foil`, `holo`, `astral`, `particles`, `noise` (PRNG `mulberry32`, `hashSeed`, granulado) |
| `src/canvas/engine/draw/*.ts` | helpers: formas, texto (`fitText`), retrato, camada mascarada (`drawMaskedLayer`), rotulos, `scoreMatch` |
| `src/canvas/engine/renderer.ts` | `renderCard(input)` -> Buffer WebP; `planCard` (skin + chave de cache) |
| `src/canvas/engine/pool.ts`, `worker.ts` | `renderCardInPool`, compat `renderCharacterCard`, piscina + fallback in-process |
| `src/canvas/engine/imageLoader.ts` | baixa retratos ANTES do desenho (LRU 100 MB + disco `.cache/img/<sha1(url)>` via `safeFetchImage`) |
| `src/canvas/engine/cache.ts` | cache de carta pronta (LRU 150 MB), texturas procedurais (`grain`, `scanlines`, `halftone`) |
| `src/canvas/engine/fonts.ts` | `registerFonts()` idempotente (Inter, Cinzel, Noto Sans JP) |
| `assets/fonts/` | fontes + licencas OFL |
| `src/scripts/testCanvas.ts` | gera 4 skins x 4 variantes com retrato sintetico, sem rede |
| `tests/unit/canvas/`, `tests/__golden__/` | testes e goldens (aHash 16x16) |

## Criar uma skin (passo a passo)

1. Crie `src/canvas/skins/<id>.ts` exportando um `CardSkin`:
   - `id` em kebab-case, `version: 1`, `label`, `size: { w: 480, h: 700 }`.
   - `layers` com TODOS os ids: `background`, `portrait`, `effects`, `nameplate`, `stats`, `badges`, `frame` (ordem de desenho: efeitos ficam sobre a arte e sob o texto; `frame` por ultimo). Um teste valida isso.
   - `match: (ctx) => scoreMatch("<id>", ctx, { universes: ["ANIME"] })`. Prioridade: skin preferida do dono (100) > evento em `SKIN_EVENTS` (50) > universo (10) > `classic` fallback (1).
2. Cores: SO de `theme/tokens.ts`. Use `c.theme` (por tier x variante) para borda/brilho/rotulo e `COLORS` para neutros/semanticas (`atk`, `def`, `spd`, `aether`, `gold`...). Precisa de uma paleta propria? Adicione em `SKIN_COLORS` no `tokens.ts`, nunca um literal `"#abc"` ou `"rgba(...)"` na skin. Transparencia: `rgba(COLORS.white, 0.1)`.
3. Texto: `fitText(g, texto, larguraMax, { size, minSize, weight, stack, tracking })` reduz a fonte e trunca com reticencias (CJK/emoji seguros). Pilhas: `FONT_SANS` (Inter + Noto Sans JP) e `FONT_SERIF` (Cinzel + Noto Sans JP). Rotulos fixos vem de `labelsFor(c.locale)` (pt-BR/en-US); nao hardcode idioma.
4. Retrato: `drawPortrait(g, c, rect, opts)` (cover + fallback com iniciais quando `c.portrait` e null). Efeito de raridade: `drawVariantEffects(g, c, rect)` dentro de um `clip` da arte (o rosto e protegido por um buraco radial; ajuste com o 4o/5o argumento).
5. Texturas: `a.get("halftone" | "scanlines" | "grain")` (podem faltar: sempre `if (tex)`).
6. Registre: adicione a skin na lista do final de `skins/registry.ts` (ou chame `registerSkin()` no boot para skins cosmeticas externas). Ordem de registro desempata pontuacoes iguais.
7. Se a skin vai a loja/cosmetico, `preferredSkinId` do dono ja a seleciona (score 100); evento sazonal: entrada em `SKIN_EVENTS` (`config/gacha.ts`).
8. Rode `npx tsx src/scripts/testCanvas.ts --all`, abra os PNG de `.cache/test-cards/png/` e passe pelo checklist abaixo.
9. Gere os goldens: `npx tsx src/scripts/testCanvas.ts --all --golden` (grava `tests/__golden__/<skin>__<variante>.png`, 240x350). Revise as imagens antes de commitar. Mudou o visual de proposito? Incremente `version` da skin (invalida o cache de carta pronta) e regenere os goldens.

## Efeitos

Funcoes puras `(g, rect, { seed, ... })`, deterministicas: mesmo seed => mesmos pixels. Aleatoriedade so via `mulberry32(seed)`. `drawMaskedLayer` pinta numa camada transparente, apaga o buraco do rosto e compoe com o modo pedido (`screen`, `color-dodge`...): modos de mistura so interagem com o fundo na composicao final. A semente da carta e `hashSeed(entityId|variante)` (`c.seed`).

## Fontes e licenca (OFL)

- Inter (Regular/SemiBold/Bold, woff2, rsms/inter), Cinzel (variavel TTF, google/fonts; negrito e sintetizado), Noto Sans JP (Regular/Bold OTF, notofonts/noto-cjk SubsetOTF; ~4,5 MB cada).
- Todas sob SIL Open Font License 1.1. Os arquivos `Inter-OFL.txt`, `Cinzel-OFL.txt`, `NotoSansJP-OFL.txt` ficam ao lado das fontes em `assets/fonts/` e devem permanecer no repositorio e na imagem Docker (`COPY assets ./assets`).
- Fonte nova: baixe so de repositorio oficial, copie a licenca junto, registre em `engine/fonts.ts` (`FONT_FILES`) e confira que `registerFonts().missing` e vazio. Fontes variaveis NAO aplicam eixos no `@napi-rs/canvas` (ficam no peso padrao): prefira instancias estaticas.
- Fonte ausente nao quebra: o texto cai para `sans-serif`/`serif` do sistema (o teste de renderer acusa `missing`).

## Orcamento

- Render < 80 ms por carta (p95, apos warm-up, incluindo encode WebP). Teste em `tests/unit/canvas/renderer.test.ts`; em CI o limite e 200 ms (`CANVAS_P95_BUDGET_MS` ajusta).
- Saida < 400 KB (hoje ~20-40 KB).
- Event loop nao bloqueia: o bot usa `renderCardInPool` (piscina). `CANVAS_POOL=on|off|auto`: `auto` = pool em producao (`dist/*.js`), in-process sob `tsx`; `on` forca o pool tambem em dev.
- Evite `shadowBlur` em caminhos grandes, `ctx.filter` e blur de tela cheia; reuse camadas via `drawMaskedLayer`.

## Proibicoes

- Rede ou disco dentro de `draw()` (skins, efeitos e helpers de desenho nao importam `fetch`, `node:fs`, `imageLoader`; um teste vigia). Retrato e assets chegam prontos em `c.portrait` e `AssetBag`.
- `Math.random` (qualquer arquivo de `src/canvas`; um teste vigia). Use `mulberry32(c.seed ^ constante)`.
- Cores fora dos tokens (literais `"#hex"`/`"rgba()"` em skins; um teste vigia).
- Estado global mutavel nas skins; relogio (`Date.now`) no desenho (eventos entram via `match`).
- Emojis no canvas (quebram): use formas vetoriais (`drawAetherCrystal`, `drawStar`).

## Regras de embed (views com cartas)

- Monte embeds com `src/ui/*` (`baseEmbed`, `successEmbed`, `colorForVariant`, `colorForTier`, `formatAether`, `truncate`...), nunca `new EmbedBuilder()` solto. Cores de embed de `src/ui/tokens.ts` (as paletas de variante sao as mesmas do canvas; um teste compara).
- Texto visivel por chave i18n (`t(chave, locale, replacements)` de `src/i18n`), nunca string fixa. A carta tem rotulos proprios em `engine/draw/labels.ts`; ao adicionar locale, adicione la tambem.
- Anexe a carta como `card.webp` (`AttachmentBuilder(buf, { name: "card.webp" })`) e referencie `attachment://card.webp`. `renderCharacterCard` agora devolve WebP, nao PNG.
- Interacao: use os componentes de `src/ui/components` (`createPaginator`, `createPanel`, `confirm`); eles ja trazem customId com namespace (`newComponentId`), checagem de dono (`assertOwner`), TTL (`DEFAULT_COMPONENT_TTL_MS`) e `disableComponents` ao expirar. Faca `deferReply` antes de renderizar a carta.
- Se o render falhar, responda com `errorEmbed` + errorId; nunca deixe a interacao sem resposta.

## Checklist de revisao visual

Abra os PNG em `.cache/test-cards/png/` (16 cartas) e confira:

- [ ] Nenhum texto cortado nas bordas; nome longo truncado com reticencias (caso "Maximilian...").
- [ ] Nome CJK ("五条悟") legivel no nome e na franquia.
- [ ] Contraste dos stats e do Eter sobre o fundo (texto claro sobre painel escuro).
- [ ] Foil/holo/astral visiveis, mas o rosto continua limpo e reconhecivel.
- [ ] Sem retrato: fallback com iniciais, sem vazamento de cor.
- [ ] Tiers mudam borda/brilho (COMMON mais discreto, MYTHIC mais forte).
- [ ] Locale `en-US` ("FREE TO PACT", "Aether") e `pt-BR` sem sobreposicao.
- [ ] Awakening >6 mostra "+N" sem sobrepor outros elementos.
- [ ] Arquivo < 400 KB e tempo < 80 ms na tabela do script.
- [ ] Goldens regenerados e revisados; `npx vitest run --project unit` verde.

## Comandos

```bash
npx tsx src/scripts/testCanvas.ts --all                      # 16 cartas + p50/p95
npx tsx src/scripts/testCanvas.ts --skin game-hud --variant HOLO --tier MYTHIC
npx tsx src/scripts/testCanvas.ts --all --pool --rounds 3    # via pool de workers
npx tsx src/scripts/testCanvas.ts --all --golden             # atualiza tests/__golden__
npx vitest run --project unit tests/unit/canvas
```
