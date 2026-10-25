"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";
import { DialogOverlay } from "./dialog";

export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;
export const SheetTitle = DialogPrimitive.Title;
export const SheetDescription = DialogPrimitive.Description;

type Side = "left" | "right" | "bottom";

const SIDES: Record<Side, string> = {
  left: "ui-sheet-left inset-y-0 left-0 w-72 max-w-[85vw] border-r",
  right: "ui-sheet-right inset-y-0 right-0 w-80 max-w-[90vw] border-l",
  bottom: "ui-sheet-bottom inset-x-0 bottom-0 max-h-[85vh] border-t",
};

export function SheetContent({
  side = "left",
  className,
  children,
  ...props
}: ComponentProps<typeof DialogPrimitive.Content> & { side?: Side }) {
  const t = useTranslations("common");
  return (
    <DialogPrimitive.Portal>
      <DialogOverlay />
      <DialogPrimitive.Content
        className={cn("fixed z-50 flex flex-col border-border bg-surface text-fg", SIDES[side], className)}
        {...props}
      >
        {children}
        <DialogPrimitive.Close
          aria-label={t("close")}
          className="absolute top-3 right-3 inline-flex size-8 items-center justify-center rounded-md text-subtle hover:bg-surface-2 hover:text-fg"
        >
          <X className="size-4" aria-hidden />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
