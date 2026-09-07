import { ArrowRight, BadgeCheck, HeartHandshake, PackageCheck, Store } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

import { HeroCarousel } from "@/components/store/hero-carousel";
import { ProductCard } from "@/components/store/product-card";
import { resolveStoreImage } from "@/lib/store/images";
import { getStoreContext, listStoreProducts } from "@/lib/store/queries";

export default async function StoreHomePage() {
  const [context, featured, newProducts] = await Promise.all([
    getStoreContext(),
    listStoreProducts({ limit: 8, sort: "featured", availability: "in_stock" }),
    listStoreProducts({ limit: 4, sort: "newest", availability: "in_stock" }),
  ]);
  const categories = [...context.categories].sort((left, right) => {
    if (left.is_featured_online === right.is_featured_online) return left.name.localeCompare(right.name, "es");
    return left.is_featured_online ? -1 : 1;
  });

  return (
    <>
      <HeroCarousel banners={context.banners} fallbackSubtitle={context.settings.homepage_message} fallbackTitle={context.settings.homepage_title} />
      <section className="store-benefits" aria-label="Beneficios de compra">
        <article><PackageCheck aria-hidden="true" /><span><strong>Stock real</strong><small>Disponibilidad sincronizada</small></span></article>
        <article><HeartHandshake aria-hidden="true" /><span><strong>Atención cercana</strong><small>Coordinamos por WhatsApp</small></span></article>
        <article><BadgeCheck aria-hidden="true" /><span><strong>Compra segura</strong><small>Tu pedido queda registrado</small></span></article>
      </section>

      <section className="store-section store-category-section">
        <div className="store-section-heading"><div><span>Elegí por categoría</span><h2>Todo lo que necesitan, más fácil de encontrar</h2></div><Link href="/tienda/productos">Ver catálogo <ArrowRight aria-hidden="true" /></Link></div>
        <div className="store-category-grid">
          {categories.map((category, index) => {
            const image = resolveStoreImage(category.image_path);
            return <Link className={`store-category-tile tone-${(index % 4) + 1}`} href={`/tienda/productos?categoria=${category.slug}`} key={category.id}>{image ? <Image alt="" fill sizes="(max-width: 640px) 50vw, (max-width: 1050px) 33vw, 16vw" src={image} /> : <span className="store-category-art"><Store aria-hidden="true" /></span>}<span className="store-category-label"><strong>{category.name}</strong><small>Explorar categoría</small></span></Link>;
          })}
        </div>
      </section>

      <section className="store-section">
        <div className="store-section-heading"><div><span>Elegidos por Morita</span><h2>Productos destacados</h2></div><Link href="/tienda/productos">Ver todos <ArrowRight aria-hidden="true" /></Link></div>
        <div className="store-product-grid">{featured.map((product, index) => <ProductCard index={index} key={product.id} product={product} />)}</div>
      </section>

      <section className="store-wholesale-band">
        <div><span>Para comercios</span><h2>Precios mayoristas para hacer crecer tu negocio</h2><p>Solicitá tu cuenta, accedé a precios especiales y armá pedidos desde $500.000 con el stock real de la pañalera.</p><Link className="store-light-button" href="/tienda/mayoristas"><span>Ir a tienda mayorista</span><ArrowRight aria-hidden="true" /></Link></div>
        <div className="store-wholesale-mark"><strong>$500.000</strong><span>mínimo mayorista</span></div>
      </section>

      {newProducts.length ? <section className="store-section">
        <div className="store-section-heading"><div><span>Recién llegados</span><h2>Nuevos ingresos</h2></div><Link href="/tienda/productos?orden=nuevos">Descubrir <ArrowRight aria-hidden="true" /></Link></div>
        <div className="store-product-grid">{newProducts.map((product, index) => <ProductCard index={index} key={product.id} product={product} />)}</div>
      </section> : null}
    </>
  );
}
