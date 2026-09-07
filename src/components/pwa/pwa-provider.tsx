"use client";

import { Download, RefreshCw, Share2, WifiOff, X } from "lucide-react";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

type NavigatorWithPwaHints = Navigator & {
  standalone?: boolean;
  userAgentData?: { mobile?: boolean };
};

function isMobileInstallSurface(navigatorValue: NavigatorWithPwaHints) {
  const isIos = /iPad|iPhone|iPod/.test(navigatorValue.userAgent)
    || (navigatorValue.platform === "MacIntel" && navigatorValue.maxTouchPoints > 1);
  const isAndroid = /Android/i.test(navigatorValue.userAgent);
  return Boolean(navigatorValue.userAgentData?.mobile) || isIos || isAndroid;
}

type PwaContextValue = {
  canInstall: boolean;
  isStandalone: boolean;
  requestInstall: () => Promise<void>;
};

const PwaContext = createContext<PwaContextValue | null>(null);

export function PwaProvider({ children }: { children: React.ReactNode }) {
  const promptRef = useRef<InstallPromptEvent | null>(null);
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null);
  const reloadingRef = useRef(false);
  const [canInstall, setCanInstall] = useState(false);
  const [isIos, setIsIos] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [showIosHelp, setShowIosHelp] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const navigatorWithHints = navigator as NavigatorWithPwaHints;
    const ios = /iPad|iPhone|iPod/.test(navigatorWithHints.userAgent)
      || (navigatorWithHints.platform === "MacIntel" && navigatorWithHints.maxTouchPoints > 1);
    const mobileInstallSurface = isMobileInstallSurface(navigatorWithHints);
    const standalone = window.matchMedia("(display-mode: standalone)").matches
      || Boolean(navigatorWithHints.standalone);
    const initialStateTimer = window.setTimeout(() => {
      setIsIos(ios);
      setIsStandalone(standalone);
      setCanInstall(mobileInstallSurface && ios && !standalone);
      setOnline(navigator.onLine);
    }, 0);

    const handlePrompt = (event: Event) => {
      event.preventDefault();
      promptRef.current = event as InstallPromptEvent;
      setCanInstall(mobileInstallSurface && !standalone);
    };
    const handleInstalled = () => {
      promptRef.current = null;
      setCanInstall(false);
      setIsStandalone(true);
    };
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);

    window.addEventListener("beforeinstallprompt", handlePrompt);
    window.addEventListener("appinstalled", handleInstalled);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" })
        .then((registration) => {
          registrationRef.current = registration;
          if (registration.waiting && navigator.serviceWorker.controller) setUpdateAvailable(true);
          registration.addEventListener("updatefound", () => {
            const worker = registration.installing;
            worker?.addEventListener("statechange", () => {
              if (worker.state === "installed" && navigator.serviceWorker.controller) {
                setUpdateAvailable(true);
              }
            });
          });
        })
        .catch(() => undefined);

      const handleControllerChange = () => {
        if (reloadingRef.current) return;
        reloadingRef.current = true;
        window.location.reload();
      };
      navigator.serviceWorker.addEventListener("controllerchange", handleControllerChange);
      return () => {
        window.clearTimeout(initialStateTimer);
        window.removeEventListener("beforeinstallprompt", handlePrompt);
        window.removeEventListener("appinstalled", handleInstalled);
        window.removeEventListener("online", handleOnline);
        window.removeEventListener("offline", handleOffline);
        navigator.serviceWorker.removeEventListener("controllerchange", handleControllerChange);
      };
    }

    return () => {
      window.clearTimeout(initialStateTimer);
      window.removeEventListener("beforeinstallprompt", handlePrompt);
      window.removeEventListener("appinstalled", handleInstalled);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  const value = useMemo<PwaContextValue>(() => ({
    canInstall,
    isStandalone,
    requestInstall: async () => {
      if (isIos && !promptRef.current) {
        setShowIosHelp(true);
        return;
      }
      const prompt = promptRef.current;
      if (!prompt) return;
      await prompt.prompt();
      const choice = await prompt.userChoice;
      if (choice.outcome === "accepted") {
        promptRef.current = null;
        setCanInstall(false);
      }
    },
  }), [canInstall, isIos, isStandalone]);

  const applyUpdate = () => {
    const waiting = registrationRef.current?.waiting;
    if (waiting) waiting.postMessage({ type: "SKIP_WAITING" });
    else window.location.reload();
  };

  return (
    <PwaContext.Provider value={value}>
      {children}
      {!online ? (
        <div aria-live="assertive" className="pwa-network-banner" role="status">
          <WifiOff aria-hidden="true" size={18} />
          <span><strong>Sin conexión a Internet</strong><small>Verificá tu conexión antes de continuar.</small></span>
        </div>
      ) : null}
      {updateAvailable ? (
        <div aria-live="polite" className="pwa-update-toast" role="status">
          <RefreshCw aria-hidden="true" size={18} />
          <span><strong>Nueva versión disponible</strong><small>Actualizá para usar los últimos cambios.</small></span>
          <button className="button button-primary" onClick={applyUpdate} type="button">Actualizar</button>
        </div>
      ) : null}
      {showIosHelp ? (
        <div className="pwa-sheet-backdrop" onClick={() => setShowIosHelp(false)} role="presentation">
          <section aria-labelledby="pwa-ios-title" aria-modal="true" className="pwa-install-sheet" onClick={(event) => event.stopPropagation()} role="dialog">
            <button aria-label="Cerrar" className="icon-button pwa-sheet-close" onClick={() => setShowIosHelp(false)} type="button"><X size={18} /></button>
            <span className="pwa-sheet-icon"><Share2 aria-hidden="true" size={24} /></span>
            <h2 id="pwa-ios-title">Agregar a inicio</h2>
            <ol>
              <li>Tocá <strong>Compartir</strong> en Safari.</li>
              <li>Elegí <strong>Agregar a pantalla de inicio</strong>.</li>
              <li>Confirmá con <strong>Agregar</strong>.</li>
            </ol>
          </section>
        </div>
      ) : null}
    </PwaContext.Provider>
  );
}

export function PwaInstallButton({ compact = false }: { compact?: boolean }) {
  const context = useContext(PwaContext);
  if (!context || context.isStandalone || !context.canInstall) return null;
  return (
    <button
      aria-label="Instalar Morita Bebés"
      className={`button button-secondary pwa-install-button ${compact ? "is-compact" : ""}`}
      onClick={() => void context.requestInstall()}
      title="Instalar aplicación"
      type="button"
    >
      <Download aria-hidden="true" size={17} />
      {!compact ? <span>Instalar aplicación</span> : null}
    </button>
  );
}
