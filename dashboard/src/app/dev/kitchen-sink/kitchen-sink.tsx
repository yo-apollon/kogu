"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { Gem, Plus } from "lucide-react";
import { useState } from "react";
import { BarSeries } from "@/components/charts/bar-series";
import { LineAreaChart } from "@/components/charts/line-area-chart";
import { Sparkline } from "@/components/charts/sparkline";
import { CardArt } from "@/components/card/card-art";
import { CardGrid } from "@/components/card/card-grid";
import { GenderGlyph } from "@/components/card/gender-glyph";
import { TierBadge } from "@/components/card/tier-badge";
import { VariantBadge } from "@/components/card/variant-badge";
import { TIERS, VARIANTS } from "@/components/card/constants";
import { DataTable } from "@/components/data/data-table";
import { FilterBar } from "@/components/data/filter-bar";
import { CursorPager, Pagination } from "@/components/data/pagination";
import { Kpi, KpiGrid } from "@/components/data/kpi";
import { ProgressBar } from "@/components/data/progress-bar";
import { Stat } from "@/components/data/stat";
import { AppShell } from "@/components/layout/app-shell";
import { PageHeader } from "@/components/layout/page-header";
import { Section } from "@/components/layout/section";
import { Badge, StateBadge, STATES } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Select } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip } from "@/components/ui/tooltip";
import { formatAether, formatNumber } from "@/lib/format";

/** Retrato ficticio (SVG em data URI, permitido pela CSP). */
function portrait(hue: number): string {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='480' height='750' viewBox='0 0 480 750'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='hsl(${hue} 40% 62%)'/><stop offset='1' stop-color='hsl(${(hue + 50) % 360} 45% 30%)'/></linearGradient></defs><rect width='480' height='750' fill='url(#g)'/><circle cx='240' cy='250' r='95' fill='hsl(${hue} 30% 88%)' opacity='.85'/><path d='M60 750 C70 520 190 450 240 450 C290 450 410 520 420 750Z' fill='hsl(${hue} 30% 88%)' opacity='.85'/></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

interface Row {
  id: string;
  name: string;
  franchise: string;
  tier: string;
  variant: string;
  aether: number;
  claimedAt: number;
}

const ROWS: Row[] = Array.from({ length: 24 }, (_, i) => ({
  id: String(i),
  name: ["Killua Zoldyck", "Frieren", "Gojo Satoru", "Rem", "Asuka", "Levi Ackerman"][i % 6] ?? "",
  franchise: ["Hunter x Hunter", "Sousou no Frieren", "Jujutsu Kaisen", "Re:Zero", "Evangelion", "Shingeki no Kyojin"][i % 6] ?? "",
  tier: TIERS[i % 5] ?? "common",
  variant: VARIANTS[i % 4] ?? "standard",
  aether: 1200 + i * 937,
  claimedAt: Date.now() - i * 3_600_000,
}));

const COLUMNS: ColumnDef<Row, unknown>[] = [
  { accessorKey: "name", header: "Nome", cell: (c) => <span className="font-medium">{String(c.getValue())}</span> },
  { accessorKey: "franchise", header: "Série" },
  { accessorKey: "tier", header: "Tier", enableSorting: false, cell: (c) => <TierBadge tier={String(c.getValue())} /> },
  { accessorKey: "variant", header: "Variante", enableSorting: false, cell: (c) => <VariantBadge variant={String(c.getValue())} /> },
  { accessorKey: "aether", header: "Éter", meta: { numeric: true }, cell: (c) => formatAether(Number(c.getValue()), "pt-BR") },
];

const SPARK = [4, 6, 5, 9, 8, 12, 11, 15, 14, 18];
const SERIES = Array.from({ length: 30 }, (_, i) => ({ label: `D${i + 1}`, value: 40 + Math.round(Math.sin(i / 3) * 18 + i * 1.4) }));

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Section title={title}>
      {children}
    </Section>
  );
}

