# Política de Privacidade — Kogu

**Última atualização:** Outubro de 2026

Esta Política de Privacidade descreve como o bot **Kogu** (parte do ecossistema **Koru Anime**) coleta, armazena e utiliza dados dos usuários na plataforma Discord, em conformidade com a Lei Geral de Proteção de Dados (LGPD — Lei nº 13.709/2018) e as políticas para desenvolvedores do Discord.

## 1. Dados Coletados
O Kogu armazena apenas o mínimo estritamente necessário para o funcionamento das mecânicas de jogo e configuração de servidores:
- **Identificadores do Discord (Snowflakes):** `user_id` (ID público do usuário), `guild_id` (ID do servidor) e `channel_id` (ID de canais configurados).
- **Dados de Jogo:** Cartas invocadas e pactadas (`pacts`), lista de desejos (`wishlist`), saldo de Éter, relíquias, progresso no tutorial (`$tuto`), andares da Torre de Éter (`$ktower`), familiares capturados (`$slot`) e estatísticas de minijogos.
- **Configurações do Servidor:** Prefixo customizado (`$`), idioma (`pt-BR` / `en-US`) e canais permitidos ou bloqueados pelos administradores.

## 2. Uso do Conteúdo de Mensagens (Message Content Intent)
- O Kogu utiliza a permissão `MESSAGE_CONTENT` **exclusivamente em memória** e em tempo real para:
  1. Detectar comandos iniciados pelo prefixo configurado no servidor (ex.: `$wa`, `$ha`, `$tuto`, `$ktower`).
  2. Validar respostas de minijogos ativos no canal quando iniciados pelos próprios jogadores (ex.: palavras enviadas durante uma rodada de `$blacktea`).
- **O Kogu NÃO armazena, registra em banco de dados, vende ou compartilha o histórico de conversas ou mensagens dos usuários.**

## 3. Compartilhamento e Segurança
- Nenhum dado coletado pelo Kogu é vendido ou cedido a terceiros para fins publicitários.
- Os dados são armazenados em banco de dados PostgreSQL seguro com acesso restrito à aplicação.

## 4. Retenção e Exclusão de Dados (Direito ao Esquecimento)
- Administradores podem remover as configurações de seus servidores a qualquer momento removendo o bot ou utilizando comandos administrativos.
- Usuários podem solicitar a exclusão completa de seus dados de jogo (`user_id` e registros associados) entrando em contato com os administradores do projeto no servidor oficial do Kogu no Discord.
