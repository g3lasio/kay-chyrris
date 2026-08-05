/**
 * Partner Portal — invite referrals (consent model, brief §5).
 * The partner enters ONE graduate email; LeadPrime emails them a personalized
 * signup link carrying the partner's attribution. The graduate registers
 * themselves (consent). The partner tracks each invitation's status here.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { Copy, Link2, Loader2, Mail, MessageCircle, MessageSquare, Share2, ShieldCheck, UserPlus } from "lucide-react";
import PartnerLayout from "../PartnerLayout";
import { usePartnerAuth } from "../usePartnerAuth";
import {
  canNativeShare,
  copyReferralLink,
  referralShareMessage,
  shareReferralLink,
  smsShareUrl,
  whatsappShareUrl,
} from "../lib/referral-share";

function statusChip(status: string) {
  const map: Record<string, { label: string; cls: string }> = {
    pending_approval: { label: "En revisión", cls: "lp-chip-muted" },
    sent: { label: "Enviada", cls: "lp-chip-blue" },
    registered: { label: "Registrada", cls: "lp-chip-gold" },
    active: { label: "Activa", cls: "lp-chip-green" },
    declined: { label: "Rechazada", cls: "lp-chip-muted" },
  };
  const cfg = map[status] ?? map.sent!;
  return <span className={`${cfg.cls} text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap`}>{cfg.label}</span>;
}

function shortDate(value: string | Date | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("es-MX", { year: "numeric", month: "short", day: "numeric" });
}

export default function PartnerInvitations() {
  const utils = trpc.useUtils();
  const { partner } = usePartnerAuth();
  const invitationsQuery = trpc.partnerPortal.invitations.useQuery();
  const createInvitation = trpc.partnerPortal.createInvitation.useMutation();
  const [email, setEmail] = useState("");
  const shareLink = partner?.shortReferralLink || partner?.referralLink || "";

  const invitations = invitationsQuery.data ?? [];

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const value = email.trim().toLowerCase();
    if (!value) return;
    try {
      const res = await createInvitation.mutateAsync({ email: value });
      toast.success(
        res.status === "pending_approval"
          ? "Invitación enviada a revisión de LeadPrime"
          : "¡Invitación enviada!"
      );
      setEmail("");
      await utils.partnerPortal.invitations.invalidate();
    } catch (error: any) {
      toast.error(error.message || "No se pudo enviar la invitación");
    }
  };

  return (
    <PartnerLayout>
      <div className="space-y-6 max-w-3xl">
        <div>
          <h1 className="text-xl font-bold">Invita a tus graduados</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Comparte tu enlace por el medio que prefieras, o escribe el correo de tu graduado y le
            enviamos la invitación por ti. La atribución queda a tu nombre en cuanto se registra.
          </p>
        </div>

        {/* The partner's own link, share-first: native share sheet on phones
            (WhatsApp/SMS/whatever they use) with a friendly ready-made message;
            explicit WhatsApp/SMS buttons where there is no share sheet. */}
        {shareLink && (
          <Card className="border-primary/30">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Link2 className="w-5 h-5 text-primary" /> Comparte tu enlace
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2">
                <code className="flex-1 min-w-0 truncate text-sm bg-muted rounded-lg px-3 py-2.5 border font-medium self-stretch flex items-center">
                  {shareLink.replace(/^https?:\/\//, "")}
                </code>
                <Button
                  onClick={() => copyReferralLink(shareLink)}
                  size="sm"
                  variant="outline"
                  className="shrink-0 h-11"
                  aria-label="Copiar enlace"
                >
                  <Copy className="w-4 h-4 sm:mr-2" />
                  <span className="hidden sm:inline">Copiar</span>
                </Button>
                <Button
                  onClick={() => shareReferralLink(shareLink)}
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
                    <a href={whatsappShareUrl(shareLink)} target="_blank" rel="noreferrer">
                      <MessageCircle className="w-4 h-4 mr-1.5" /> WhatsApp
                    </a>
                  </Button>
                  <Button asChild size="sm" variant="outline" className="h-9">
                    <a href={smsShareUrl(shareLink)}>
                      <MessageSquare className="w-4 h-4 mr-1.5" /> SMS
                    </a>
                  </Button>
                </div>
              )}
              <p className="text-xs text-muted-foreground border rounded-lg p-2.5 bg-muted/40 italic">
                “{referralShareMessage(shareLink)}”
              </p>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent className="pt-6">
            <form onSubmit={submit} className="flex flex-col sm:flex-row gap-2">
              <Input
                type="email"
                inputMode="email"
                placeholder="correo@delgraduado.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="h-11"
                disabled={createInvitation.isPending}
              />
              <Button type="submit" className="h-11 shrink-0" disabled={createInvitation.isPending || !email.trim()}>
                {createInvitation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Enviando…
                  </>
                ) : (
                  <>
                    <UserPlus className="w-4 h-4 mr-2" /> Enviar invitación
                  </>
                )}
              </Button>
            </form>
            <p className="text-xs text-muted-foreground mt-3 flex items-start gap-1.5">
              <ShieldCheck className="w-4 h-4 text-[var(--lp-green)] shrink-0 mt-px" />
              Por privacidad, solo invitamos un correo a la vez. Nunca subimos listas de datos de terceros: cada
              graduado completa su propio registro y da su consentimiento.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Mail className="w-5 h-5 text-primary" /> Tus invitaciones
            </CardTitle>
          </CardHeader>
          <CardContent>
            {invitationsQuery.isLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-primary" />
              </div>
            ) : invitations.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                Aún no has enviado invitaciones.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Correo</TableHead>
                      <TableHead>Estado</TableHead>
                      <TableHead className="hidden sm:table-cell">Enviada</TableHead>
                      <TableHead className="hidden sm:table-cell">Registrada</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {invitations.map(inv => (
                      <TableRow key={inv.id}>
                        <TableCell className="font-medium truncate max-w-[220px]">{inv.email}</TableCell>
                        <TableCell>{statusChip(inv.status)}</TableCell>
                        <TableCell className="hidden sm:table-cell text-muted-foreground text-sm">
                          {shortDate(inv.sentAt)}
                        </TableCell>
                        <TableCell className="hidden sm:table-cell text-muted-foreground text-sm">
                          {shortDate(inv.registeredAt)}
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
    </PartnerLayout>
  );
}
