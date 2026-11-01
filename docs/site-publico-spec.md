# Especificação do site público do Arqon (inspirada na estrutura do mudae.net)

Este documento descreve a estrutura e o comportamento das páginas públicas do mudae.net, observadas em 31/10/2026, e como reproduzir as mesmas ideias no site do Arqon. É uma descrição de funcionalidade em palavras próprias. Não copie código, textos, logotipos, imagens, nomes de seções palavra por palavra nem o visual exato do site deles: o Arqon usa a sua própria identidade (design system em `dashboard/src/components` e tokens em `dashboard/src/styles/tokens.css`).

Limites da observação: só páginas públicas, sem login. Não vi as áreas logadas nem o corpo principal da página de personagem (o conteúdo capturado dela foi só o painel de contribuições). Onde isso afeta algo, está marcado como "a confirmar".

## 1. Mapa de páginas observado

| Rota (padrão) | O que é |
|---|---|
| `/` | Home: vitrine de personagens populares, notícias, personagem aleatório, séries em alta, personagens do dia, recomendações |
| `/search?type=character` | Busca de personagens com filtros |
| `/search?type=series` | Busca de séries (e `category=anime` etc.) |
| `/search?type=customlist` (também `/custom-lists`) | Busca de listas personalizadas |
| `/character/<id>/<nome>` | Página de um personagem |
| `/series/<id>/<nome>` | Página de uma série |
| `/profile/<usuario>` | Perfil público de um usuário |
| `/lists` | Navegar listas públicas (curtidos de cada usuário) |
| `/lists/<id>` | Lista completa de um usuário (personagens ou séries curtidos) |
| `/custom-lists/<id>` | Uma lista personalizada |
| `/news`, `/news/<id>` | Notícias e artigos |
| `/login?redirect=...` | Entrar; ações de curtir exigem login e voltam para a página |

URLs levam o ID numérico e o nome. Para o Arqon use `slug` estável no lugar do nome com espaços (`/character/zero-two`), mantendo o ID interno fora da URL.

## 2. Home

Blocos, de cima para baixo:
1. **Personagens populares** com abas por mídia: Anime, Mangá, Jogos, Visual Novels, Manhwa, Ocidental, Quadrinhos. Cada aba mostra uma grade de cartas com imagem e nome. Abaixo, três atalhos: ver mais, recém-adicionados e adicionados na última atualização do bot (filtro por mês).
2. **Notícias recentes**: três artigos com título, trecho, data e autor, mais link "ver todas".
3. **Personagem aleatório**: um personagem com botão de atualizar (sorteia outro sem recarregar a página) e botão de curtir.
4. **Séries em alta**: ranking numerado (01, 02, ...) com logo da série.
5. **Personagens do dia**: grade de personagens ligados à data de hoje (aniversário), com link para ver todos do dia.
6. **Recomendações recentes de anime**: faixa de capas, com link para ver todos.

## 3. Busca de personagens (a página mais densa)

- **Abas de mídia no topo**: Todos, Anime, Mangá, Jogos, Visual Novels, Manhwa, Ocidental, Quadrinhos (a aba escolhida fica na URL, no hash ou no parâmetro).
- **Filtros** (painel recolhível):
  - Personagens exclusivos do site: incluir, excluir ou somente.
  - Atualização do bot: filtrar por mês/versão em que o personagem entrou.
  - Status: todos, travados, sem imagem.
  - Série: seletor múltiplo com excluir; opção de sobreposição (para pacotes) e de incluir personagens de subséries (incluir, excluir, somente).
  - Gênero: feminino, masculino, outro.
  - Tags: seletor com modo qualquer, todas ou nenhuma; clicar em uma tag a exclui.
  - Mídia (de novo, como filtro combinável) e "incluir spoilers".
- **Resultado em tabela**: posição, miniatura, nome (link), série (link), gênero, rank, e uma coluna de nota de 1 a 10 com o botão de curtir. Alternância entre tabela e grade de cartas. Paginação por "ver mais".
- Visitante deslogado vê tudo, mas curtir leva ao login.

## 4. Listas públicas

- Página "Navegar listas públicas" com abas **Personagens / Séries / Usuários** e uma busca.
- Cada item é um cartão de usuário: avatar, nome (link para o perfil), "N personagens curtidos", miniaturas dos 5 primeiros e link "ver mais" para a lista completa.
- Ao fim, "ver mais listas" (paginação). Há também a busca de listas personalizadas (`/custom-lists`): tabela com nome, tipo (Personagens, Séries, Tags, Imagens), dono e número de itens, filtrável por tipo, ordenada por tamanho.
- Ideia central: **a curtida de cada usuário vira uma lista pública** e os usuários podem montar listas temáticas além disso.

## 5. Perfil público

- Cabeçalho com avatar e nome.
- Seção "Sobre mim" (texto do usuário; mensagem padrão quando vazio).
- "Personagens curtidos": grade de miniaturas (cerca de 16) e link para ver todos.
- "Séries curtidas": grade de capas e link para ver todas.
- Esses dois links levam à lista completa (`/lists/<id>`).

## 6. Página de personagem (parcial)

Visível só o painel de **contribuições** da comunidade, que mostra o que a página permite fazer (a confirmar a parte de leitura): adicionar imagem oficial (URL ou arquivo, com série, tags da imagem e créditos de artista/colorista/finalizador/animador), trocar uma imagem, reordenar imagens por arrastar, trocar a imagem principal por série, remover imagens, marcar créditos e tags nas imagens, reportar imagens ruins, adicionar/editar/reordenar/remover **frases** do personagem (limite de 480 caracteres, marcar NSFW, ocultar spoiler), adicionar/renomear/reordenar **apelidos** (com fonte que prove que é oficial), adicionar e ocultar **tags** do personagem.
Toda alteração passa por revisão (envia justificativa e fonte); nada vai direto para o site.

