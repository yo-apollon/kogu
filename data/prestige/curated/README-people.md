# Prestígio curado de pessoas reais (esporte, música, idols)

Arquivo de dados: `people.json` (51 pessoas). Todas com `reviewed: false`. Data da coleta: 2026-10-31. Descrições neutras, sem fotos. Escopo: as 44 lendas de `seedPopCultureAndSports.ts` + 7 idols reais de `seedIdolsAndDoramas.ts`. Os personagens de doramas e os de ficção do `docs/catalog.json` ficaram de fora (são fictícios). "The Weeknd (Starboy)" (`the-weeknd-starboy`) é duplicata da mesma pessoa de `the-weeknd` e entra em `aliasSlugs` e `duplicates`.

## Como o prestígio é calculado
`prestigeProposal = 100 * ((soma ponderada dos critérios com tetos) / normMax) ^ gamma`, limitado a 0..100.
- Cada critério tem peso e teto (`formulas.<nicho>.weights/caps`). A soma é dividida pelo máximo plausível do nicho (`normMax`): o maior nome da história do nicho fica perto de 100.
- `gamma < 1` comprime a escala por cima (0,7 futebol e basquete, 0,8 MMA e música, 0,9 idol): dá resolução às estrelas atuais sem mudar nenhuma ordem (a transformação é monotônica).
- Critério `null` (sem fonte) sai da soma e os pesos restantes são renormalizados, com penalidade de cobertura `0,85 + 0,15 * cobertura`; a confiança cai de `high` para `medium` e `inputs.missingCriteria` lista o que falta.
- Tier: MYTHIC >= 95, LEGENDARY >= 85, EPIC >= 70, RARE >= 50, COMMON abaixo (limiares de pessoas do spec).

### Nichos e réguas
| Nicho | Critérios (peso, teto) |
|---|---|
| `sport_football` | Copa do Mundo 18 (54), Bola de Ouro 6 (36), Champions 4 (16), recorde histórico 5 (10), anos de elite 1,5 (15), temporadas de domínio 5 (20). normMax 115 |
| `sport_basketball` | títulos 6 (36), MVP 5 (25), MVP das Finais 3 (18), All-NBA 1º time 1,5 (15), All-NBA total 0,3 (6), recordes 3 (12), temporadas 0,35 (8). normMax 112 |
| `sport_mma` | divisões com cinturão 7 (14), defesas 2,5 (25), maior sequência 0,7 (20), legado curado 0,41 (41). normMax 95 |
| `music_pop/rock/hiphop/other` | vendas (teto 300 mi) 18, prêmios 17, recordes curados 20, influência curada 35, anos de carreira (teto 40) 10 |
| `idol` | grupo 30, solo 20, alcance internacional 25, prêmios 15, anos de carreira (teto 15) 10 |

Prêmios de música = o maior entre `(Grammys + 2 x Álbum do Ano) / 30` e `honrarias / 125` (Lifetime Grammy, Rock Hall etc.). A tabela completa está em `formulas` dentro do JSON.

## Decisões de ajuste (pesos até a ordem fazer sentido)
1. Futebol: a régua do spec é favorável a quem tem Copa. Pelé não tem Bola de Ouro competitiva (só europeus eram elegíveis até 1995): a honraria da France Football conta como 1 e a Libertadores como título continental. Marta usa Melhor do Mundo FIFA como equivalente à Bola de Ouro.
2. Basquete: sem o critério de All-NBA 1º time e recordes, LeBron e Curry ficavam muito abaixo de Jordan e Luka empatava com Iverson; adicionei recordes e temporadas.
3. MMA: o legado curado pesa 41% para não punir quem se aposentou invicto (Khabib) nem quem tem poucas defesas por motivos extra-cartel. Não há MYTHIC além de Jones.
4. Música: influência e recordes têm peso maior que vendas, porque vendas de era streaming não são comparáveis às de era física. Mesma régua em todos os subnichos, o que permite comparar entre eles.
5. Idol: solistas (Ado) não têm critério de grupo; os membros de grupo herdam as conquistas do grupo e se diferenciam no solo.

