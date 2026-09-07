import Image from "next/image";
import Link from "next/link";

export default function OfflinePage() {
  return (
    <main className="offline-page">
      <section className="offline-panel">
        <Image alt="Morita Bebés" height={112} priority src="/icons/morita-192.png" width={112} />
        <span className="eyebrow">Conexión interrumpida</span>
        <h1>Estás sin conexión</h1>
        <p>El sistema necesita Internet para consultar Supabase y registrar operaciones de forma segura.</p>
        <Link className="button button-primary" href="/app">Intentar nuevamente</Link>
      </section>
    </main>
  );
}
