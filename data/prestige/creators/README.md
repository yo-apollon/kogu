# Criadores de conteúdo: dados curados (fase 1)

Coleta: 2026-10-31. Estado: rascunho, todos com `reviewed: false`. Nada aqui vale antes da revisão do dono.

## Método
- Lista de nomes: curadoria própria a partir de conhecimento público do nicho, filtrada pelas regras de elegibilidade (docs/raridade-por-nicho.md, seção 12.1).
- Números de seguidores: só quando lidos em página pública durante a coleta. Fontes usadas:
  - Wikipédia (en): maiores canais do YouTube (referência "junho de 2026", gravado como 2026-06-01), mais seguidos no TikTok (2026-10-23), na Twitch (2026-08-02) e no Instagram (setembro de 2026, gravado como 2026-09-30).
  - Portal Tela, ranking dos 20 maiores canais do Brasil (2026-04-22).
  - Olhar Digital: influenciadores de Minecraft (2025-07-24) e streamers brasileiros da Twitch (2026-06-03).
- Quem tem número lido: `confidence: "high"` (valor da fonte, arredondado). Sem número: `followers: null` e `confidence: "low"`.
- Nenhuma foto ou imagem foi usada ou baixada.

## Limitações
- Contagens mudam todo dia e as fontes arredondam; os valores são aproximados e de datas diferentes (campo `asOf`).
- `handle` repete o nome e `url` é `null` em todos: handles e URLs de canais não foram verificados. Preencher na revisão.
- `sources` está vazio para quem não tem número (a identidade não foi checada em página, só pelo conhecimento do nicho).
- `startedYear` só foi preenchido onde havia certeza; o resto é `null`.
- `milestones` está vazio em todos: marcos precisam de fonte e não foram pesquisados.
- `genderHint` é dedução pelo nome/figura pública, usar só como dica.
- Divergência de fonte: "Natan por Aí" aparece com 39,3 mi (Portal Tela) e 55,0 mi (Wikipédia); ficou `null`. Podpah (~7,5 mi segundo Meio & Mensagem, sem data) também ficou `null`.
- "Rezende Evil" entra em games com a contagem do Portal Tela (34,2 mi).
- Itens que são canais, marcas ou grupos e não pessoas (ex.: Você Sabia?, TecMundo, Canaltech, Porta dos Fundos, Kurzgesagt, NerdCast, Podpah, Haikaiss, Costa Gold, Dude Perfect, TazerCraft): decidir se viram cartas.
- Sem número de seguidores: quase todos os nichos de fitness, música, podcast, comida e tech/edu. A régua de audiência precisará de uma segunda rodada de coleta (Social Blade/YouTube).

## Contagem entregue (alvo era 20 a 30 por país por nicho)
Abaixo da meta em vários nichos, por falta de nomes verificáveis dentro do tempo: anime/geek BR 8, podcast BR 8, fitness BR 10, comida BR 12, lifestyle BR 12, tech/edu BR 14. O resto fica entre 16 e 23. Ver tabela impressa pela validação (rodar `node` sobre os JSONs).

## Deixados de fora (`excluded` em cada arquivo)
Por regra: políticos/candidatos/ativismo político (Felipe Neto, Pablo Marçal, Danilo Gentili, Brasil Paralelo), menores (Maria Clara & JP), condenação ou processo grave (Chris Brown, Tory Lanez, Diddy, Andrew Tate), controvérsias públicas relevantes tratadas como dúvida (Monark, Kanye West, Logan/Jake Paul, James Charles, David Dobrik, Dr Disrespect, Júlio Cocielo, Virginia Fonseca, Renato Cariani, Lil Wayne, outros) e falecidos (Technoblade, Marília Mendonça, Mac Miller, Paulo Gustavo). Motivos individuais estão nos arquivos. O dono pode reavaliar qualquer um.

## Para o dono conferir
- Todos os nomes com `confidence: "low"` (224 de 281): identidade, país, idade (maior de 18), ausência de processo grave e se aceitam ser retratados.
- Nomes com atenção extra de elegibilidade: Thiago Nigro (Primo Rico), Gkay, Boca Rosa, Kéfera, Carlinhos Maia, Joe Rogan, Andrew Schulz, Theo Von, Travis Scott, 21 Savage, IShowSpeed, Kai Cenat, Dream, Gracyanne Barbosa.
- Idade (18+) não verificada em: Emilly Vick, Enaldinho, JP Plays, Julia Minegirl, Nobru, Cellbit, Mussoumano, Robin Hood Gamer, Jelly, Mikecrack, Stokes Twins, Ben Azelart, Brooke Monk, Loren Gray.
- Contas reais de Gaules (YouTube) e Casimiro: só Twitch foi lido.
- Pessoas já duplicadas entre nichos foram evitadas; "Mano a Mano (podcast)" é o programa, Mano Brown (pessoa) está em music.
