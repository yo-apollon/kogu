import { SearchX } from "lucide-react";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

export default async function NotFound() {
  const t = await getTranslations("error");
  return (
    <EmptyState
      icon={SearchX}
      title={t("notFoundTitle")}
      description={t("notFoundDescription")}
      action={
        <Link href="/" className={buttonVariants({ variant: "outline", size: "sm" })}>
          {t("back")}
        </Link>
      }
    />
  );
}
