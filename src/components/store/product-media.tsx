import Image from "next/image";
import { Baby } from "lucide-react";

import { productPlaceholderTone, resolveStoreImage } from "@/lib/store/images";

export function ProductMedia({
  alt,
  categorySlug,
  imagePath,
  priority = false,
}: {
  alt: string;
  categorySlug?: string | null;
  imagePath?: string | null;
  priority?: boolean;
}) {
  const src = resolveStoreImage(imagePath);
  if (!src) {
    return <span className={`store-product-placeholder store-product-placeholder-${productPlaceholderTone(categorySlug)}`}><Baby aria-hidden="true" size={42} /><small>Foto próximamente</small></span>;
  }
  return <Image alt={alt} fill priority={priority} sizes="(max-width: 640px) 50vw, (max-width: 1100px) 33vw, 25vw" src={src} />;
}
