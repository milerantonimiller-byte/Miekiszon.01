import React, { useState } from "react";
import { Download, Smartphone, X } from "lucide-react";
import { usePWAInstall } from "../hooks/usePWAInstall";

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  const handleClick = async () => {
    if (isInstallable) {
      await install();
    } else {
      setShowGuide(true);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        className="inline-flex min-h-[40px] items-center gap-2 rounded-lg bg-emerald-500 px-3.5 py-2 text-xs font-semibold text-black transition-colors hover:bg-emerald-400 whitespace-nowrap shrink-0 cursor-pointer"
        title="Zainstaluj aplikację Miękiszon na telefonie Android lub iOS"
      >
        <Download className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Zainstaluj aplikację</span>
        <span className="sm:hidden">Instaluj</span>
      </button>

      {showGuide && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pwa-guide-title"
        >
          <div className="w-full max-w-md rounded-2xl border border-[#222824] bg-[#0D0F0E] p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-400">
                  <Smartphone className="h-5 w-5" />
                </div>
                <h3
                  id="pwa-guide-title"
                  className="font-display text-lg font-semibold text-white"
                >
                  Instalacja na Android / Telefonie
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-neutral-400 hover:bg-neutral-800 hover:text-white cursor-pointer"
                aria-label="Zamknij"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {isIOS ? (
              <ol className="mt-4 space-y-2.5 text-sm leading-relaxed text-neutral-300">
                <li>1. Otwórz tę stronę w przeglądarce Safari na iPhone lub iPad.</li>
                <li>
                  2. Dotknij ikony <strong className="text-white">Udostępnij</strong> na dolnym pasku.
                </li>
                <li>
                  3. Wybierz <strong className="text-white">Dodaj do ekranu początkowego</strong>.
                </li>
              </ol>
            ) : (
              <ol className="mt-4 space-y-2.5 text-sm leading-relaxed text-neutral-300">
                <li>1. Otwórz aplikację w Google Chrome na telefonie z systemem Android.</li>
                <li>
                  2. Dotknij menu <strong className="text-white">⋮</strong> w prawym górnym rogu przeglądarki.
                </li>
                <li>
                  3. Wybierz <strong className="text-white">Zainstaluj aplikację</strong> lub{" "}
                  <strong className="text-white">Dodaj do ekranu głównego</strong> — Miękiszon pojawi się jako natywna aplikacja z ikoną ogórka.
                </li>
              </ol>
            )}

            <button
              type="button"
              onClick={() => setShowGuide(false)}
              className="mt-6 w-full min-h-[44px] rounded-xl bg-emerald-500 py-2.5 text-sm font-semibold text-black hover:bg-emerald-400 transition-colors cursor-pointer"
            >
              Rozumiem
            </button>
          </div>
        </div>
      )}
    </>
  );
};
