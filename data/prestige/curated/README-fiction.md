# Curadoria de prestígio: ficção (`fiction.json`)

Data: 2026-10-31. Cobre 292 das 344 cartas de `docs/catalog.json`; as outras 52 são pessoas reais (UFC/MMA, Futebol Mundial, NBA, Lendas da Música, BLACKPINK, BTS, aespa, Stray Kids, Ado, After Hours/Starboy) e ficam com o outro agente.

## Método
- Fonte: conhecimento público das obras. Nenhuma página web foi consultada nesta rodada; `sources` está vazio e `reviewed` é `false` em tudo.
- Notas brutas (`rawJudgement`) passam por uma curva para a escala do spec: `seriesImportance = clamp(2.2*bruta - 118)` e `iconicFactor = clamp(1.8*bruta - 80)`. Sem a curva, todo protagonista de série média virava LENDÁRIA. `roleInStory` não tem curva.
- `prestigeProposal = round(0.30*série + 0.35*papel + 0.35*icônico)`.
- Coerência na série: papel maior nunca fica abaixo de papel menor, e ninguém passa do protagonista. Quando a fórmula violava, o prestígio do papel menor foi reduzido (a rationale diz isso). Validado por script, 0 violações.
- Formas (`kind: form`): nunca acima do personagem-base (o teto permitido era base+5, não foi usado).
- Itens (`kind: item`): 60% do prestígio do dono + bônus de 0 a 15, escrito na rationale. Bônus alto só para itens icônicos por si só (Death Note, Dragon Slayer, Portal Gun, Manopla do Infinito, Master Sword, Excalibur...).
- Donos e bases que não estão no catálogo (Link, Cloud, Harry Potter, Inuyasha...) foram estimados só internamente para calcular forma, item e coerência; não aparecem no JSON.
- Mítica: no máximo ceil(1%) por nicho do catálogo (anime 3, game 1, cinema_tv 1, manhwa_vn 1). `tierSuggestion` já aplica o teto; `tierByThreshold` mostra o tier só pelo limiar. Duplicatas e formas de personagem que está no catálogo não ocupam vaga mítica. Resultado: anime 3 (Goku, Naruto, Luffy), cinema_tv 1 (Batman), game 0, manhwa_vn 0.
- Nichos: Solo Leveling vai para `manhwa_vn`; Fate, Ghibli e filmes de anime ficam em `anime`; doramas, séries e filmes em `cinema_tv`.

## O que o dono deve revisar
1. Confiança `low`/`medium`: dono de Rivers of Blood, Moonlight Greatsword e Lança de Longinus; origem de "Darth Vader (Lorde das Cinzas)"; Ashborn; Goku Black.
2. Os bônus de itens e a curva (fica fácil de ajustar em `rawJudgement`).
3. Duplicatas a decidir: Gojo (ids 19, 1), Luffy (12, 21), Zoro (11, 24), Sukuna (18, 105), Levi (10, 20), Power (16, 45), Sung Jin-Woo (4, 68). Duplicatas têm `duplicateOf` e o mesmo prestígio do canônico.
4. Lista completa de problemas do catálogo em `inconsistencies`.
5. Rationales de personagens são em parte padronizadas (papel + peso da obra); revisar as dos nomes de maior prestígio.
