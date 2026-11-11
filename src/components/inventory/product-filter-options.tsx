"use client";

import { Filter } from "lucide-react";
import { useId, useState } from "react";
import { useMediaQuery } from "@/lib/ui/use-media-query";

export function ProductFilterOptions({ children, active }: { children: React.ReactNode; active: boolean }) {
  const mobile = useMediaQuery("(max-width: 640px)");
  const [open, setOpen] = useState(false);
  const id = useId();
  return <div className="product-filter-options">{mobile ? <button aria-controls={id} aria-expanded={open} className="button button-secondary" onClick={() => setOpen((current) => !current)} type="button"><Filter size={16} /> Filtros{active ? " aplicados" : ""}</button> : null}<div className="product-filter-options-grid" hidden={mobile && !open} id={id}>{children}</div></div>;
}
