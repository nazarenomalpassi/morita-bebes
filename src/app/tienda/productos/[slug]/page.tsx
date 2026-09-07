import type { Metadata } from "next";
import { ArrowLeft, BadgeCheck, PackageCheck, Truck } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ProductCard } from "@/components/store/product-card";
import { ProductDetailActions } from "@/components/store/product-detail-actions";
import { ProductMedia } from "@/components/store/product-media";
import { ars, quantity } from "@/lib/format";
import { resolveStoreImage } from "@/lib/store/images";
import { listStoreProducts } from "@/lib/store/queries";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { STORE_ORGANIZATION_SLUG } from "@/lib/store/types";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const supabase = await createServerSupabaseClient();
  const [product, metadataResult] = await Promise.all([
    listStoreProducts({ slug, limit: 1 }).then((products) => products[0]),
    supabase.rpc("get_store_product_metadata", { p_organization_slug: STORE_ORGANIZATION_SLUG, p_product_slug: slug }).maybeSingle(),
  ]);
  if (!product) return { title: "Producto no encontrado" };
  const publicMetadata = metadataResult.data;
  return {
    title: publicMetadata?.seo_title || product.name,
    description: publicMetadata?.seo_description || product.description?.slice(0, 160) || `${product.name} en Morita Bebés. Stock y precio actualizados.`,
    alternates: { canonical: `/tienda/productos/${product.slug}` },
    openGraph: { title: product.name, description: product.description ?? undefined, images: product.cover_image_path ? [resolveStoreImage(product.cover_image_path)!] : ["/store/hero-morita.webp"] },
  };
}

export default async function StoreProductPage({ params }: Props) {
  const { slug } = await params;
  const product = (await listStoreProducts({ slug, limit: 1 }))[0];
  if (!product) notFound();
  const supabase = await createServerSupabaseClient();
  const [{ data: images }, related] = await Promise.all([
    supabase.from("product_images").select("id, storage_path, alt_text, is_primary, sort_order").eq("product_id", product.id).order("is_primary", { ascending: false }).order("sort_order"),
    product.category_slug ? listStoreProducts({ category: product.category_slug, limit: 5, availability: "in_stock" }) : Promise.resolve([]),
  ]);
  const gallery = images?.length ? images : product.cover_image_path ? [{ id: "cover", storage_path: product.cover_image_path, alt_text: product.name, is_primary: true, sort_order: 0 }] : [];
  const stock = Number(product.current_stock);

  return (
    <div className="store-product-page store-page">
      <Link className="store-back-link" href="/tienda/productos"><ArrowLeft aria-hidden="true" /> Volver al catálogo</Link>
      <div className="store-product-detail">
        <div className="store-product-gallery">
          <div className="store-product-gallery-main">{gallery[0] ? <Image alt={gallery[0].alt_text || product.name} fill priority sizes="(max-width: 800px) 100vw, 52vw" src={resolveStoreImage(gallery[0].storage_path)!} /> : <ProductMedia alt={product.name} categorySlug={product.category_slug} imagePath={null} priority />}</div>
          {gallery.length > 1 ? <div className="store-product-thumbnails">{gallery.map((image) => <div key={image.id}><Image alt={image.alt_text || product.name} fill sizes="90px" src={resolveStoreImage(image.storage_path)!} /></div>)}</div> : null}
        </div>
        <div className="store-product-info">
          <span className="store-product-eyebrow">{product.brand_name ?? product.category_name ?? "Morita Bebés"}</span>
          <h1>{product.name}</h1>
          {product.category_name ? <Link className="store-category-pill" href={`/tienda/productos?categoria=${product.category_slug}`}>{product.category_name}</Link> : null}
          <div className="store-product-detail-price">{product.display_price === null ? "Consultar precio" : ars.format(Number(product.display_price))}<small>{product.price_kind === "wholesale" ? "Precio mayorista aprobado" : "Precio minorista"}</small></div>
          <div className={`store-stock-line ${stock > 0 ? "is-available" : "is-empty"}`}><span />{stock > 0 ? `${quantity.format(stock)} ${product.unit} disponibles` : "Sin stock"}</div>
          {product.price_kind === "wholesale" && Number(product.minimum_quantity) > 1 ? <p className="store-minimum-note">Compra mínima de este producto: {quantity.format(Number(product.minimum_quantity))} {product.unit}.</p> : null}
          <ProductDetailActions product={product} />
          {product.description ? <div className="store-product-description"><h2>Sobre este producto</h2><p>{product.description}</p></div> : null}
          <div className="store-product-assurances"><div><PackageCheck aria-hidden="true" /><span><strong>Stock sincronizado</strong><small>Disponibilidad del local en tiempo real</small></span></div><div><Truck aria-hidden="true" /><span><strong>Entrega coordinada</strong><small>Retiro o envío acordado por WhatsApp</small></span></div><div><BadgeCheck aria-hidden="true" /><span><strong>Pedido registrado</strong><small>Confirmación segura desde Morita Bebés</small></span></div></div>
        </div>
      </div>
      {related.filter((item) => item.id !== product.id).length ? <section className="store-related"><div className="store-section-heading"><div><span>También te puede gustar</span><h2>Productos relacionados</h2></div></div><div className="store-product-grid">{related.filter((item) => item.id !== product.id).slice(0, 4).map((item) => <ProductCard key={item.id} product={item} />)}</div></section> : null}
    </div>
  );
}
