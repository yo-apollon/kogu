"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

export interface PaginationProps {
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  className?: string;
}

/** Paginacao numerica (1-based): anterior, "Pagina X de Y", proxima. */
export function Pagination({ page, pageCount, onPageChange, className }: PaginationProps) {
  const t = useTranslations("pager");
  return (
    <nav aria-label={t("label")} className={cn("flex items-center justify-between gap-3", className)}>
      <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
        <ChevronLeft aria-hidden />
        {t("prev")}
      </Button>
      <span className="num text-sm text-muted" aria-live="polite">
        {t("page", { page, total: Math.max(1, pageCount) })}
      </span>
      <Button variant="outline" size="sm" disabled={page >= pageCount} onClick={() => onPageChange(page + 1)}>
        {t("next")}
        <ChevronRight aria-hidden />
      </Button>
    </nav>
  );
}

export interface CursorPagerProps {
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  /** Numero da pagina atual, se o chamador o rastreia (o cursor em si e opaco). */
  page?: number;
  pending?: boolean;
  className?: string;
}

/** Pager por cursor opaco: so anterior/proxima; quem chama guarda os cursores. */
export function CursorPager({ hasPrev, hasNext, onPrev, onNext, page, pending, className }: CursorPagerProps) {
  const t = useTranslations("pager");
  return (
    <nav aria-label={t("label")} aria-busy={pending || undefined} className={cn("flex items-center justify-between gap-3", className)}>
      <Button variant="outline" size="sm" disabled={!hasPrev || pending} onClick={onPrev}>
        <ChevronLeft aria-hidden />
        {t("prev")}
      </Button>
      {page ? <span className="num text-sm text-muted">{t("pageOnly", { page })}</span> : <span />}
      <Button variant="outline" size="sm" disabled={!hasNext || pending} onClick={onNext}>
        {t("next")}
        <ChevronRight aria-hidden />
      </Button>
    </nav>
  );
}