## Ordem resultante (topo e fim)
- `sport_football`: Messi 100, Pelé 98,8, Cristiano Ronaldo 84,9, Marta 80,9 ... Neymar 33,4, Haaland 32,4, Vini Jr 31,4.
- `sport_basketball`: Jordan 100, LeBron 90,4, Kobe 74,5, Curry 67,8, Shaq 67,5 ... Giannis 45,8, Iverson 29,4, Luka 19,2.
- `sport_mma`: Jones 97,5, Anderson Silva 88,3, Amanda Nunes 86,5, Khabib 80,3, Makhachev 80,1 ... Topuria 66,5, Charles do Bronx 56,7.
- `music_pop`: Michael Jackson 96,3, Beyoncé 86,8, Taylor Swift 82,5 ... Billie Eilish 59,4, Dua Lipa 52,6.
- `music_rock`: Freddie Mercury 84,6, Kurt Cobain 64,2.
- `music_hiphop`: Eminem 82,6, Snoop Dogg 68,2, Post Malone 54, Travis Scott 53,8, Matuê 42,4.
- `music_other` (novo): Bob Marley 71,5, Daft Punk 69,2.
- `idol`: Jungkook 94,7, V 91,8, Lisa 83,6, Jennie 83,2, Ado 72,4, Felix 70,7, Karina 61,2.

## Pontos para o dono revisar
1. Cristiano Ronaldo (84,9) fica a 0,1 ponto de LEGENDARY e abaixo de Messi e Pelé por não ter Copa; o seed o tratava como MYTHIC. Considere um `OVERRIDE` com motivo.
2. Queda geral frente aos tiers escritos à mão: Mbappé, Neymar, Haaland, Vini, Luka, Giannis, Iverson e vários MMA/música caem de LEGENDARY para COMMON-RARE. É o efeito pretendido (estrela atual abaixo de lenda consolidada), mas o dono deve decidir se COMMON é aceitável para Mbappé (44,8) e Giannis (45,8); um gamma menor sobe todos.
3. Freddie Mercury (84,6) ficou 0,4 abaixo de LEGENDARY; o nicho rock tem só 2 cartas e o máximo plausível é um nome ausente (Beatles/Elvis), então ele pode ser tratado como topo do nicho.
4. Idols: Jungkook 94,7 e V 91,8 saem LEGENDARY por herdarem o grupo BTS; os valores de `groupAchievements`, `soloAchievements`, `intlReach` e `awards` são notas curadas (0-100) que só têm base numérica nos campos `notes`. Revisar.
5. Música: `records` e `influence` são notas curadas, cada uma com justificativa em `recordsWhy` e `influenceWhy`. Vendas são estimativas alegadas (Wikipedia) e não certificações; Billie, Dua, Daft Punk, Snoop, Travis, Post e Matuê têm `sales: null` por falta de fonte confiável.
6. Contagens de Grammy (Beyoncé 35, Swift 14, Eminem 15, MJ 13 vêm do Wikipedia; Rihanna 9, Weeknd 4, Billie 10, Dua 3, Daft Punk 6, Cobain 1 e os zeros de Snoop, Travis, Post, Matuê, Marley, Queen vieram de conhecimento geral, confiança média/baixa) e contagens de All-NBA de Jordan, Kobe, Shaq, Iverson, Giannis e Luka precisam de conferência.
7. Dados que mudaram em 2026 e estão nas notas: Messi vice-campeão mundial (Espanha campeã) com 21 gols em Copas; Mbappé 22 gols e Chuteira de Ouro 2026; Jones pediu liberação do UFC; Topuria perdeu o leve para Gaethje; Pereira vagou o cinturão e perdeu para Gane; McGregor perdeu para Holloway; LeBron no 76ers e Giannis no Heat. Resultados de busca da web sobre 2026 (por exemplo o vencedor da Bola de Ouro 2026) não foram usados por serem contraditórios.
8. Ado: o card mistura a artista com a personagem Uta (ficção). Prestígio da artista real aplicado.
9. Daft Punk é duo e foi tratado como uma carta; Bob Marley e Daft Punk exigem aceitar o novo nicho `music_other`.
10. Fontes: as URLs são páginas do Wikipedia (e The Score para a Copa 2026) lidas durante a coleta; números marcados `medium`/`low` vieram de conhecimento geral e não foram abertos na fonte citada.
