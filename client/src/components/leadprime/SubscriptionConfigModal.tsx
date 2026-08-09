/**
 * SubscriptionConfigModal — EL modal de suscripción de LeadPrime, compartido.
 *
 * Antes vivía duplicado: inline en Users Intelligence y re-implementado en la
 * página de Suscripciones. Ahora es uno solo:
 *   - Con `user` fijo (desde la fila de la tabla de Usuarios) muestra directo
 *     el estado + formulario.
 *   - Sin `user` (desde el botón "Asignar suscripción") muestra primero el
 *     UserPicker (dropdown + buscador).
 *
 * Escribe la INTENCIÓN vía leadprime.setSubscriptionConfig; el worker de
 * LeadPrime la aplica en ~5 min por la puerta única applyTierChange.
 */
import { useState, useEffect } from 'react';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { CreditCard, Check, CheckCheck, Copy, History, Loader2, X } from 'lucide-react';
import { UserPicker, type PickedUser } from './UserPicker';

function fmtDate(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('es-MX', { month: 'short', day: 'numeric', year: 'numeric' });
}

function subBadge(status: string | null) {
  if (!status) return <span className="text-xs text-muted-foreground px-2 py-0.5 rounded-full bg-gray-500/10">none</span>;
  const c: Record<string, string> = {
    active: 'bg-green-500/20 text-green-300 border border-green-500/30',
    trialing: 'bg-amber-500/20 text-amber-300 border border-amber-500/30',
    canceled: 'bg-red-500/20 text-red-300 border border-red-500/30',
    past_due: 'bg-orange-500/20 text-orange-300 border border-orange-500/30',
  };
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${c[status] ?? 'bg-gray-500/20 text-gray-300'}`}>{status}</span>;
}

export function SubscriptionConfigModal({ user, balanceDollars, onClose }: {
  /** Cuenta fija; null → mostrar el UserPicker primero. */
  user: { id: string; name: string } | null;
  /** Balance de wallet para mostrar en el resumen (si se conoce). */
  balanceDollars?: string;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<PickedUser | null>(null);
  const target = user ?? (picked ? { id: picked.id, name: picked.businessName ?? picked.name } : null);

  const [targetTier, setTargetTier] = useState<'network_elite' | 'chyrris_growth' | 'chyrris_legacy'>('network_elite');
  // 'stripe' = tarjeta; 'stripe_ach' = ACH por Stripe; 'external_zelle' = manual;
  // 'comp_no_charge' = cortesía. Los tres primeros cuentan como MRR, el último no.
  const [billingMode, setBillingMode] = useState<'stripe' | 'stripe_ach' | 'comp_no_charge' | 'external_zelle'>('comp_no_charge');
  const [creditsCents, setCreditsCents] = useState('');
  // Precio mensual acordado (en dólares, para capturar). Los tiers gestionados
  // se negocian caso por caso, así que el importe real puede diferir del
  // catálogo; es lo que cuenta como MRR cuando el pago entra por fuera.
  const [priceDollars, setPriceDollars] = useState('');
  const [enableLegacy, setEnableLegacy] = useState(false);
  const [contractEnd, setContractEnd] = useState('');
  const [onContractEnd, setOnContractEnd] = useState<'downgrade_to_elite' | 'cancel'>('downgrade_to_elite');
  const [showLog, setShowLog] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);

  const utils = trpc.useUtils();
  const configQuery = trpc.leadprime.getSubscriptionConfig.useQuery(
    { contractorId: target?.id ?? '' },
    { enabled: !!target, staleTime: 0 },
  );
  const tierLogQuery = trpc.leadprime.getTierChangeLog.useQuery(
    { contractorId: target?.id ?? '' },
    { enabled: !!target && showLog, staleTime: 0 },
  );

  // Prellenar el formulario con la config existente al cargar.
  useEffect(() => {
    if (target && configQuery.data) {
      const d = configQuery.data;
      if (d.targetTier) setTargetTier(d.targetTier as any);
      if (d.billingMode) setBillingMode(d.billingMode as any);
      setCreditsCents(d.monthlyCreditsCents != null ? String(d.monthlyCreditsCents) : '');
      setPriceDollars(d.monthlyPriceCents ? (d.monthlyPriceCents / 100).toFixed(2) : '');
      setEnableLegacy(d.enableLegacyProjects);
      setContractEnd(d.contractEndAt ? d.contractEndAt.slice(0, 10) : '');
      setOnContractEnd((d.onContractEnd as any) ?? 'downgrade_to_elite');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.id, configQuery.data]);

  const setConfig = trpc.leadprime.setSubscriptionConfig.useMutation({
    onSuccess: (data: any) => {
      utils.leadprime.getSubscriptionConfig.invalidate({ contractorId: target?.id ?? '' });
      utils.leadprime.getEnrichedUsers.invalidate();
      utils.leadprime.getUsers.invalidate();

      // La intención se ejecuta al instante en LeadPrime: mostrar el resultado
      // REAL en vez de un "se aplicará en 5 minutos" que no garantiza nada.
      const applied = data?.applied;
      if (!applied) {
        toast.warning(
          data?.applyError
            ? `Guardado, pero no se pudo ejecutar ahora (${data.applyError}). El worker reintentará en ≤5 min.`
            : 'Guardado. El worker lo aplicará en los próximos 5 min.'
        );
        onClose();
        return;
      }
      if (applied.outcome === 'applied') {
        toast.success(
          `✅ Plan ${applied.tier} ACTIVO${applied.creditsGrantedCents ? ` · $${(applied.creditsGrantedCents / 100).toFixed(2)} en créditos otorgados` : ''}`
        );
        onClose();
      } else if (applied.outcome === 'checkout_created' || applied.outcome === 'waiting') {
        // No cerrar: el admin necesita copiar el link de cobro ACH.
        toast.success('Link de cobro ACH listo — cópialo y envíaselo al contratista');
      } else {
        toast.error(`No se pudo aplicar: ${applied.error ?? 'error desconocido'}`);
      }
    },
    onError: (e) => toast.error(e.message),
  });

  function handleSave() {
    if (!target) return;
    const creds = creditsCents !== ''
      ? Math.min(Math.max(0, parseInt(creditsCents, 10) || 0), 120000)
      : null;
    const priceCents = priceDollars.trim() !== ''
      ? Math.max(0, Math.round(parseFloat(priceDollars) * 100))
      : null;
    setConfig.mutate({
      contractorId: target.id,
      targetTier,
      billingMode,
      monthlyCreditsCents: creds,
      monthlyPriceCents: Number.isFinite(priceCents as number) ? priceCents : null,
      enableLegacyProjects: enableLegacy,
      contractEndAt: contractEnd ? new Date(contractEnd).toISOString() : null,
      onContractEnd,
    });
  }

  const d = configQuery.data;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-background border border-border rounded-xl p-6 w-full max-w-lg space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold flex items-center gap-2">
            <CreditCard className="h-4 w-4 text-violet-400" />
            Suscripción{target ? ` — ${target.name}` : ''}
          </h2>
          <button onClick={onClose}><X className="h-4 w-4" /></button>
        </div>

        {!user && (
          <UserPicker selected={picked} onSelect={setPicked} />
        )}

        {target && (configQuery.isLoading ? (
          <div className="py-6 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : (
          <>
            {/* ── Estado actual (solo lectura) ─────────────────────────────── */}
            <div className="rounded-lg border border-border p-3 text-sm space-y-1.5">
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Estado actual</div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Plan</span>
                <span className="font-medium">{d?.planName ?? '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Servicio</span>
                <span>{d?.serviceLevel ?? '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Cómo paga</span>
                <span className={d?.billingMode === 'external_zelle' ? 'text-violet-300 font-medium' : ''}>
                  {d?.billingMode === 'external_zelle'
                    ? `Zelle / transferencia${d?.monthlyPriceCents ? ` · $${(d.monthlyPriceCents / 100).toFixed(2)}/mes` : ''}`
                    : d?.billingMode === 'stripe_ach'
                      ? `ACH (Stripe)${d?.monthlyPriceCents ? ` · $${(d.monthlyPriceCents / 100).toFixed(2)}/mes` : ''}`
                      : d?.billingMode === 'comp_no_charge'
                        ? 'Cortesía (sin cargo)'
                        : '—'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Sub status</span>
                {subBadge(d?.subStatus ?? null)}
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Legacy Projects</span>
                <span>{d?.legacyRealEstate ? '✅ activo' : '—'}</span>
              </div>
              {balanceDollars != null && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Balance</span>
                  <span className="font-mono">${balanceDollars}</span>
                </div>
              )}
              {d?.status && (
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Config status</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    d.status === 'applied' ? 'bg-green-500/20 text-green-300 border border-green-500/30' :
                    d.status === 'pending' ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' :
                    'bg-red-500/20 text-red-300 border border-red-500/30'
                  }`}>{d.status}</span>
                </div>
              )}
              {d?.status === 'error' && d.lastError && (
                <div className="text-xs text-red-400 mt-1 break-all">{d.lastError}</div>
              )}
              {d?.billingMode === 'stripe_ach' && d.checkoutUrl && (
                <div className="mt-2 pt-2 border-t border-border">
                  <div className="text-xs text-muted-foreground mb-1">Link ACH (enviar al contratista)</div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-primary truncate flex-1">{d.checkoutUrl}</span>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(d.checkoutUrl!);
                        setCopiedUrl(true);
                        setTimeout(() => setCopiedUrl(false), 2000);
                      }}
                      className="p-1 rounded hover:bg-accent transition-colors shrink-0"
                      title="Copiar URL"
                    >
                      {copiedUrl ? <CheckCheck className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5 text-muted-foreground" />}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* ── Historial de cobros ──────────────────────────────────────── */}
            {((d?.invoices?.length ?? 0) > 0 || (d?.achHolds?.length ?? 0) > 0) && (
              <div className="rounded-lg border border-border p-3 text-xs space-y-2">
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Historial de cobros</div>
                {d?.invoices?.slice(0, 5).map((inv, i) => (
                  <div key={i} className="flex justify-between items-center">
                    <span className="text-muted-foreground">{fmtDate(inv.createdAt)}</span>
                    <span className="font-mono">${(inv.amountPaid / 100).toFixed(2)}</span>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                      inv.status === 'paid' ? 'bg-green-500/20 text-green-300' :
                      inv.status === 'open' ? 'bg-amber-500/20 text-amber-300' :
                      'bg-gray-500/20 text-gray-400'
                    }`}>{inv.status}</span>
                  </div>
                ))}
                {d?.achHolds?.slice(0, 5).map((h, i) => (
                  <div key={`h${i}`} className="flex justify-between items-center">
                    <span className="text-muted-foreground">ACH hold</span>
                    <span className="font-mono">${(h.amountCents / 100).toFixed(2)}</span>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                      h.status === 'cleared' ? 'bg-green-500/20 text-green-300' :
                      h.status === 'paused' ? 'bg-red-500/20 text-red-300' :
                      'bg-amber-500/20 text-amber-300'
                    }`}>{h.status}{h.retryCount > 0 ? ` (x${h.retryCount})` : ''}</span>
                  </div>
                ))}
              </div>
            )}

            {/* ── Asignar plan ─────────────────────────────────────────────── */}
            <div className="space-y-3">
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Asignar plan</div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Tier</Label>
                  <select
                    value={targetTier}
                    onChange={e => setTargetTier(e.target.value as any)}
                    className="mt-1 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
                  >
                    <option value="network_elite">Elite</option>
                    <option value="chyrris_growth">Growth</option>
                    <option value="chyrris_legacy">Legacy</option>
                  </select>
                </div>
                <div>
                  <Label className="text-xs">Forma de pago</Label>
                  <select
                    value={billingMode}
                    onChange={e => setBillingMode(e.target.value as any)}
                    className="mt-1 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
                  >
                    {/* Las cuatro categorías que decide el MRR. Cortesía NUNCA
                        cuenta como ingreso, por caro que sea el plan. */}
                    <option value="stripe">Stripe (tarjeta) — cuenta como MRR</option>
                    <option value="stripe_ach">ACH (cobra Stripe) — cuenta como MRR</option>
                    <option value="external_zelle">Zelle / transferencia — cuenta como MRR</option>
                    <option value="comp_no_charge">Cortesía (sin cargo) — NO cuenta</option>
                  </select>
                </div>
              </div>

              {/* Qué implica cada forma de pago — la diferencia es contable, no
                  funcional: el usuario recibe el mismo plan en los tres casos. */}
              <p className="text-xs text-muted-foreground -mt-1">
                {billingMode === 'stripe'
                  ? 'Cobro automático con tarjeta. Cuenta como ingreso (MRR).'
                  : billingMode === 'stripe_ach'
                    ? 'Se genera un link de cobro ACH; el plan se activa cuando el contratista paga. Cuenta como ingreso (MRR).'
                    : billingMode === 'external_zelle'
                      ? '✅ Activación inmediata con todos los beneficios y créditos del plan. Cuenta como ingreso real (MRR), igual que ACH — solo cambia por dónde entra el dinero.'
                      : '⚠️ Activación inmediata sin cargo. NUNCA cuenta como ingreso: ni en MRR ni en ARR, por caro que sea el plan. Aparece aparte como valor regalado.'}
              </p>

              {/* Precio acordado — obligatorio de facto en pagos externos:
                  es el importe que se sumará al MRR. */}
              {billingMode !== 'comp_no_charge' && (
                <div>
                  <Label className="text-xs">
                    Precio mensual acordado (USD)
                    {billingMode === 'external_zelle' && <span className="text-violet-400"> — es lo que suma al MRR</span>}
                  </Label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="Vacío = precio del catálogo del plan"
                    value={priceDollars}
                    onChange={e => setPriceDollars(e.target.value)}
                    className="mt-1 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
                  />
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Los planes gestionados se negocian caso por caso; captura aquí el monto real acordado.
                  </p>
                </div>
              )}

              {/* Créditos: para cortesía y para pago externo el worker los otorga
                  al activar. Vacío = los del catálogo del plan, que es lo
                  normal — este campo es solo para un override puntual. */}
              {(billingMode === 'comp_no_charge' || billingMode === 'external_zelle') && (
                <div>
                  <Label className="text-xs">Créditos mensuales (cents, máx $1,200 = 120000)</Label>
                  <input
                    type="number"
                    min="0"
                    max="120000"
                    step="100"
                    placeholder="Dejar vacío = catálogo"
                    value={creditsCents}
                    onChange={e => setCreditsCents(e.target.value)}
                    className="mt-1 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
                  />
                  <p className="text-xs text-muted-foreground mt-0.5">Vacío = usa los créditos del catálogo del plan</p>
                </div>
              )}

              {(targetTier === 'chyrris_growth' || targetTier === 'chyrris_legacy') && (
                <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={enableLegacy}
                    onChange={e => setEnableLegacy(e.target.checked)}
                    className="h-4 w-4 accent-violet-500"
                  />
                  Habilitar Legacy Projects (mes 6)
                </label>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Fin de contrato</Label>
                  <input
                    type="date"
                    value={contractEnd}
                    onChange={e => setContractEnd(e.target.value)}
                    className="mt-1 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <Label className="text-xs">Al vencer</Label>
                  <select
                    value={onContractEnd}
                    onChange={e => setOnContractEnd(e.target.value as any)}
                    className="mt-1 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
                  >
                    <option value="downgrade_to_elite">Pasar a Elite</option>
                    <option value="cancel">Cancelar</option>
                  </select>
                </div>
              </div>

              {billingMode === 'stripe_ach' && !d?.checkoutUrl && (
                <p className="text-xs text-muted-foreground">
                  El link de cobro ACH aparecerá aquí cuando el worker lo genere.
                </p>
              )}
            </div>

            {/* ── Historial de cambios de tier ─────────────────────────────── */}
            <button
              onClick={() => setShowLog(v => !v)}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <History className="h-3.5 w-3.5" />
              {showLog ? 'Ocultar' : 'Ver'} historial de cambios de tier
            </button>
            {showLog && (
              <div className="rounded-lg border border-border p-3 text-xs space-y-1.5 max-h-40 overflow-y-auto">
                {tierLogQuery.isLoading ? (
                  <div className="flex justify-center py-2"><Loader2 className="h-4 w-4 animate-spin" /></div>
                ) : (tierLogQuery.data?.data?.length ?? 0) === 0 ? (
                  <div className="text-muted-foreground">Sin cambios registrados</div>
                ) : (
                  tierLogQuery.data?.data?.map((entry: any) => (
                    <div key={entry.id} className="flex items-center gap-2">
                      <span className="text-muted-foreground shrink-0">{fmtDate(entry.createdAt)}</span>
                      <span className="text-amber-300">{entry.fromTier ?? 'none'}</span>
                      <span className="text-muted-foreground">→</span>
                      <span className="text-green-300">{entry.toTier}</span>
                      {entry.reason && <span className="text-muted-foreground truncate">{entry.reason}</span>}
                    </div>
                  ))
                )}
              </div>
            )}
          </>
        ))}

        {/* ── Acciones ─────────────────────────────────────────────────────── */}
        <div className="flex gap-2 justify-end pt-1">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button
            disabled={setConfig.isPending || !target}
            className="bg-violet-600 hover:bg-violet-700 text-white"
            onClick={handleSave}
          >
            {setConfig.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4 mr-1" />} Guardar
          </Button>
        </div>
      </div>
    </div>
  );
}
