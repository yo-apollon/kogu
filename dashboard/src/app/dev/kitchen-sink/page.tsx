import { notFound } from "next/navigation";
import { KitchenSink } from "./kitchen-sink";

export const metadata = { title: "Kitchen sink", robots: { index: false } };

/** Vitrine de componentes: so existe fora de producao. */
export default function KitchenSinkPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <KitchenSink />;
}
