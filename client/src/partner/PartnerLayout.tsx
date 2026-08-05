/**
 * Partner Portal — shared layout: navy topbar with the white LeadPrime logo,
 * simple nav (Panel / Documentos) and logout. Mobile-first.
 */
import { Link, useLocation } from "wouter";
import { Copy, FileText, LayoutDashboard, Link2, LogOut, Share2, UserPlus } from "lucide-react";
import { usePartnerAuth } from "./usePartnerAuth";
import { copyReferralLink, shareReferralLink } from "./lib/referral-share";

const NAV = [
  { path: "/", label: "Panel", icon: LayoutDashboard },
  { path: "/invitaciones", label: "Invitar", icon: UserPlus },
  { path: "/documentos", label: "Documentos", icon: FileText },
];

export default function PartnerLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { partner, logout } = usePartnerAuth();

  return (
    <div className="min-h-dvh flex flex-col">
      <header className="lp-topbar sticky top-0 z-40 shadow-md">
        <div className="mx-auto max-w-6xl px-4">
          <div className="h-16 flex items-center justify-between gap-3">
            <Link href="/" className="flex items-center shrink-0">
              <img src="/brand/leadprime-logo-white.png" alt="LeadPrime" className="h-9 w-auto" />
            </Link>

            <nav className="hidden sm:flex items-center gap-1">
              {NAV.map(item => {
                const active = location === item.path;
                return (
                  <Link
                    key={item.path}
                    href={item.path}
                    className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                      active ? "bg-white/15 text-white" : "text-white/70 hover:text-white hover:bg-white/10"
                    }`}
                  >
                    <item.icon className="w-4 h-4" />
                    {item.label}
                  </Link>
                );
              })}
            </nav>

            <div className="flex items-center gap-3 min-w-0">
              <div className="hidden md:block text-right min-w-0">
                <p className="text-sm text-white font-medium truncate max-w-[220px]">{partner?.name}</p>
                <p className="text-xs text-white/60 truncate max-w-[220px]">{partner?.contactEmail}</p>
              </div>
              <button
                onClick={logout}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-white/70 hover:text-white hover:bg-white/10 transition-colors"
                title="Cerrar sesión"
              >
                <LogOut className="w-4 h-4" />
                <span className="hidden sm:inline">Salir</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Mobile nav under the topbar */}
      <nav className="sm:hidden lp-topbar border-t border-white/10">
        <div className="flex">
          {NAV.map(item => {
            const active = location === item.path;
            return (
              <Link
                key={item.path}
                href={item.path}
                className={`flex-1 inline-flex items-center justify-center gap-2 py-2.5 text-sm font-medium ${
                  active ? "text-white border-b-2 border-[var(--lp-blue)]" : "text-white/60"
                }`}
              >
                <item.icon className="w-4 h-4" />
                {item.label}
              </Link>
            );
          })}
        </div>
      </nav>

      {/* Referral link — SIEMPRE a la mano, en todas las páginas del portal.
          Sticky bajo el topbar; en móvil es la vía principal para copiar o
          compartir el enlace sin buscarlo dentro del panel. */}
      {partner?.onboardingComplete && (partner.shortReferralLink || partner.referralLink) && (
        <div className="sticky top-16 z-30 bg-[var(--lp-blue)] text-white shadow-md">
          <div className="mx-auto max-w-6xl px-4 py-2 flex items-center gap-2">
            <Link2 className="w-4 h-4 shrink-0 opacity-90" aria-hidden />
            <span className="hidden sm:inline text-xs font-medium opacity-90 shrink-0">Tu enlace de referido:</span>
            <code className="flex-1 min-w-0 truncate text-sm font-semibold">
              {(partner.shortReferralLink || partner.referralLink).replace(/^https?:\/\//, "")}
            </code>
            <button
              onClick={() => copyReferralLink(partner.shortReferralLink || partner.referralLink)}
              className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-white/15 hover:bg-white/25 transition-colors shrink-0"
              aria-label="Copiar enlace de referido"
            >
              <Copy className="w-4 h-4" />
            </button>
            <button
              onClick={() => shareReferralLink(partner.shortReferralLink || partner.referralLink)}
              className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-white text-[var(--lp-blue)] hover:bg-white/90 transition-colors shrink-0"
              aria-label="Compartir enlace de referido"
            >
              <Share2 className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      <main className="flex-1">
        <div className="mx-auto max-w-6xl px-4 py-6 sm:py-8">{children}</div>
      </main>

      <footer className="py-6 text-center text-xs text-muted-foreground space-y-1">
        <p className="italic text-muted-foreground/80">El que no vive para servir, no sirve para vivir.</p>
        <p>Portal de Socios de LeadPrime · Comisiones sobre revenue efectivamente cobrado</p>
      </footer>
    </div>
  );
}