## 7. Como reproduzir no Arqon

### 7.1 Escopo em duas camadas
1. **Site público** (sem login para navegar): home, busca de personagens e séries, página de personagem, página de série, listas e perfis públicos, notícias. Login só para curtir, avaliar e contribuir.
2. **Painel do jogador e do admin** (já planejado em `docs/dashboard-plan.md`): panteão, economia, wishlist, histórico, configurações do servidor. Fica sob `/g/[guildId]/...`.

### 7.2 Mapeamento para os dados que já existem
| Ideia | Dado no Arqon |
|---|---|
| Personagem | `entities` (status `ACTIVE`, tier, `popularity_rank`, `popularity_score`, `likes_count`, `claims_count`) |
| Série | `series`, `entity_series`, `franchises`, `series_external_ids` |
| Imagens do personagem | `entity_images` (primária, status) |
| Rank | `popularity_rank`, `like_rank`, `claim_rank` |
| Curtidas do usuário | `entity_likes` (usuário e entidade) |
| Perfil | `users` (nome, avatar, vip) mais agregados de `pacts`, `wishes`, `entity_likes` |
| Filtro por mês de entrada | `entities.first_seen_at` ou `created_at` |
| Gênero | `entities.gender` (feminino, masculino, outro; não-binário entra em "outro") |
| Mídia (anime, mangá, jogos...) | `series.media_type` e `universe` |
| Personagem aleatório | amostra ponderada no banco (mesma lógica do pool de sorteio, sem sortear `UNKNOWN`) |
| Séries em alta | `release_windows` ativas e ordenação por `series.popularity` |
| Personagens do dia | requer data de aniversário (campo novo, ver 7.3) |

### 7.3 O que precisa ser criado
- `entity_ratings` (usuário, entidade, nota 1 a 10, uma por par) e média em `entities`.
- `entity_tags` e `entity_tag_links` (tags com nome, categoria, ocultas por spoiler) e filtro por tags qualquer/todas/nenhuma.
- `entity_quotes` (frase, original, fonte, nsfw, spoiler, ordem).
- `entity_aliases` com fonte (hoje há `aliases text[]` sem fonte).
- `user_lists` e `user_list_items` (listas personalizadas: tipo personagens, séries, tags ou imagens; dono; público ou privado).
- `user_profiles` (bio, visibilidade do perfil e das listas, opt-in para ser listado em "navegar listas").
- `news_posts` (título, corpo, autor, data, publicado).
- `birthdays` (mês e dia no personagem) para "personagens do dia".
- Fila de **contribuições** (propostas de imagem, frase, apelido, tag, reporte) reaproveitando `moderation_queue` e o painel de staff (fase C do plano).
- Regras: conteúdo adulto e pessoa real seguem a política do catálogo (`is_adult`, quarentena); nada entra no site sem passar por moderação; imagens só dos hosts permitidos.

### 7.4 Rotas do Arqon
`/` , `/characters` (busca), `/series`, `/character/[slug]`, `/series/[slug]`, `/u/[username]`, `/lists`, `/lists/[id]`, `/news`, `/news/[id]`, `/login`. O painel autenticado continua em `/g/[guildId]/...`, `/me`, `/catalog` (o catálogo logado pode virar `/characters` público; evite duas telas iguais).

### 7.5 Regras de interface
- Busca: abas de mídia, painel de filtros recolhível, estado inteiro na URL (compartilhável), tabela e grade intercambiáveis, paginação por cursor, ordenação por rank, nota e nome.
- Mobile: tabela vira lista de cartões com os mesmos campos; filtros em gaveta.
- Visitante pode navegar tudo; curtir, avaliar e contribuir levam ao login e voltam para a mesma página.
- Cartas usam o componente `CardArt` (razão 0,64, cantos de 4%, borda branca fina), com efeito de variante só no catálogo de cartas do jogador.
- Todo texto em pt-BR e en-US (chaves em `dashboard/messages`).

## 8. Como pedir ao Antigravity (uma etapa por vez)
1. "Leia `AGENTS.md`, `docs/dashboard-plan.md` e este arquivo. Resuma em 8 linhas o que vai ser construído. Não edite nada."
2. Migrations: tabelas da seção 7.3 (um agente só em `src/infra/db`), com testes em `tests/integration/db`.
3. Busca pública de personagens (`/characters`): filtros, tabela e grade, URL como estado.
4. Página de personagem e de série (somente leitura).
5. Home com os seis blocos.
6. Perfis e listas públicas.
7. Curtir e avaliar (escrita autenticada, com `requireSession` e limite de taxa).
8. Contribuições e painel de moderação.
Em cada etapa: escopo de arquivos explícito, `typecheck`, `lint` e testes verdes, commit pequeno.

## 9. O que não fazer
- Não copiar textos, nomes de seção literais, logotipo, cores exatas, ícones ou imagens do mudae.net. Não fazer scraping em massa do site deles nem importar o catálogo deles: o catálogo do Arqon vem de AniList, Jikan, IGDB e TMDB.
- Não expor dados de usuários que não optaram por perfil público.
- Não prometer funcionalidades logadas que não foram observadas (confirmar com a conta antes de implementar: página principal de personagem, fluxo de contribuição, sistema de notas).
