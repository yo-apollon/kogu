# Raridade e preço por nicho (sistema de prestígio)

Especificação do sistema que decide a raridade (tier), o preço em Éter e a chance de sorteio de cada carta. Objetivo: a raridade tem que fazer sentido dentro do nicho da carta. Um personagem menos importante na história de um anime não pode ficar à frente do protagonista da mesma obra, e um jogador mediano não pode ficar à frente de uma lenda do esporte.

## 1. Problema atual
1. O `catalog.rerank` calcula o tier pela posição em um ranking único de popularidade, misturando anime, jogos, esportes e música. Os tiers escritos à mão nos seeds (`seedPopCultureAndSports.ts`) são sobrescritos.
2. Popularidade bruta (favoritos) mede fama de internet, não importância na história. Um coadjuvante de uma obra muito famosa pode superar o protagonista de uma obra menor, e o tier acompanha esse ranking.
3. O corte por percentil (1% mítica, 5% lendária, 15% épica, 40% rara) força sempre uma mítica por catálogo, mesmo em nichos pequenos onde ninguém merece o topo, e rebaixa lendas reais quando o catálogo cresce.
4. O jitter (±4%) do preço pode inverter a ordem de duas cartas de prestígio muito próximo.

## 2. Princípios
- **Raridade por mérito no nicho, preço pelo mérito.** Cada carta tem um prestígio de 0 a 100 dentro do próprio nicho. O tier sai de limiares absolutos de prestígio, não de percentis do catálogo inteiro.
- **Monotonia.** Dentro de um nicho, prestígio maior nunca resulta em tier menor nem preço menor.
- **Coerência dentro da obra.** Em uma mesma série, a ordem de prestígio respeita a importância na história (protagonista, elenco principal, secundários).
- **Comparabilidade entre nichos.** Uma mítica de futebol e uma mítica de anime têm a mesma raridade e a mesma ordem de preço, porque ambas são "o topo absoluto do nicho".
- **Auditável.** Toda nota de prestígio tem origem registrada (fórmula, dados curados ou ajuste manual com motivo) e há um relatório que mostra inversões.

## 3. Nichos
Cada carta pertence a exatamente um nicho (`niches.key`). Lista inicial:

| Chave | Família | Exemplos |
|---|---|---|
| `anime` | ficção | anime e mangá |
| `manhwa_vn` | ficção | manhwa e visual novels |
| `game` | ficção | personagens de jogos |
| `cinema_tv` | ficção | filmes, séries, animação ocidental, doramas |
| `idol` | pessoas (cultura pop) | idols e artistas de K-pop e J-pop |
| `music_pop`, `music_rock`, `music_hiphop` | pessoas | cantores e bandas |
| `sport_football`, `sport_basketball`, `sport_mma` | pessoas (esporte) | atletas; novos esportes entram como `sport_<nome>` |

A tabela `niches` guarda: `key`, rótulo pt-BR e en-US, `family` (`fiction`, `people_sport`, `people_music`), perfil de limiares e pesos. Nichos novos entram só com um registro nessa tabela e dados curados, sem mudar código.

## 4. Prestígio (0 a 100)

### 4.1 Ficção (`anime`, `manhwa_vn`, `game`, `cinema_tv`)
Prestígio calculado a partir de sinais que já temos (favoritos por fonte, popularidade da série, papel na série):

```
serie_score    = percentil da popularidade da série dentro do nicho (0..1)
fama_score     = percentil dos favoritos do personagem dentro do nicho (0..1), por fonte, com bônus por fonte extra
historia_score = importância na história (0..1) = f(papel, posição por favoritos dentro da série)
                 papel MAIN = 1.0, SUPPORTING = 0.55, sem papel = 0.4
                 posição na série: o 1º por favoritos = 1.0, decai com a posição (1 / (1 + 0.35 * (pos - 1)))
prestigio      = 100 * (0.40 * fama_score + 0.30 * serie_score + 0.30 * historia_score)
```
Regras de coerência dentro da série (aplicadas depois da fórmula, em ordem):
1. Teto: nenhum personagem passa do prestígio do protagonista da série (o de maior `historia_score`, desempate por favoritos).
2. Ordem: entre dois personagens da mesma série, o de papel maior não pode ter prestígio menor que o de papel menor; se ocorrer, sobe o de papel maior até igualar com um empate desfeito por favoritos.
3. Obras sem sinal confiável (série nova sem favoritos) ficam com `historia_score` apenas e prestígio limitado a 40 até haver dados.

