<div align="center">

# 🌌 Kogu — Multiverse Gacha, Cards & RPG Bot

**O bot definitivo de invocação dimensional, colecionismo de cartas seriadas (`1/1`) e RPG para Discord.**  
*Parte oficial do ecossistema **Koru Anime**.*

[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Discord.js](https://img.shields.io/badge/Discord.js-v14-5865F2?style=for-the-badge&logo=discord&logoColor=white)](https://discord.js.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Drizzle_ORM-4169E1?style=for-the-badge&logo=postgresql&logoColor=white)](https://orm.drizzle.team/)
[![Tests](https://img.shields.io/badge/Tests-1.290_Passing-10B981?style=for-the-badge&logo=vitest&logoColor=white)](#qualidade-seguranca--testes)

[📜 Termos de Serviço](./docs/TERMS.md) • [🔒 Política de Privacidade](./docs/PRIVACY.md) • [🛡️ Segurança](./SECURITY.md)

</div>

---

## ✨ Destaques do Kogu

- 👑 **Raridades com Tiragem Limitada (`TIER_MAX_SUPPLY`):**
  - **Mítico (`1.000+` 💎 Éter):** Tiragem exclusiva **`1/1`** por servidor — apenas um único colecionador pode deter o pacto.
  - **Lendário (`750–999` 💎 Éter):** Máximo de **3 cópias** por servidor.
  - **Épico (`500–749` 💎 Éter):** Máximo de **10 cópias** por servidor.
- 🌍 **Catálogo Multiversal Curado (+1.350 Entidades Ativas):**
  - **Animes & Mangás** (AniList / Jikan)
  - **Games & RPGs** (IGDB)
  - **Cinema, Séries & Doramas** (TMDB — K-Dramas, J-Dramas, Hollywood)
  - **Ícones da Música & Idols** (K-Pop, J-Pop e Pop Global)
- 🎨 **Motor Gráfico Nativo (`@napi-rs/canvas`):** Renderização determinística de cartas em alta definição com skins temáticas, molduras por raridade e variantes cosméticas.
- 🗼 **Progressão Profunda de Éter:**
  - **Tutorial Interativo (`$tuto`):** Pacote de boas-vindas com `+500 💎 Éter`, `+5 Rolls` e `+1 Pacto Livre ($fc)` que ignora o tempo de recarga.
  - **Torre de Éter (`$ktower` / `$build` / `$destroy`):** 12 andares de bônus passivos permanentes com reembolso integral de 100%.
  - **Caixas Astrais (`$kl`) & Relíquias Elementais (`$relics`):** Safira, Rubi, Esmeralda, Ouro e Diamante.
- ⚔️ **Arena RPG & Minijogos Multiplayer:**
  - **Arena 1v1 (`$arena`):** Combate automático em turnos baseado nos atributos reais (`ATK`, `DEF`, `SPD`, `HP`) das cartas do seu Panteão.
  - **Cassino de Familiares (`$slot`):** Captura de mascotes elementais com chance de versão **✨ Shiny**.
  - **Minijogos de Chat (`$blacktea` e `$quiz`):** Partidas rápidas valendo Cristais de Éter.

---

## 📚 Comandos Principais (62 Comandos Registrados)

| Categoria | Comandos Principais | Descrição |
| :--- | :--- | :--- |
| **🎓 Início & Tutorial** | `$tuto`, `$skiptuto`, `$fc` (`$freeclaim`), `$rt` | Guia de 5 passos, pacote inicial e carga de Pacto Livre |
| **🔮 Invocação (`Summon`)** | `$w`, `$h`, `$m`, `$wa`, `$wg`, `$wc`, `$ha`, `$hg`, `$hc`, `/roll` | Sorteio de cartas por gênero e universo com proteção anti-snipe |
| **🏛️ Panteão (`Collection`)** | `$pt` (`$mm`), `$im`, `$trade`, `$give`, `$fm`, `$divorce`, `$note` | Gestão da coleção, trocas seguras e customização |
| **💎 Economia & Torre** | `$ktower`, `$build`, `$destroy`, `$kl`, `$relics`, `$daily`, `$givekakera` | Torre de Éter (12 andares), Lootboxes Astrais, Relíquias e Daily |
| **⚔️ Combate & Jogos** | `$arena`, `$slot` (`$pokemon`), `$bt` (`$blacktea`), `$quiz` | Duelos RPG por turnos, Pokéslot e jogos de palavras/trivia |
| **🌠 Lista de Desejos** | `$wish` (`$wl`), `$starwish` (`$sw`), `$wishremove` | Notificações automáticas e bônus de chance de aparição |
| **⚙️ Configuração** | `$settings`, `$prefix`, `$lang`, `$gamemode`, `$setrolls`, `$disable` | Painel administrativo interativo e ajustes por servidor |

---

## 🏗️ Arquitetura do Projeto

```text
src/
├── canvas/          # Motor de renderização de cartas (@napi-rs/canvas)
├── catalog/         # Adaptadores de ingestão (AniList, Jikan, TMDB, IGDB) e curadoria
├── config/          # Variáveis de ambiente (Zod) e balanceamento de Gacha (TIER_MAX_SUPPLY)
├── core/            # Roteador híbrido ($prefixo + /slash), middlewares, cooldowns e registry
├── i18n/            # Internacionalização (pt-BR e en-US)
├── infra/           # PostgreSQL (Drizzle ORM), Redis/MemoryStore, logger (Pino) e safeFetch
├── modules/         # Módulos de domínio (summon, collection, economy, progression, wishlist, config, admin, help)
└── ui/              # Componentes visuais, paginadores e embeds padronizados
```

---

## 🛡️ Qualidade, Segurança & Testes

O **Kogu** conta com **66 suítes de testes automatizados (1.290 testes unitários)** cobrindo:
- Proteção contra SSRF e validação de rede (`safeFetch`).
- Determinismo visual e limites de memória do renderizador Canvas.
- Regras de negócio de invocação, tiragem limitada (`1/1`), wishlist, economia e progressão.

```bash
# Verificar tipagem estática
npm run typecheck

# Executar linter
npm run lint

# Rodar suíte completa de testes unitários
npm test
```

---

## 📄 Documentação Legal

- [Termos de Serviço (Terms of Service)](./docs/TERMS.md)
- [Política de Privacidade (Privacy Policy)](./docs/PRIVACY.md)
- [Política de Segurança (Security Policy)](./SECURITY.md)
