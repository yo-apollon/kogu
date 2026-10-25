"use client";

import Image from "next/image";
import { useTranslations } from "next-intl";
import { useState, type CSSProperties } from "react";
import { cn } from "@/lib/cn";
import { initials } from "@/components/ui/avatar";
import { normalizeTier, normalizeVariant } from "./constants";

export interface CardArtProps {
  /** URL da imagem; sem ela (ou com erro de carga) aparece o fallback com iniciais. */
  src?: string | null;
  name: string;
  tier?: string | null;
  variant?: string | null;
  sizes?: string;
  /** Primeiras cartas da pagina podem usar `eager`. */
  loading?: "lazy" | "eager";
  className?: string;
}

/**
 * Arte da carta em CSS puro (skin Mudae): sem texto sobre a arte. Estilos em src/styles/card.css.
 * `data-variant` e `data-tier` expostos para CSS e testes.
 */
export function CardArt({
  src,
  name,
  tier,
  variant,
  sizes = "(min-width: 1024px) 180px, (min-width: 640px) 25vw, 45vw",
  loading = "lazy",
  className,
}: CardArtProps) {
  const t = useTranslations("card");
  const [failed, setFailed] = useState(false);
  const tierKey = normalizeTier(tier);
  const variantKey = normalizeVariant(variant);
  const showImage = Boolean(src) && !failed;

  return (
    <div
      className={cn("card-art", className)}
      data-variant={variantKey}
      data-tier={tierKey}
      data-fallback={showImage ? undefined : "true"}
      style={{ "--card-tier": `var(--tier-${tierKey})` } as CSSProperties}
    >
      <div className="card-art__frame">
        {showImage && src ? (
          <Image
            src={src}
            alt={t("alt", { name })}
            fill
            sizes={sizes}
            unoptimized
            loading={loading}
            className="card-art__img"
            onError={() => setFailed(true)}
          />
        ) : (
          <div className="card-art__fallback" role="img" aria-label={t("alt", { name })}>
            {initials(name)}
          </div>
        )}
        <span className="card-art__ring" aria-hidden />
      </div>
    </div>
  );
}
