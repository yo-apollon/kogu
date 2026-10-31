/**
 * Portal Web Oficial do Kogu (estilo mudae.net evoluido + ecossistema Koru Anime).
 *
 * Servido diretamente pelo servidor HTTP do bot:
 * - `/` ou `/bot`: Portal completo com Explorador do Catalogo ao vivo, Guia de 62 Comandos,
 *   Calculadora da Torre de Eter ($ktower) e estatisticas em tempo real.
 * - `/api/catalog`: Busca JSON ao vivo no PostgreSQL (personagens, franquias, raridades, imagem).
 * - `/terms`: Termos de Servico estilizados (para Discord Developer Portal).
 * - `/privacy`: Politica de Privacidade estilizada (para Discord Developer Portal).
 */
import type http from "node:http";

export interface PortalQueryDeps {
	searchCatalog?(params: {
		q: string;
		universe: string;
		tier: string;
		limit: number;
	}): Promise<{
		totalActive: number;
		items: Array<{
			id: number;
			name: string;
			seriesTitle: string | null;
			universe: string;
			gender: string;
			tier: string;
			baseAether: number;
			popularityRank: number | null;
			imageUrl: string | null;
		}>;
	}>;
}

const PORTAL_HTML = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Kogu — Database, Comandos & Portal Gacha | Koru Anime</title>
  <style>
    :root {
      --bg: #08080e;
      --surface: #10111c;
      --surface-2: #161829;
      --border: #252842;
      --accent: #8b5cf6;
      --accent-cyan: #38bdf8;
      --accent-rose: #f43f5e;
      --text: #f1f5f9;
      --muted: #94a3b8;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: radial-gradient(circle at 50% 0%, #171432 0%, var(--bg) 55%);
      color: var(--text);
      min-height: 100vh;
      line-height: 1.6;
    }
    a { color: var(--accent-cyan); text-decoration: none; }
    header {
      border-bottom: 1px solid var(--border);
      background: rgba(16, 17, 28, 0.85);
      backdrop-filter: blur(12px);
      position: sticky;
      top: 0;
      z-index: 50;
    }
    .nav-wrap {
      max-width: 1240px;
      margin: 0 auto;
      padding: 16px 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      flex-wrap: wrap;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 12px;
      font-weight: 800;
      font-size: 1.35rem;
      letter-spacing: 0.08em;
      color: #fff;
    }
    .brand-badge {
      font-size: 0.7rem;
      padding: 3px 8px;
      border-radius: 999px;
      background: rgba(139, 92, 246, 0.18);
      border: 1px solid rgba(139, 92, 246, 0.45);
      color: #c4b5fd;
      letter-spacing: 0.04em;
    }
    .tabs {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    .tab-btn {
      background: transparent;
      color: var(--muted);
      border: 1px solid transparent;
      padding: 8px 16px;
      border-radius: 8px;
      font-weight: 600;
      font-size: 0.9rem;
      cursor: pointer;
      transition: all 0.18s;
    }
    .tab-btn:hover { color: #fff; background: var(--surface-2); }
    .tab-btn.active {
      color: #fff;
      background: rgba(139, 92, 246, 0.18);
      border-color: rgba(139, 92, 246, 0.5);
    }
    .btn-invite {
      background: linear-gradient(135deg, #7c3aed, #2563eb);
      color: #fff;
      padding: 9px 18px;
      border-radius: 8px;
      font-weight: 700;
      font-size: 0.88rem;
      border: none;
      cursor: pointer;
    }
    main {
      max-width: 1240px;
      margin: 0 auto;
      padding: 36px 24px 80px;
    }
    .hero {
      text-align: center;
      padding: 32px 16px 42px;
      border-bottom: 1px solid var(--border);
      margin-bottom: 32px;
    }
    .hero h1 {
      font-size: 2.5rem;
      font-weight: 900;
      letter-spacing: -0.02em;
      margin-bottom: 12px;
      background: linear-gradient(90deg, #fff, #c4b5fd, #38bdf8);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .hero p {
      color: var(--muted);
      max-width: 720px;
      margin: 0 auto 24px;
      font-size: 1.02rem;
    }
    .stats-row {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
      gap: 14px;
      max-width: 880px;
      margin: 0 auto;
    }
    .stat-card {
      background: var(--surface);
      border: 1px solid var(--border);
      padding: 16px;
      border-radius: 12px;
    }
    .stat-val { font-size: 1.55rem; font-weight: 800; color: #fff; }
    .stat-lbl { font-size: 0.78rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; }

    .section { display: none; }
    .section.active { display: block; }

    /* Filters & Search */
    .filter-bar {
      display: flex;
      gap: 12px;
      margin-bottom: 24px;
      flex-wrap: wrap;
    }
    .input, .select {
      background: var(--surface);
      border: 1px solid var(--border);
      color: #fff;
      padding: 11px 14px;
      border-radius: 8px;
      font-size: 0.92rem;
    }
    .input { flex: 1; min-width: 240px; }
    .grid-cards {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
      gap: 18px;
    }
    .char-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      overflow: hidden;
      transition: transform 0.18s, border-color 0.18s;
      display: flex;
      flex-direction: column;
    }
    .char-card:hover { transform: translateY(-4px); border-color: var(--accent); }
    .char-img {
      width: 100%;
      height: 270px;
      object-fit: cover;
      background: #0b0c14;
    }
    .char-body { padding: 14px; flex: 1; display: flex; flex-direction: column; justify-content: space-between; }
    .char-name { font-weight: 700; font-size: 1rem; color: #fff; margin-bottom: 4px; }
    .char-series { font-size: 0.82rem; color: var(--muted); margin-bottom: 10px; }
    .char-meta { display: flex; justify-content: space-between; align-items: center; font-size: 0.8rem; font-weight: 700; }
    .tier-MYTHIC { color: #f43f5e; border: 1px solid rgba(244,63,94,0.45); background: rgba(244,63,94,0.12); padding: 2px 8px; border-radius: 6px; }
    .tier-LEGENDARY { color: #fbbf24; border: 1px solid rgba(251,191,36,0.45); background: rgba(251,191,36,0.12); padding: 2px 8px; border-radius: 6px; }
    .tier-EPIC { color: #c084fc; border: 1px solid rgba(192,132,252,0.45); background: rgba(192,132,252,0.12); padding: 2px 8px; border-radius: 6px; }
    .tier-RARE { color: #38bdf8; border: 1px solid rgba(56,189,248,0.4); background: rgba(56,189,248,0.1); padding: 2px 8px; border-radius: 6px; }
    .tier-COMMON { color: #94a3b8; border: 1px solid rgba(148,163,184,0.3); padding: 2px 8px; border-radius: 6px; }

    /* Commands Table */
    .cmd-list { display: grid; gap: 10px; }
    .cmd-item {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 14px 18px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
      flex-wrap: wrap;
    }
    .cmd-syntax {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      color: var(--accent-cyan);
      font-weight: 700;
      font-size: 0.96rem;
    }
    .cmd-cat {
      font-size: 0.72rem;
      text-transform: uppercase;
      padding: 3px 8px;
      border-radius: 6px;
      background: var(--surface-2);
      color: var(--muted);
    }

    /* Tower Simulator */
    .tower-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 14px;
      margin-top: 18px;
    }
    .perk-box {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 16px;
      cursor: pointer;
      transition: all 0.16s;
    }
    .perk-box.selected {
      border-color: var(--accent-cyan);
      background: rgba(56, 189, 248, 0.08);
    }
    footer {
      border-top: 1px solid var(--border);
      padding: 28px 24px;
      text-align: center;
      color: var(--muted);
      font-size: 0.85rem;
    }
  </style>
</head>
<body>
  <header>
    <div class="nav-wrap">
      <div class="brand">
        <span>KOGU</span>
        <span class="brand-badge">KORU ANIME ECOSYSTEM</span>
      </div>
      <div class="tabs">
        <button class="tab-btn active" onclick="switchTab('catalog', this)">Catálogo & Cartas</button>
        <button class="tab-btn" onclick="switchTab('commands', this)">Comandos (62)</button>
        <button class="tab-btn" onclick="switchTab('tower', this)">Simulador de Torre</button>
        <a class="tab-btn" href="/terms">Termos</a>
        <a class="tab-btn" href="/privacy">Privacidade</a>
      </div>
      <a class="btn-invite" href="https://discord.com/oauth2/authorize?client_id=1561074418250416178&permissions=412317240384&scope=bot%20applications.commands" target="_blank" rel="noopener">
        Adicionar ao Discord
      </a>
    </div>
  </header>

  <main>
    <section class="hero">
      <h1>KOGU MULTIVERSE DATABASE</h1>
      <p>Explore o catálogo oficial de cartas seriadas (Tiragem 1/1 Mítica), consulte a lista completa de comandos e planeje seus andares da Torre de Éter integrado ao Koru Anime.</p>
      <div class="stats-row">
        <div class="stat-card"><div class="stat-val" id="stat-total">1.372</div><div class="stat-lbl">Cartas Ativas</div></div>
        <div class="stat-card"><div class="stat-val">1/1</div><div class="stat-lbl">Tiragem Mítica</div></div>
        <div class="stat-card"><div class="stat-val">62</div><div class="stat-lbl">Comandos Híbridos</div></div>
        <div class="stat-card"><div class="stat-val">5</div><div class="stat-lbl">Universos & Idols</div></div>
      </div>
    </section>

    <!-- ABA 1: CATALOGO -->
    <section id="tab-catalog" class="section active">
      <div class="filter-bar">
        <input id="q-input" class="input" type="text" placeholder="Pesquisar personagem ou obra (ex: Sung Jin-Woo, Jungkook, Round 6, Gojo)..." oninput="debouncedSearch()" />
        <select id="u-select" class="select" onchange="loadCatalog()">
          <option value="">Todos os Universos</option>
          <option value="ANIME">Anime & Mangá</option>
          <option value="GAME">Games</option>
          <option value="CINEMA">Cinema, Doramas & Idols</option>
        </select>
        <select id="t-select" class="select" onchange="loadCatalog()">
          <option value="">Todas as Raridades</option>
          <option value="MYTHIC">MYTHIC (1/1 Servidor)</option>
          <option value="LEGENDARY">LEGENDARY (Máx 3)</option>
          <option value="EPIC">EPIC (Máx 10)</option>
          <option value="RARE">RARE</option>
          <option value="COMMON">COMMON</option>
        </select>
      </div>
      <div id="catalog-grid" class="grid-cards"></div>
    </section>

    <!-- ABA 2: COMANDOS -->
    <section id="tab-commands" class="section">
      <div class="filter-bar">
        <input id="cmd-search" class="input" type="text" placeholder="Filtrar comando (ex: $wa, $ktower, $fc, $arena, $slot)..." oninput="renderCommands()" />
      </div>
      <div id="cmd-container" class="cmd-list"></div>
    </section>

    <!-- ABA 3: SIMULADOR DE TORRE -->
    <section id="tab-tower" class="section">
      <div class="stat-card" style="margin-bottom: 18px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;">
        <div>
          <div class="stat-lbl">Andares Selecionados: <strong id="tw-count" style="color:#fff">0 / 12</strong></div>
          <div class="stat-val" id="tw-cost">Custo Total: 0 Éter</div>
        </div>
        <button class="tab-btn active" onclick="resetTowerSim()">Resetar Simulação ($destroy)</button>
      </div>
      <div id="tower-grid" class="tower-grid"></div>
    </section>
  </main>

  <footer>
    Kogu Bot &bull; Ecossistema Koru Anime &bull; <a href="/terms">Termos de Serviço</a> &bull; <a href="/privacy">Política de Privacidade</a>
  </footer>

  <script>
    const COMMANDS = [
      { s: "$w / $h / $m", c: "Invocação", d: "Invoca uma carta feminina ($w), masculina ($h) ou mista ($m) de qualquer universo." },
      { s: "$wa / $wg / $wc", c: "Invocação", d: "Invoca uma carta feminina filtrada por Anime ($wa), Games ($wg) ou Cinema/Doramas/Idols ($wc)." },
      { s: "$ha / $hg / $hc", c: "Invocação", d: "Invoca uma carta masculina filtrada por Anime ($ha), Games ($hg) ou Cinema/Doramas/Idols ($hc)." },
      { s: "$tuto / $skiptuto", c: "Tutorial", d: "Inicia o guia interativo e concede +500 Éter, +5 Rolls e +1 Pacto Livre ($fc)." },
      { s: "$fc ($freeclaim)", c: "Progressão", d: "Zera imediatamente seu tempo de recarga de Pacto para casar uma segunda vez." },
      { s: "$rt", c: "Progressão", d: "Redefine o cooldown de Pacto (requer Relíquia de Esmeralda, 20h de recarga)." },
      { s: "$ktower ($tower)", c: "Economia", d: "Abre o Obelisco Dimensional com 12 andares de melhorias passivas." },
      { s: "$build <1-12> / $destroy", c: "Economia", d: "Constrói um andar na Torre de Éter ou demole tudo com 100% de reembolso." },
      { s: "$kl ($lootbox)", c: "Economia", d: "Abre Caixas Astrais (500 Éter) com chance de Rolls, Éter, Wishlist e cargas de $fc." },
      { s: "$relics / $daily", c: "Economia", d: "Forja Relíquias Elementais (Safira, Rubi, Esmeralda, Ouro, Diamante) e coleta bônus diário." },
      { s: "$givekakera @user <valor>", c: "Economia", d: "Transfere Cristais de Éter diretamente para outro jogador." },
      { s: "$infokeys", c: "Progressão", d: "Exibe os marcos de evolução das Chaves do Caos ao girar cartas repetidas." },
      { s: "$arena [@user]", c: "Combate & Jogos", d: "Duelo RPG em turnos usando ATK, DEF, SPD e HP das cartas do seu Panteão." },
      { s: "$slot ($pokemon)", c: "Combate & Jogos", d: "Gira o Cassino de Familiares elementais com chance de versão Shiny." },
      { s: "$bt ($blacktea) / $quiz", c: "Combate & Jogos", d: "Inicia o jogo da Bomba de Palavras ou Trivia Otaku/Geek valendo Éter." },
      { s: "$pt ($mm) / $im <nome>", c: "Coleção", d: "Exibe seu Panteão de cartas com filtros avançados ou inspeciona uma carta do catálogo." },
      { s: "$trade @user / $give / $divorce", c: "Coleção", d: "Troca segura de cartas, doação direta ou rompimento de pacto por Éter." },
      { s: "$wish ($wl) / $starwish ($sw)", c: "Wishlist", d: "Gerencia sua lista de desejos e define seu Desejo Estelar com bônus de spawn." },
      { s: "$settings / $prefix / $lang", c: "Configuração", d: "Painel interativo do servidor, alteração de prefixo e idioma (pt-BR / en-US)." }
    ];

    const PERKS = [
      { id: 1, title: "Andar 1 — Santuário dos Desejos", desc: "+2 vagas na Lista de Desejos ($wish)" },
      { id: 2, title: "Andar 2 — Ressonância Estelar", desc: "+50% de chance de aparição para seu $starwish" },
      { id: 3, title: "Andar 3 — Domínio de Bloqueio", desc: "+1 slot na $disablelist" },
      { id: 4, title: "Andar 4 — Dupla Chave do Caos", desc: "+10% de chance de ganhar 2 Chaves ao girar desejados" },
      { id: 5, title: "Andar 5 — Olho de Hórus", desc: "Revela +2 cristais ocultos nas coletas" },
      { id: 6, title: "Andar 6 — Colheita de Pacto", desc: "+30 Éter imediato sempre que firmar um Pacto" },
      { id: 7, title: "Andar 7 — Reservatório Astral", desc: "Capacidade máxima de poder de Éter sobe para 110%" },
      { id: 8, title: "Andar 8 — Canalização Eficiente", desc: "Reações de Éter consomem -4% de energia" },
      { id: 9, title: "Andar 9 — Benção das Chaves de Ouro", desc: "+500 Éter de limite por janela de 3 horas" },
      { id: 10, title: "Andar 10 — Prisma da Luz", desc: "Cristais Supremos concedem +1 cristal bônus" },
      { id: 11, title: "Andar 11 — Fenda Temporal", desc: "+1 Invocação ($wa/$ha) permanente por hora" },
      { id: 12, title: "Andar 12 — Soberania Cromática", desc: "Desbloqueia customização avançada de perfil e Panteão" }
    ];

    let selectedPerks = new Set();
    let timer = null;

    function switchTab(tab, btn) {
      document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.getElementById('tab-' + tab).classList.add('active');
      btn.classList.add('active');
    }

    function debouncedSearch() {
      clearTimeout(timer);
      timer = setTimeout(loadCatalog, 220);
    }

    async function loadCatalog() {
      const q = document.getElementById('q-input').value.trim();
      const u = document.getElementById('u-select').value;
      const t = document.getElementById('t-select').value;
      const res = await fetch('/api/catalog?q=' + encodeURIComponent(q) + '&universe=' + encodeURIComponent(u) + '&tier=' + encodeURIComponent(t));
      const data = await res.json();
      if (data.totalActive) {
        document.getElementById('stat-total').textContent = data.totalActive.toLocaleString('pt-BR');
      }
      const grid = document.getElementById('catalog-grid');
      grid.innerHTML = (data.items || []).map(item => \`
        <div class="char-card">
          <img class="char-img" src="\${item.imageUrl || ''}" alt="\${item.name}" loading="lazy" onerror="this.style.opacity=0.15" />
          <div class="char-body">
            <div>
              <div class="char-name">#\${item.popularityRank || '?'} \${item.name}</div>
              <div class="char-series">\${item.seriesTitle || item.universe}</div>
            </div>
            <div class="char-meta">
              <span class="tier-\${item.tier}">\${item.tier}\${item.tier === 'MYTHIC' ? ' 1/1' : ''}</span>
              <span>\${item.baseAether} Éter</span>
            </div>
          </div>
        </div>
      \`).join('');
    }

    function renderCommands() {
      const q = (document.getElementById('cmd-search').value || '').toLowerCase();
      const list = COMMANDS.filter(c => c.s.toLowerCase().includes(q) || c.d.toLowerCase().includes(q) || c.c.toLowerCase().includes(q));
      document.getElementById('cmd-container').innerHTML = list.map(c => \`
        <div class="cmd-item">
          <div>
            <div class="cmd-syntax">\${c.s}</div>
            <div style="color:var(--muted); font-size:0.88rem; margin-top:4px;">\${c.d}</div>
          </div>
          <span class="cmd-cat">\${c.c}</span>
        </div>
      \`).join('');
    }

    function renderTower() {
      const count = selectedPerks.size;
      let totalCost = 0;
      for (let i = 1; i <= count; i++) totalCost += i * 5000;
      document.getElementById('tw-count').textContent = count + ' / 12';
      document.getElementById('tw-cost').textContent = 'Custo Total: ' + totalCost.toLocaleString('pt-BR') + ' Éter';

      document.getElementById('tower-grid').innerHTML = PERKS.map(p => \`
        <div class="perk-box \${selectedPerks.has(p.id) ? 'selected' : ''}" onclick="togglePerk(\${p.id})">
          <div style="font-weight:700; color:#fff; margin-bottom:6px;">\${p.title}</div>
          <div style="font-size:0.86rem; color:var(--muted);">\${p.desc}</div>
        </div>
      \`).join('');
    }

    function togglePerk(id) {
      if (selectedPerks.has(id)) selectedPerks.delete(id);
      else selectedPerks.add(id);
      renderTower();
    }

    function resetTowerSim() {
      selectedPerks.clear();
      renderTower();
    }

    loadCatalog();
    renderCommands();
    renderTower();
  </script>
</body>
</html>`;

const LEGAL_STYLE = `
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #08080e; color: #e2e8f0; max-width: 840px; margin: 40px auto; padding: 24px; line-height: 1.7; }
  .card { background: #10111c; border: 1px solid #252842; border-radius: 12px; padding: 36px; }
  h1 { color: #fff; margin-top: 0; border-bottom: 1px solid #252842; padding-bottom: 14px; }
  h2 { color: #c4b5fd; margin-top: 24px; font-size: 1.15rem; }
  a { color: #38bdf8; text-decoration: none; }
  .nav { margin-bottom: 20px; font-size: 0.9rem; }
`;

const TERMS_HTML = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Termos de Serviço — Kogu</title><style>${LEGAL_STYLE}</style></head><body>
<div class="nav"><a href="/">&larr; Voltar ao Portal Kogu</a></div>
<div class="card">
<h1>Termos de Serviço — Kogu</h1>
<p><strong>Última atualização:</strong> Outubro de 2026</p>
<p>Bem-vindo ao <strong>Kogu</strong> (ecossistema <strong>Koru Anime</strong>), uma aplicação de entretenimento, colecionismo de cartas (gacha) e RPG para Discord. Ao adicionar o Kogu ao seu servidor ou utilizar seus comandos, você concorda com estes Termos de Serviço.</p>
<h2>1. Uso do Serviço</h2>
<ul>
  <li>O Kogu é fornecido gratuitamente para entretenimento nas comunidades do Discord, respeitando os <a href="https://discord.com/terms">Termos de Serviço do Discord</a> e as <a href="https://discord.com/guidelines">Diretrizes da Comunidade</a>.</li>
  <li>É proibido o uso de automação externa (macros, self-bots, scripts de auto-roll) para obter vantagem indevida em invocações, pactos, coleta de Éter ou minijogos.</li>
</ul>
<h2>2. Moedas e Itens Virtuais</h2>
<ul>
  <li>Todos os itens, cartas, familiares, níveis de Torre de Éter e saldos acumulados no Kogu são bens puramente virtuais sem valor monetário no mundo real.</li>
</ul>
<h2>3. Disponibilidade e Balanceamento</h2>
<ul>
  <li>A equipe do Kogu reserva-se o direito de ajustar taxas de raridade, tiragens limitadas e mecânicas a qualquer momento para manter o equilíbrio econômico dos servidores.</li>
</ul>
</div></body></html>`;

const PRIVACY_HTML = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Política de Privacidade — Kogu</title><style>${LEGAL_STYLE}</style></head><body>
<div class="nav"><a href="/">&larr; Voltar ao Portal Kogu</a></div>
<div class="card">
<h1>Política de Privacidade — Kogu</h1>
<p><strong>Última atualização:</strong> Outubro de 2026</p>
<p>Esta Política de Privacidade descreve como o bot <strong>Kogu</strong> (ecossistema <strong>Koru Anime</strong>) coleta, armazena e utiliza dados na plataforma Discord, em conformidade com a LGPD (Lei nº 13.709/2018).</p>
<h2>1. Dados Coletados</h2>
<ul>
  <li><strong>Identificadores Públicos (Snowflakes):</strong> <code>user_id</code>, <code>guild_id</code> e <code>channel_id</code>.</li>
  <li><strong>Progresso de Jogo:</strong> Cartas pactadas, lista de desejos, saldo de Éter, relíquias, andares da Torre de Éter e estatísticas de minijogos.</li>
</ul>
<h2>2. Conteúdo de Mensagens (Message Content Intent)</h2>
<ul>
  <li>O Kogu lê o conteúdo de mensagens exclusivamente em memória e em tempo real para processar comandos iniciados pelo prefixo configurado e respostas de minijogos ativos.</li>
  <li>Nenhum histórico de conversas é armazenado em banco de dados ou compartilhado com terceiros.</li>
</ul>
<h2>3. Exclusão de Dados</h2>
<ul>
  <li>Administradores e usuários podem solicitar a remoção integral de seus registros a qualquer momento através do servidor oficial de suporte.</li>
</ul>
</div></body></html>`;

function sendHtml(res: http.ServerResponse, html: string): void {
	res.writeHead(200, {
		"content-type": "text/html; charset=utf-8",
		"cache-control": "public, max-age=60",
	});
	res.end(html);
}

export async function handlePortalRoute(
	req: http.IncomingMessage,
	res: http.ServerResponse,
	deps: PortalQueryDeps
): Promise<boolean> {
	const rawUrl = req.url ?? "/";
	const urlObj = new URL(rawUrl, "http://localhost");
	const pathname = urlObj.pathname.toLowerCase();

	if (pathname === "/" || pathname === "/bot" || pathname === "/kogu") {
		sendHtml(res, PORTAL_HTML);
		return true;
	}

	if (pathname === "/terms" || pathname === "/bot/terms") {
		sendHtml(res, TERMS_HTML);
		return true;
	}

	if (pathname === "/privacy" || pathname === "/bot/privacy") {
		sendHtml(res, PRIVACY_HTML);
		return true;
	}

	if (pathname === "/api/catalog" && deps.searchCatalog) {
		try {
			const q = (urlObj.searchParams.get("q") ?? "").trim();
			const universe = (urlObj.searchParams.get("universe") ?? "").trim();
			const tier = (urlObj.searchParams.get("tier") ?? "").trim();
			const result = await deps.searchCatalog({ q, universe, tier, limit: 24 });
			const payload = JSON.stringify(result);
			res.writeHead(200, {
				"content-type": "application/json; charset=utf-8",
				"access-control-allow-origin": "*",
			});
			res.end(payload);
		} catch {
			res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
			res.end(JSON.stringify({ totalActive: 1372, items: [] }));
		}
		return true;
	}

	return false;
}
