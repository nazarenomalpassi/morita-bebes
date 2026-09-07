import type { CartItem, CartSnapshot } from "./types";

export function reconcileCartItems(items: CartItem[], products: CartSnapshot[]) {
  const byId = new Map(products.map((product) => [product.id, product]));
  return items.map((item) => {
    const product = byId.get(item.productId);
    if (!product) return { ...item, available: false, issue: "Este producto ya no está publicado." };
    const stock = Number(product.current_stock);
    const minimumQuantity = Math.max(1, Number(product.minimum_quantity ?? 1));
    const price = product.display_price === null ? null : Number(product.display_price);
    const available = product.is_available
      && stock > 0
      && price !== null
      && (product.price_kind !== "wholesale" || product.wholesale_available)
      && stock >= minimumQuantity;
    const issue = !product.is_available
      ? "Este producto ya no está publicado."
      : stock <= 0
        ? "Este producto quedó sin stock."
        : price === null || (product.price_kind === "wholesale" && !product.wholesale_available)
          ? "Este producto requiere consultar el precio."
          : stock < minimumQuantity
            ? `El stock disponible no alcanza el mínimo de ${minimumQuantity}.`
            : undefined;
    return {
      ...item,
      slug: product.slug,
      name: product.name,
      imagePath: product.cover_image_path,
      price,
      priceKind: product.price_kind,
      minimumQuantity,
      stock,
      unit: product.unit,
      quantity: stock > 0 ? Math.min(Math.max(item.quantity, minimumQuantity), stock) : item.quantity,
      available,
      issue,
    };
  });
}
