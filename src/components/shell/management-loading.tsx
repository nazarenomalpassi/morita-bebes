import { Heart, Moon, Star } from "lucide-react";
import Image from "next/image";

import "./management-loading.css";

export function ManagementLoadingScreen({ fullScreen = false }: { fullScreen?: boolean }) {
  return (
    <div className={`management-loading${fullScreen ? " management-loading-fullscreen" : ""}`}>
      <div className="management-loading-content" role="status" aria-live="polite" aria-atomic="true">
        <div className="management-loading-art" aria-hidden="true">
          <span className="management-loading-charm management-loading-moon"><Moon size={22} strokeWidth={1.6} /></span>
          <span className="management-loading-charm management-loading-star"><Star size={18} strokeWidth={1.6} /></span>
          <Image className="management-loading-logo" src="/icons/morita-192.png" alt="" width={104} height={104} loading="eager" unoptimized />
          <span className="management-loading-charm management-loading-heart"><Heart size={18} strokeWidth={1.6} /></span>
        </div>
        <p className="management-loading-brand">morita bebés</p>
        <p className="management-loading-label">{fullScreen ? "Preparando tu espacio" : "Cargando tu sección"}</p>
        <div className="management-loading-track" aria-hidden="true"><span /></div>
      </div>
    </div>
  );
}
