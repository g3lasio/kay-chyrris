/**
 * Partner Portal — dashboard (brief §7.2): KPIs, free-account progress,
 * referral link, sanitized referrals table and payout history.
 * The whole page is locked behind the 4-step onboarding.
 */
import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Copy,
  DollarSign,
  Gift,
  Link2,
  Loader2,
  MessageCircle,
  MessageSquare,
  PartyPopper,
  Share2,
  TrendingUp,
  Users,
  Wallet,
  X,
} from "lucide-react";
import PartnerLayout from "../PartnerLayout";
import OnboardingChecklist from "../components/OnboardingChecklist";
import { usePartnerAuth } from "../usePartnerAuth";
import {
  canNativeShare,
  shareReferralLink,
  smsShareUrl,
  whatsappShareUrl,
} from "../lib/referral-share";

/**
 * The welcome moment: shown the first time the dashboard unlocks, i.e. right
 * after the third onboarding stage closes. It mirrors the email that goes out
 * at the same instant. Dismissed per partner in localStorage — the celebration
 * is for arriving, and it shouldn't nag on every visit afterwards.
 */
function WelcomeBanner() {
  const { partner } = usePartnerAuth();
  const storageKey = partner ? `lp_partner_welcome_seen_${partner.id}` : null;
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    if (!storageKey) return;
    try {
      setDismissed(localStorage.getItem(storageKey) === "1");
    } catch {
      setDismissed(false); // storage blocked (private mode) — still show it once
    }
  }, [storageKey]);

  if (!partner || dismissed) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      if (storageKey) localStorage.setItem(storageKey, "1");
    } catch {
      /* nothing to persist — banner just returns on the next load */
    }
  };

  return (
    <Card className="border-[var(--lp-green)]/40 bg-gradient-to-br from-[var(--lp-green)]/10 to-transparent">
      <CardContent className="pt-6 relative">
        <button
          onClick={dismiss}
          aria-label="Cerrar bienvenida"
          className="absolute top-3 right-3 text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
        <div className="flex flex-col sm:flex-row gap-4 sm:items-start pr-6">
          <div className="w-11 h-11 rounded-xl bg-[var(--lp-green)] flex items-center justify-center shrink-0">
            <PartyPopper className="w-5 h-5 text-white" />
          </div>
          <div className="space-y-3 min-w-0">
            <div>
              <h2 className="text-lg font-bold text-foreground">
                ¡Bienvenido, {partner.contactName || partner.name}!
              </h2>
              <p className="text-sm text-muted-foreground">
                Tu registro está completo y ya eres socio activo de LeadPrime. Te enviamos los
                detalles a tu correo.
              </p>
            </div>
            <blockquote className="border-l-4 border-[var(--lp-gold,#C79A45)] pl-3 py-1">
              <p className="text-sm italic text-foreground">
                El que no vive para servir, no sirve para vivir.
              </p>
            </blockquote>
            <p className="text-sm text-muted-foreground">
              Eso es lo que empieza hoy. Cada contratista que llegue por tu recomendación es alguien
              a quien le abres una puerta. La comisión es la consecuencia, no el objetivo —{" "}
              <span className="text-foreground font-medium">
                sirve bien y lo demás llega solo.
              </span>
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function money(value: string | number): string {
  const n = typeof value === "number" ? value : parseFloat(value || "0");
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function shortDate(value: string | Date): string {
  return new Date(value).toLocaleDateString("es-MX", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function StatusChip({ status }: { status: string }) {
  if (status === "active") return <span className="lp-chip-green text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap">Activo</span>;
  if (status === "pending_first_payment")
    return <span className="lp-chip-blue text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap">Pendiente 1er pago</span>;
  return <span className="lp-chip-muted text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap">Inactivo</span>;
}

function StageChip({ stage, pct }: { stage: string | null; pct: string | null }) {
  if (!stage) return <span className="text-muted-foreground text-xs">—</span>;
  return (
    <span className={`${stage === "year1" ? "lp-chip-gold" : "lp-chip-muted"} text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap`}>
      {stage === "year1" ? "Año 1" : "Año 2"} · {parseFloat(pct ?? "0")}%
    </span>
  );
}

function KpiCard({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <Card>
      <CardContent className="pt-5 pb-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs uppercase tracking-wide text-muted-foreground min-w-0">{label}</p>
          <div className="w-8 h-8 rounded-xl bg-accent flex items-center justify-center shrink-0">
            <Icon className="w-4 h-4 text-primary" />
          </div>
        </div>
        <p className="text-xl sm:text-2xl font-bold text-foreground mt-1 whitespace-nowrap">{value}</p>
        {hint && <p className="text-xs text-muted-foreground mt-1">{hint}</p>}
      </CardContent>
    </Card>
  );
}

export default function PartnerDashboard() {
  const onboardingQuery = trpc.partnerPortal.onboarding.useQuery();
  const complete = onboardingQuery.data?.complete ?? false;

  return (
    <PartnerLayout>
      {onboardingQuery.isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      ) : !complete ? (
        <OnboardingChecklist />
      ) : (
        <DashboardContent />
      )}
    </PartnerLayout>
  );
}

function DashboardContent() {
  const dashboardQuery = trpc.partnerPortal.dashboard.useQuery();
  const referralsQuery = trpc.partnerPortal.referrals.useQuery();
  const payoutsQuery = trpc.partnerPortal.payouts.useQuery();
  const incomeQuery = trpc.partnerPortal.monthlyIncome.useQuery();

  const data = dashboardQuery.data;
  if (dashboardQuery.isLoading || !data) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const copyLink = async (link: string) => {
    try {
      await navigator.clipboard.writeText(link);
      toast.success("Enlace copiado");
    } catch {
      toast.error("No se pudo copiar. Selecciona el texto manualmente.");
    }
  };

  const freePct = Math.min(
    100,
    Math.round((data.freeAccount.current / Math.max(1, data.freeAccount.threshold)) * 100)
  );
  const referrals = referralsQuery.data ?? [];
  const payouts = payoutsQuery.data ?? [];
  const income = incomeQuery.data ?? [];
  const hasIncome = income.some(pt => parseFloat(pt.amount) !== 0);

  return (
    <div className="space-y-6">
      <WelcomeBanner />

      {/* Referral link — LO PRIMERO del panel: es la herramienta de trabajo
          del socio y en móvil debe estar a la mano sin buscarla. */}
      <Card className="border-primary/30">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Link2 className="w-5 h-5 text-primary" /> Tu enlace de referido
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Compártelo donde quieras (bio de TikTok, Instagram, WhatsApp). Cada contratista que se
            registre con él queda atribuido a ti (código <strong>{data.referralCode}</strong>).
          </p>
          <div className="flex gap-2">
            <code className="flex-1 min-w-0 truncate text-sm bg-muted rounded-lg px-3 py-2.5 border font-medium self-stretch flex items-center">
              {data.shortReferralLink}
            </code>
            <Button
              onClick={() => copyLink(data.shortReferralLink)}
              size="sm"
              variant="outline"
              className="shrink-0 h-11"
              aria-label="Copiar enlace"
            >
              <Copy className="w-4 h-4 sm:mr-2" />
              <span className="hidden sm:inline">Copiar</span>
            </Button>
            <Button
              onClick={() => shareReferralLink(data.shortReferralLink)}
              size="sm"
              className="shrink-0 h-11"
              aria-label="Compartir enlace"
            >
              <Share2 className="w-4 h-4 sm:mr-2" />
              <span className="hidden sm:inline">Compartir</span>
            </Button>
          </div>
          {!canNativeShare() && (
            <div className="flex flex-wrap gap-2">
              <Button asChild size="sm" variant="outline" className="h-9">
                <a href={whatsappShareUrl(data.shortReferralLink)} target="_blank" rel="noreferrer">
                  <MessageCircle className="w-4 h-4 mr-1.5" /> WhatsApp
                </a>
              </Button>
              <Button asChild size="sm" variant="outline" className="h-9">
                <a href={smsShareUrl(data.shortReferralLink)}>
                  <MessageSquare className="w-4 h-4 mr-1.5" /> SMS
                </a>
              </Button>
            </div>
          )}
          {/* Long form kept as a fallback */}
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer hover:text-foreground">Ver enlace largo</summary>
            <div className="flex gap-2 mt-2">
              <code className="flex-1 min-w-0 truncate bg-muted rounded-lg px-3 py-2 border">
                {data.referralLink}
              </code>
              <Button onClick={() => copyLink(data.referralLink)} size="sm" variant="outline" className="shrink-0 h-auto">
                <Copy className="w-4 h-4" />
              </Button>
            </div>
          </details>
        </CardContent>
      </Card>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <KpiCard icon={Users} label="Referidos totales" value={String(data.kpis.totalReferrals)} />
        <KpiCard
          icon={TrendingUp}
          label="Activos y pagando"
          value={String(data.kpis.activePaying)}
          hint={`${data.kpis.pendingFirstPayment} pendientes de 1er pago`}
        />
        <KpiCard icon={DollarSign} label="Comisión este mes" value={money(data.kpis.commissionThisMonth)} />
        <KpiCard
          icon={Wallet}
          label="Acumulado del año"
          value={money(data.kpis.commissionYtd)}
          hint={`Por liquidar: ${money(data.kpis.pendingBalance)}`}
        />
      </div>

      {/* Free account progress */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Gift className="w-5 h-5 text-[var(--lp-gold)]" /> Cuenta LeadPrime gratis
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {data.freeAccount.achieved
              ? "¡Meta alcanzada! Tu cuenta gratis está desbloqueada."
              : `${data.freeAccount.current} de ${data.freeAccount.threshold} referidos activos para desbloquear tu cuenta gratis.`}
          </p>
          <Progress value={freePct} className="h-2.5" />
          <p className="text-xs text-muted-foreground text-right">{freePct}%</p>
        </CardContent>
      </Card>

      {/* Referrals table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Tus referidos</CardTitle>
        </CardHeader>
        <CardContent>
          {referralsQuery.isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
            </div>
          ) : referrals.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              Aún no tienes referidos. Comparte tu enlace para empezar a generar comisiones.
            </p>
          ) : (
            <>
              {/* Desktop */}
              <div className="hidden md:block overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Negocio</TableHead>
                      <TableHead>Inicio</TableHead>
                      <TableHead>Estado</TableHead>
                      <TableHead>Etapa</TableHead>
                      <TableHead>Plan / costo</TableHead>
                      <TableHead>1ª comisión (est.)</TableHead>
                      <TableHead className="text-right">Comisión (mes)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {referrals.map(r => (
                      <TableRow key={r.attributionId}>
                        <TableCell className="font-medium">{r.business}</TableCell>
                        <TableCell className="text-muted-foreground">{shortDate(r.signupDate)}</TableCell>
                        <TableCell><StatusChip status={r.status} /></TableCell>
                        <TableCell><StageChip stage={r.stage} pct={r.stagePct} /></TableCell>
                        <TableCell className="text-muted-foreground">
                          {r.plan ?? "—"}
                          {r.planCost ? <span className="text-xs"> · {money(r.planCost)}/mes</span> : null}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {r.status === "active" ? (
                            <span className="lp-chip-green text-xs px-2 py-0.5 rounded-full">Generando</span>
                          ) : r.estimatedCommissionStart ? (
                            <span title="Estimado por el ciclo ACH (~30-40 días)">
                              ~{shortDate(r.estimatedCommissionStart)}
                            </span>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                        <TableCell className="text-right font-medium">{money(r.commissionThisMonth)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {/* Mobile cards */}
              <div className="md:hidden space-y-3">
                {referrals.map(r => (
                  <div key={r.attributionId} className="border rounded-xl p-3 space-y-2 bg-card">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium text-sm truncate">{r.business}</p>
                      <StatusChip status={r.status} />
                    </div>
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>Inicio: {shortDate(r.signupDate)}</span>
                      <StageChip stage={r.stage} pct={r.stagePct} />
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">
                        {r.plan ?? "Sin plan"}
                        {r.planCost ? ` · ${money(r.planCost)}/mes` : ""}
                      </span>
                      <span className="font-semibold">{money(r.commissionThisMonth)} / mes</span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {r.status === "active"
                        ? "Generando comisión"
                        : r.estimatedCommissionStart
                          ? `1ª comisión estimada ~${shortDate(r.estimatedCommissionStart)}`
                          : ""}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Monthly income history */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <TrendingUp className="w-5 h-5 text-primary" /> Historial de ingresos por referidos
          </CardTitle>
        </CardHeader>
        <CardContent>
          {incomeQuery.isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
            </div>
          ) : !hasIncome ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              Cuando tus referidos empiecen a pagar, aquí verás cómo crece tu ingreso recurrente mes a mes.
            </p>
          ) : (
            <div className="h-56 -ml-2">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={income.map(pt => ({ ...pt, value: parseFloat(pt.amount) }))}>
                  <defs>
                    <linearGradient id="lpIncome" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--lp-blue)" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="var(--lp-blue)" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={54} tickFormatter={v => `$${v}`} />
                  <RTooltip
                    formatter={(v: any) => [money(v), "Comisión"]}
                    contentStyle={{ borderRadius: 10, border: "1px solid var(--border)", fontSize: 12 }}
                  />
                  <Area type="monotone" dataKey="value" stroke="var(--lp-blue)" strokeWidth={2} fill="url(#lpIncome)" isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Payout history */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Historial de liquidaciones</CardTitle>
        </CardHeader>
        <CardContent>
          {payoutsQuery.isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
            </div>
          ) : payouts.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              Todavía no hay liquidaciones. Se generan mensualmente sobre tus comisiones pendientes.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Periodo</TableHead>
                    <TableHead className="text-right">Monto</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead className="hidden sm:table-cell">Pagado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payouts.map(p => (
                    <TableRow key={p.id}>
                      <TableCell className="whitespace-nowrap text-sm">
                        {shortDate(p.periodStart)} – {shortDate(p.periodEnd)}
                      </TableCell>
                      <TableCell className="text-right font-medium">{money(p.totalAmount)}</TableCell>
                      <TableCell>
                        {p.status === "paid" ? (
                          <span className="lp-chip-green text-xs font-medium px-2 py-0.5 rounded-full">Pagado</span>
                        ) : (
                          <span className="lp-chip-blue text-xs font-medium px-2 py-0.5 rounded-full">Pendiente</span>
                        )}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell text-muted-foreground text-sm">
                        {p.paidAt ? shortDate(p.paidAt) : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
