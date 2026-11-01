# Arte oficial das cartas (overrides)

O bot só desenha a imagem de uma carta quando ela é confiável. Armas, itens, companheiros e domínios
(`WEAPON`, `COMPANION`, `DOMAIN`, ou nomes de objeto) nunca usam a arte de personagem, a capa do jogo ou o
pôster do filme: mostram um **emblema original** da classe do item (espada, escudo, joia...). Personagens
cuja imagem é pôster, capa, placeholder ou ausente mostram o emblema de personagem (busto + iniciais).

Para uma carta mostrar a imagem real, adicione um override neste diretório.

## Arquivo `overrides.json`

Um array JSON (começa vazio, `[]`). Cada item:

```json
{
  "slug": "mjolnir",
  "url": "https://upload.wikimedia.org/wikipedia/commons/.../imagem.png",
  "kind": "ITEM",
  "source": "Wikimedia Commons",
  "credit": "Autor, licença CC BY-SA 4.0"
}
```

| Campo    | Obrigatório | Significado |
| -------- | ----------- | ----------- |
| `slug`   | sim         | `entities.slug` da carta (veja a coluna `slug` em `.cache/art-audit.csv`). |
| `url`    | sim         | `https` direto para a imagem (png, jpg ou webp). |
| `kind`   | sim         | `ITEM` (arma/objeto) ou `CHARACTER` (personagem). |
| `source` | sim         | De onde veio (site, acervo, "arte própria"). |
| `credit` | não         | Autor e licença, para atribuição. |

Regras:

- O host da URL precisa estar em `IMAGE_HOST_ALLOWLIST` (`src/config/constants.ts`): hoje AniList, MyAnimeList,
  IGDB, TMDB, Discord (cdn/media), Wikimedia (`upload.wikimedia.org`), Wikia, GitHub Pages (`yo-apollon.github.io`) e Imgur.
  Para arte própria, publique em `docs/assets/cards/` (GitHub Pages) e use essa URL.
- Use só imagens com licença ou permissão de uso adequada (arte própria, domínio público, Creative Commons com
  atribuição, ou autorização expressa). Registre a licença em `credit`.
- A imagem deve mostrar o objeto/personagem em si, em retrato (a carta é 480x750 e corta no modo "cover").
- Um `slug` repetido no arquivo vale o último.

## Como aplicar

```
npm run catalog:art                 # dry-run: valida host, tipo e tamanho; mostra o que faria
npm run catalog:art -- --apply      # grava como imagem primária ACTIVE em entity_images
```

O script valida cada override (host permitido, a URL responde png/jpg/webp com tamanho razoável) e é
idempotente. A primária anterior, se for outra URL, vira `REMOVED` (a verificação periódica não a reativa).

O render (`src/canvas/engine/artResolver.ts`) também lê este arquivo no start do processo: um override
vale para a carta mesmo antes de gravar no banco. Reinicie o bot depois de editar.

## Auditoria

`npm run catalog:art-audit` (somente leitura) gera `.cache/art-audit.csv` com a classificação de cada carta
(`CHARACTER`, `POSTER`, `COVER`, `PLACEHOLDER`, `MISSING`, `UNKNOWN`), se é confiável e quais cartas dividem a mesma imagem.
Use `-- --catalog=docs/catalog.json` para auditar o catálogo exportado, sem banco.
