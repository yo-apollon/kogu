# Política de Segurança (Security Policy)

## Versões Suportadas

| Versão | Suportada          |
| ------ | ------------------ |
| 2.0.x  | :white_check_mark: |
| < 2.0  | :x:                |

## Práticas de Segurança do Repositório

- **Zero Segredos no Git:** Tokens do Discord (`DISCORD_TOKEN`), chaves de API (`TMDB_API_KEY`, `IGDB_CLIENT_SECRET`) e credenciais de banco (`DATABASE_URL`, `REDIS_URL`) nunca são versionados. Utilize apenas variáveis de ambiente baseadas no `.env.example`.
- **Proteção SSRF (`safeFetch`):** Todas as requisições HTTP externas para carregamento de imagens e APIs de catálogo passam por validação estrita de protocolo, DNS e bloqueio de faixas de IP privadas/loopback (`127.0.0.0/8`, `10.0.0.0/8`, `169.254.0.0/16`, etc.).
- **Transações Atômicas (`SELECT ... FOR UPDATE`):** Operações críticas de economia, pactos de tiragem limitada (`TIER_MAX_SUPPLY`), trocas (`$trade`) e transferências de Éter (`$givekakera`) rodam em transações isoladas no PostgreSQL para impedir condições de corrida (*race conditions*).

## Reportando uma Vulnerabilidade

Se você encontrar qualquer vulnerabilidade de segurança ou falha de exploração econômica no **Kogu**:
1. **Não abra uma Issue pública** contendo detalhes do exploit.
2. Entre em contato diretamente com a administração do projeto via Discord oficial ou envie um relato privado pelo GitHub Security Advisories.
