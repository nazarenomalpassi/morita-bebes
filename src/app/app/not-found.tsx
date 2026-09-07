import { ArrowLeft, SearchX } from "lucide-react";
import Link from "next/link";

export default function ManagementNotFound() {
  return (
    <div className="page-container permission-state">
      <SearchX size={30} />
      <h1>No encontramos ese registro</h1>
      <p>Puede haber sido eliminado o no estar disponible para tu organización.</p>
      <Link className="button button-secondary" href="/app"><ArrowLeft size={17} /> Volver al resumen</Link>
    </div>
  );
}