### 4.2 Pessoas, esporte e música (`sport_*`, `music_*`, `idol`)
Fama de internet não serve (um atleta atual com muitos seguidores pode superar uma lenda). O prestígio vem de **dados curados e auditáveis** em `data/prestige/<nicho>.json`, calculados por uma régua por nicho, com os números de conquistas guardados (para revisão):

- `sport_football`: Copas do Mundo vencidas, Bolas de Ouro, títulos de Champions, recordes de gols, anos de elite. Exemplo de peso: Copa do Mundo (como titular) 18, Bola de Ouro 6 cada (teto 36), Champions 4 cada (teto 16), recorde histórico 10, longevidade no topo (anos) 1,5 cada (teto 15), dominância (melhor do mundo em n temporadas) 5 cada (teto 20). Normaliza para 0 a 100 pelo máximo teórico do nicho.
- `sport_basketball`: títulos da NBA, MVPs, MVPs de Finais, seleções All-NBA, recordes, longevidade.
- `sport_mma`: cinturões, defesas de título, vitórias consecutivas, finalizações e nocautes de elite, divisões, legado.
- `music_*`: vendas certificadas, prêmios (Grammy e equivalentes), recordes de público e de paradas, influência histórica (peso curado com justificativa), longevidade.
- `idol`: prêmios, vendas, alcance internacional, tempo de carreira.

Cada registro: `slug`, `niche`, `inputs` (os números), `prestige` calculado, `override` opcional (valor manual) com `override_reason` obrigatório, `reviewed_by`, `reviewed_at`, `sources` (links). Mudar uma nota é um commit em um arquivo de dados, revisável.

## 5. Tier (raridade)
Limiares absolutos de prestígio por perfil (ajustáveis em `src/config/gacha.ts`):

| Tier | Prestígio mínimo (ficção) | Prestígio mínimo (pessoas) |
|---|---|---|
| MYTHIC | 94 | 95 |
| LEGENDARY | 82 | 85 |
| EPIC | 66 | 70 |
| RARE | 45 | 50 |
| COMMON | abaixo | abaixo |

- **Piso de quantidade.** Um nicho nunca fica sem topo: se nenhuma carta alcança o limiar mítico, a de maior prestígio do nicho é promovida até LEGENDARY (nunca MYTHIC por si só).
- **Teto de quantidade.** Mítica por nicho é limitada a no máximo 1% das cartas do nicho, arredondado para cima, com mínimo 1 apenas se alguém alcançou o limiar. Excedentes descem para LEGENDARY pela ordem de prestígio.
- **Estoque global** por tier continua valendo (`TIER_MAX_SUPPLY`).
- **Edições** (Básica, Épica, Mítica) continuam com tier fixo por edição; o prestígio da carta âncora define só a posição do preço dentro da faixa.

## 6. Preço (Éter) e sorteio
- A faixa de cada tier fica como já definida (`TIER_AETHER_BAND`). A posição dentro da faixa vem do prestígio: `t = (prestigio - min_do_tier) / (max_do_tier - min_do_tier)` e `aether = min + (max - min) * t^curva`.
- Sem jitter aleatório que reordene cartas do mesmo nicho. Desempate só entre prestígios idênticos, por semente fixa da carta.
- O peso de sorteio continua `TIER_WEIGHT[tier] * (1 + POPULARITY_WEIGHT * score)` com `score = prestigio / 100`.

## 7. Invariantes (viram testes)
1. Monotonia no nicho: para duas cartas A e B do mesmo nicho, `prestigio(A) > prestigio(B)` implica `rank_tier(A) >= rank_tier(B)` e `aether_base(A) >= aether_base(B)`.
2. Coerência na série: personagem de papel maior da mesma série nunca tem prestígio menor que um de papel menor.
3. Estabilidade: reordenar entidades de entrada ou rodar o rerank duas vezes não muda nenhum tier.
4. Cada tier respeita a faixa de Éter.
5. Nenhum nicho tem mais de 1% de míticas (arredondado para cima).
6. Todas as cartas com `prestige_source = 'CURATED'` têm `reviewed_by`.

## 8. Dados e migrations
- `niches` (key, labels, family, perfil de limiares e pesos).
- `entities.niche_id` (FK), `entities.prestige real`, `entities.prestige_source text` (`COMPUTED`, `CURATED`, `OVERRIDE`), `entities.prestige_reason text`.
- `series.role_hint` opcional e `entity_series.role` já existe (`MAIN` ou `SUPPORTING`); o job passa a usá-lo.
- `prestige_audit` (entidade, valor anterior, novo, origem, autor, data) para ajustes manuais.
- Backfill: atribuir `niche_id` das entidades existentes por `universe`, franquia e série (regras no script de migração de dados; as 44 lendas vão para `sport_*`/`music_*`).

