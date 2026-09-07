import Link from "next/link";

export default function ProductNotFound() {
  return <div className="store-page store-empty-state"><h1>Este producto no está disponible</h1><p>Puede haberse despublicado o cambiado su disponibilidad.</p><Link className="store-primary-button" href="/tienda/productos">Volver al catálogo</Link></div>;
}