export function KitchenSink() {
  const [checked, setChecked] = useState(true);
  const [sel, setSel] = useState("a");
  const [resetAt] = useState(() => Date.now() + 23 * 60_000);
  const [loadingTable, setLoadingTable] = useState(false);
  return (
    <AppShell
      pathname="/g/123/pantheon"
      guilds={[
        { id: "123", name: "Servidor de Teste", icon: null, canManage: true },
        { id: "456", name: "Outro Servidor", icon: null, canManage: false },
      ]}
      user={{ name: "Apollon", handle: "@apollon" }}
      stats={{ aether: 48210, rollsLeft: 7, rollsMax: 10, rollsResetAt: resetAt }}
    >
      <PageHeader
        title="Kitchen sink"
        description="Vitrine de componentes do design system. Só existe fora de produção."
        actions={
          <Button size="sm">
            <Plus aria-hidden /> Ação
          </Button>
        }
        tabs={[
          { href: "#cards", label: "Cartas", active: true },
          { href: "#ui", label: "Interface" },
          { href: "#dados", label: "Dados" },
        ]}
      />

      <div id="cards">
        <Block title="CardArt: 4 variantes">
          <div className="grid grid-cols-2 gap-6 lg:grid-cols-4">
            {VARIANTS.map((v, i) => (
              <figure key={v} className="m-0 grid gap-2">
                <CardArt src={portrait(200 + i * 40)} name={`Entidade ${v}`} tier={TIERS[i + 1]} variant={v} />
                <figcaption className="flex flex-wrap gap-1.5">
                  <TierBadge tier={TIERS[i + 1]} />
                  <VariantBadge variant={v} />
                </figcaption>
              </figure>
            ))}
          </div>
        </Block>
        <Block title="Sem imagem (fallback por tier)">
          <CardGrid>
            {TIERS.map((t) => (
              <li key={t}>
                <CardArt name="Killua Zoldyck" tier={t} variant="standard" />
              </li>
            ))}
          </CardGrid>
        </Block>
      </div>

      <div id="ui">
        <Block title="Botões, campos e controles">
          <div className="flex flex-wrap items-center gap-2">
            <Button>Primário</Button>
            <Button variant="secondary">Secundário</Button>
            <Button variant="outline">Contorno</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="destructive">Destrutivo</Button>
            <Button disabled>Desativado</Button>
          </div>
          <div className="grid max-w-xl gap-3 sm:grid-cols-2">
            <Input placeholder="Campo de texto" aria-label="Campo de texto" />
            <Select
              aria-label="Seleção"
              value={sel}
              onValueChange={setSel}
              options={[
                { value: "a", label: "Opção A" },
                { value: "b", label: "Opção B" },
              ]}
            />
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={checked} onCheckedChange={setChecked} /> Interruptor
            </label>
            <p className="text-sm text-muted">
              Atalho <Kbd>Ctrl</Kbd> + <Kbd>K</Kbd>, comando <Kbd>$summon</Kbd>
            </p>
          </div>
        </Block>

        <Block title="Badges">
          <div className="flex flex-wrap gap-2">
            {TIERS.map((t) => (
              <TierBadge key={t} tier={t} />
            ))}
            {VARIANTS.map((v) => (
              <VariantBadge key={v} variant={v} />
            ))}
            {STATES.map((s) => (
              <StateBadge key={s} state={s} />
            ))}
            <Badge>Neutro</Badge>
            <GenderGlyph gender="FEMALE" />
            <GenderGlyph gender="MALE" />
          </div>
        </Block>

        <Block title="Sobreposições">
          <div className="flex flex-wrap items-center gap-2">
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="outline">Dialog</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Confirmar ação</DialogTitle>
                  <DialogDescription>Descrição curta do que vai acontecer.</DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <Button variant="outline">Cancelar</Button>
                  <Button>Confirmar</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="outline">Sheet</Button>
              </SheetTrigger>
              <SheetContent side="right" className="gap-2 p-5">
                <SheetTitle className="text-lg font-semibold">Painel lateral</SheetTitle>
                <SheetDescription className="text-sm text-muted">Conteúdo secundário.</SheetDescription>
              </SheetContent>
            </Sheet>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline">Menu</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem>Primeira</DropdownMenuItem>
                <DropdownMenuItem>Segunda</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Tooltip content="Dica rápida">
              <Button variant="ghost" size="icon" aria-label="Dica">
                <Gem aria-hidden />
              </Button>
            </Tooltip>
          </div>
          <Tabs defaultValue="um">
            <TabsList>
              <TabsTrigger value="um">Um</TabsTrigger>
              <TabsTrigger value="dois">Dois</TabsTrigger>
            </TabsList>
            <TabsContent value="um" className="text-sm text-muted">
              Conteúdo da aba um.
            </TabsContent>
            <TabsContent value="dois" className="text-sm text-muted">
              Conteúdo da aba dois.
            </TabsContent>
          </Tabs>
        </Block>

        <Block title="Estados">
          <div className="grid gap-4 md:grid-cols-3">
            <EmptyState title="Panteão vazio" description="Você ainda não tem entidades neste servidor." command="$summon" />
            <ErrorState onRetry={() => {}} digest="a1b2c3" />
            <Card className="grid gap-2 p-4">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
            </Card>
          </div>
          <Separator />
        </Block>
      </div>

      <div id="dados">
        <Block title="KPIs, gráficos e progresso">
          <KpiGrid>
            <Kpi label="Éter total" value={formatNumber(48210)} delta={0.12} deltaText="+12%" spark={SPARK} hint="vs. 30 dias" />
            <Kpi label="Pactos" value="132" delta={-0.04} deltaText="-4%" spark={[9, 8, 8, 7, 8, 6, 7, 5]} />
            <Kpi label="Invocações" value="1.284" delta={0} deltaText="0%" />
            <Kpi label="Membros ativos" value="58" hint="últimos 7 dias" />
          </KpiGrid>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Éter por dia</CardTitle>
                  <CardDescription>BarSeries (SVG próprio)</CardDescription>
                </div>
                <Sparkline data={SPARK} label="Tendência de éter" />
              </CardHeader>
              <CardContent>
                <BarSeries data={SERIES.slice(0, 20)} label="Éter por dia, últimos 20 dias" formatValue={(v) => formatNumber(v)} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Atividade</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4">
                <LineAreaChart data={SERIES} label="Atividade nos últimos 30 dias" height={160} />
                <ProgressBar value={7} max={10} label="Invocações usadas" showValue />
                <dl className="m-0 grid gap-1">
                  <Stat label="Saldo" value={formatAether(48210, "pt-BR")} />
                  <Stat label="Pactos" value="132" />
                </dl>
              </CardContent>
            </Card>
          </div>
        </Block>

        <Block title="Filtros, tabela (lista no mobile) e paginação">
          <FilterBar
            searchPlaceholder="Buscar entidade…"
            filters={[
              { key: "tier", label: "Tier", options: TIERS.map((t) => ({ value: t, label: t })) },
              { key: "variant", label: "Variante", options: VARIANTS.map((v) => ({ value: v, label: v })) },
            ]}
          />
          <DataTable columns={COLUMNS} data={ROWS} getRowId={(r) => r.id} aria-label="Entidades de exemplo" loading={loadingTable} maxHeight="22rem" />
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => setLoadingTable((v) => !v)}>
              Alternar loading
            </Button>
          </div>
          <Pagination page={2} pageCount={6} onPageChange={() => {}} />
          <CursorPager hasPrev hasNext onPrev={() => {}} onNext={() => {}} page={3} />
        </Block>
      </div>
    </AppShell>
  );
}