## 9. Ferramentas de qualidade
- `npm run catalog:audit`: por nicho, lista o top 25 por prestígio com tier e preço e aponta inversões (violações dos invariantes 1, 2 e 5), cartas sem nicho, cartas curadas sem revisão, e nichos sem topo.
- `npm run catalog:prestige -- --niche=sport_football --apply`: importa os JSON curados, calcula o prestígio, grava e roda o rerank.
- Painel de revisão (`/catalog review`): disputa de nota gera um `OVERRIDE` com motivo e entra na auditoria.

## 10. Fases de implementação
1. **Schema e dados base** (depende de a fase de edições estar pronta): migration de `niches` e das colunas, backfill de nicho, sync do schema da dashboard.
2. **Núcleo de prestígio**: funções puras em `src/catalog/prestige.ts` (ficção, régua de pessoas, regras de coerência, limiares) com testes dos invariantes; integração no `rerank` e no `scoring` mantendo as edições.
3. **Dados curados**: `data/prestige/{sport_football,sport_basketball,sport_mma,music_*,idol}.json` com os números de conquistas das cartas atuais e fontes, marcados para a sua revisão.
4. **Ferramentas**: `catalog:audit` e `catalog:prestige`; testes de integração.
5. **Aplicação no banco**: migração, importação, rerank e relatório de auditoria para você aprovar antes de valer no servidor.
6. **Dashboard** (depois): rankings por nicho e histórico de prestígio.

## 11. Riscos e decisões em aberto
- Notas de prestígio de pessoas são julgamento; por isso ficam em dados com números e fonte, e você revisa antes de valer.
- Limiares podem precisar de ajuste quando o catálogo crescer; ficam em configuração e o relatório de auditoria mostra a distribuição.
- Dados de papel (`MAIN` ou `SUPPORTING`) vêm do AniList; jogos e cinema podem ter pouco dado, então `historia_score` cai para o piso e o prestígio depende mais de fama.
- Direitos de imagem e de uso de nome de pessoas reais: a política de catálogo (revisão, `is_adult`, pessoas reais) continua valendo.

## 12. Criadores de conteúdo (influenciadores)

Nova família `people_creator`, com nichos `creator_fitness`, `creator_gaming`, `creator_music` (rap e hip-hop em canais), `creator_anime_geek`, `creator_comedy`, `creator_tech_edu`, `creator_lifestyle`, `creator_podcast_talk`, `creator_food`. Cada criador tem também `country` (BR ou mundo), para filtros e rankings por país.

### 12.1 Elegibilidade (regras de segurança)
- Fora: política, candidatos, cargos públicos e ativismo político; menores de 18 anos; conteúdo adulto; pessoas com processo criminal grave em andamento ou condenação por crime grave; qualquer pessoa que peça remoção.
- Dentro: quem gera conteúdo e marcou a vida das pessoas: fitness, games, rap, anime e cultura geek, humor, tecnologia e educação, vlog, podcast, culinária.
- Remoção: comando de staff `/catalog takedown <slug>` marca a carta como `DISABLED` com motivo e registra na auditoria; cartas desativadas saem do sorteio e do site, e pactos existentes são reembolsados.

### 12.2 Dados e prestígio
Dados curados em `data/prestige/creators/<nicho>.json`, um registro por criador: `slug`, `name`, `country`, `niche`, `platforms` (canal, URL), `subscribers` (número e data de referência), `total_views` (quando houver), `started_year`, `milestones` (prêmios, marcos), `sources` (links) e `reviewed_by`. Números sempre com fonte e data; nada de estimativa sem origem.

Régua (0 a 100), normalizada dentro do nicho:
```
audiencia  (45%) = percentil de inscritos entre os criadores do nicho (escala logarítmica)
influencia (25%) = marcos de impacto (prêmios, recordes, produtos e marcas, eventos) pontuados de 0 a 100
longevidade(15%) = anos de atividade relevante (teto em 15)
legado     (15%) = peso cultural curado (0 a 100) com justificativa escrita
```
Os limiares de tier são os de pessoas (seção 5). A arte começa como emblema original (sem foto); foto só por `data/art/overrides.json` com fonte e licença.

### 12.3 Fases
1. Pesquisa e dados curados (JSON com fonte), sem código.
2. Importador `catalog:creators` que cria as entidades (universe `CINEMA` ou novo universo `CREATOR`, a decidir na fase de schema), niche, prestígio e edições.
3. Auditoria (`catalog:audit`) e revisão sua antes de valer.
