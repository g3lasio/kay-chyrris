/**
 * Partner Portal — guided W-9, filled and SIGNED inside the portal.
 *
 * The partner never sees the IRS PDF: they answer a friendly form, sign with
 * their finger (or let their typed name stand as the signature), and the
 * server renders the substitute Form W-9 and files it for them. Mobile-first:
 * every control is finger-sized and the signature pad is touch-native.
 */
import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { Eraser, FileSignature, Loader2, ShieldCheck } from "lucide-react";
import { usePartnerAuth } from "../usePartnerAuth";

const CLASSIFICATIONS = [
  { value: "individual", label: "Individual / dueño único (sole proprietor)" },
  { value: "llc", label: "LLC (compañía de responsabilidad limitada)" },
  { value: "s_corp", label: "Corporación S" },
  { value: "c_corp", label: "Corporación C" },
  { value: "partnership", label: "Partnership" },
  { value: "trust_estate", label: "Fideicomiso / sucesión" },
  { value: "other", label: "Otro" },
] as const;

/** Touch/mouse signature pad — no dependencies, exports a PNG data URL. */
function SignaturePad({ onChange }: { onChange: (dataUrl: string | null) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [hasInk, setHasInk] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const scale = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * scale;
    canvas.height = rect.height * scale;
    const ctx = canvas.getContext("2d")!;
    ctx.scale(scale, scale);
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#0B1A2B";
  }, []);

  const pos = (e: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const start = (e: React.PointerEvent) => {
    e.preventDefault();
    drawing.current = true;
    canvasRef.current!.setPointerCapture(e.pointerId);
    const ctx = canvasRef.current!.getContext("2d")!;
    const { x, y } = pos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  };
  const move = (e: React.PointerEvent) => {
    if (!drawing.current) return;
    e.preventDefault();
    const ctx = canvasRef.current!.getContext("2d")!;
    const { x, y } = pos(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    if (!hasInk) setHasInk(true);
  };
  const end = () => {
    if (!drawing.current) return;
    drawing.current = false;
    onChange(canvasRef.current!.toDataURL("image/png"));
  };
  const clear = () => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasInk(false);
    onChange(null);
  };

  return (
    <div className="space-y-1.5">
      <div className="relative">
        <canvas
          ref={canvasRef}
          className="w-full h-32 bg-white border-2 border-dashed rounded-lg touch-none cursor-crosshair"
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
        />
        {!hasInk && (
          <span className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground pointer-events-none">
            Firma aquí con tu dedo
          </span>
        )}
      </div>
      {hasInk && (
        <Button type="button" variant="ghost" size="sm" onClick={clear} className="h-8 text-xs">
          <Eraser className="w-3.5 h-3.5 mr-1.5" /> Borrar y firmar de nuevo
        </Button>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-sm font-medium">{label}</label>
      {children}
    </div>
  );
}

export default function W9FormDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { partner } = usePartnerAuth();
  const utils = trpc.useUtils();
  const submitW9 = trpc.partnerPortal.submitW9.useMutation();

  const [name, setName] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [classification, setClassification] = useState<string>("individual");
  const [llcClass, setLlcClass] = useState<string>("");
  const [otherClass, setOtherClass] = useState("");
  const [address, setAddress] = useState("");
  const [cityStateZip, setCityStateZip] = useState("");
  const [tinType, setTinType] = useState<"ssn" | "ein">("ssn");
  const [tin, setTin] = useState("");
  const [exemptPayeeCode, setExemptPayeeCode] = useState("");
  const [fatcaExemptionCode, setFatcaExemptionCode] = useState("");
  const [accountNumbers, setAccountNumbers] = useState("");
  const [certify, setCertify] = useState(false);
  const [signaturePng, setSignaturePng] = useState<string | null>(null);

  // Prefill from the partner's profile the first time the dialog opens.
  useEffect(() => {
    if (open && partner && !name) {
      setName(partner.contactName || partner.name || "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, partner]);

  const tinDigits = tin.replace(/\D/g, "");
  const canSubmit =
    name.trim().length >= 2 &&
    address.trim().length >= 4 &&
    cityStateZip.trim().length >= 4 &&
    tinDigits.length === 9 &&
    certify &&
    (classification !== "llc" || !!llcClass) &&
    !submitW9.isPending;

  const submit = async () => {
    try {
      await submitW9.mutateAsync({
        name: name.trim(),
        businessName: businessName.trim() || undefined,
        taxClassification: classification as any,
        llcClassification: (llcClass || undefined) as any,
        otherClassification: otherClass.trim() || undefined,
        exemptPayeeCode: exemptPayeeCode.trim() || undefined,
        fatcaExemptionCode: fatcaExemptionCode.trim() || undefined,
        accountNumbers: accountNumbers.trim() || undefined,
        address: address.trim(),
        cityStateZip: cityStateZip.trim(),
        tinType,
        tin: tinDigits,
        certify: true,
        signatureName: name.trim(),
        signatureImagePngDataUrl: signaturePng || undefined,
      });
      toast.success("¡W-9 firmado y guardado! Ya quedó en tu expediente.");
      onOpenChange(false);
      setTin("");
      setCertify(false);
      setSignaturePng(null);
      setExemptPayeeCode("");
      setFatcaExemptionCode("");
      setAccountNumbers("");
      await Promise.all([
        utils.partnerPortal.documents.invalidate(),
        utils.partnerPortal.onboarding.invalidate(),
      ]);
    } catch (error: any) {
      toast.error(error.message || "No se pudo guardar el W-9");
    }
  };

  const maskedTin =
    tinType === "ssn"
      ? tinDigits.replace(/^(\d{0,3})(\d{0,2})(\d{0,4}).*$/, (_m, a, b, c) =>
          [a, b, c].filter(Boolean).join("-")
        )
      : tinDigits.replace(/^(\d{0,2})(\d{0,7}).*$/, (_m, a, b) => [a, b].filter(Boolean).join("-"));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[92dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSignature className="w-5 h-5 text-primary" /> Llena y firma tu W-9 aquí
          </DialogTitle>
          <DialogDescription>
            Sin PDFs ni impresiones: contesta estos datos, firma con tu dedo y nosotros generamos y
            guardamos tu W-9 oficial automáticamente.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Field label="Nombre (como aparece en tu declaración de impuestos)">
            <Input value={name} onChange={e => setName(e.target.value)} className="h-11" autoComplete="name" />
          </Field>

          <Field label="Nombre del negocio (opcional, si es distinto)">
            <Input
              value={businessName}
              onChange={e => setBusinessName(e.target.value)}
              className="h-11"
              placeholder="Tu empresa LLC"
              autoComplete="organization"
            />
          </Field>

          <Field label="Clasificación fiscal">
            <select
              value={classification}
              onChange={e => setClassification(e.target.value)}
              className="w-full h-11 rounded-md border border-input bg-background px-3 text-sm"
            >
              {CLASSIFICATIONS.map(c => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </Field>

          {classification === "llc" && (
            <Field label="Tu LLC tributa como…">
              <select
                value={llcClass}
                onChange={e => setLlcClass(e.target.value)}
                className="w-full h-11 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">Elige una opción</option>
                <option value="C">C — Corporación C</option>
                <option value="S">S — Corporación S</option>
                <option value="P">P — Partnership</option>
              </select>
            </Field>
          )}

          {classification === "other" && (
            <Field label="Especifica la clasificación">
              <Input value={otherClass} onChange={e => setOtherClass(e.target.value)} className="h-11" />
            </Field>
          )}

          <Field label="Dirección (calle y número)">
            <Input
              value={address}
              onChange={e => setAddress(e.target.value)}
              className="h-11"
              autoComplete="street-address"
            />
          </Field>

          <Field label="Ciudad, estado y código postal">
            <Input
              value={cityStateZip}
              onChange={e => setCityStateZip(e.target.value)}
              className="h-11"
              placeholder="Houston, TX 77001"
            />
          </Field>

          <div className="grid grid-cols-[auto_1fr] gap-2 items-end">
            <Field label="Tipo">
              <select
                value={tinType}
                onChange={e => setTinType(e.target.value as "ssn" | "ein")}
                className="h-11 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="ssn">SSN</option>
                <option value="ein">EIN</option>
              </select>
            </Field>
            <Field label={tinType === "ssn" ? "Número de seguro social" : "Número de identificación patronal"}>
              <Input
                value={maskedTin}
                onChange={e => setTin(e.target.value)}
                className="h-11 font-mono"
                inputMode="numeric"
                placeholder={tinType === "ssn" ? "123-45-6789" : "12-3456789"}
              />
            </Field>
          </div>
          <p className="text-xs text-muted-foreground flex items-start gap-1.5 -mt-2">
            <ShieldCheck className="w-4 h-4 text-[var(--lp-green)] shrink-0 mt-px" />
            Tu número va cifrado directo a tu W-9 en almacenamiento privado. No se guarda en ninguna
            base de datos ni lo ve nadie más.
          </p>

          <details className="border rounded-lg">
            <summary className="cursor-pointer select-none px-3 py-2.5 text-sm font-medium">
              Datos avanzados (opcional)
            </summary>
            <div className="px-3 pb-3 space-y-3">
              <p className="text-xs text-muted-foreground">
                Solo para ciertas entidades. Si eres individuo o dueño único, déjalos en blanco.
              </p>
              <Field label="Número(s) de cuenta (Línea 7)">
                <Input
                  value={accountNumbers}
                  onChange={e => setAccountNumbers(e.target.value)}
                  className="h-11"
                  placeholder="Opcional"
                />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Código de payee exento">
                  <Input
                    value={exemptPayeeCode}
                    onChange={e => setExemptPayeeCode(e.target.value)}
                    className="h-11"
                    maxLength={8}
                  />
                </Field>
                <Field label="Código exención FATCA">
                  <Input
                    value={fatcaExemptionCode}
                    onChange={e => setFatcaExemptionCode(e.target.value)}
                    className="h-11"
                    maxLength={5}
                  />
                </Field>
              </div>
            </div>
          </details>

          <Field label="Tu firma">
            <SignaturePad onChange={setSignaturePng} />
          </Field>

          <label className="flex items-start gap-2.5 text-xs leading-relaxed cursor-pointer border rounded-lg p-3 bg-muted/40">
            <Checkbox checked={certify} onCheckedChange={v => setCertify(v === true)} className="mt-0.5" />
            <span>
              <strong>Bajo pena de perjurio, certifico que:</strong> (1) el número indicado es mi número
              correcto de identificación fiscal; (2) no estoy sujeto a retención adicional (backup
              withholding); (3) soy ciudadano de EE. UU. u otra persona de EE. UU.; y (4) el código FATCA
              indicado (si aplica) es correcto. Esta certificación corresponde al Formulario W-9 del IRS y
              mi firma electrónica tiene el mismo efecto que una firma en papel.
            </span>
          </label>

          <Button onClick={submit} disabled={!canSubmit} className="w-full h-12 text-base">
            {submitW9.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Generando tu W-9…
              </>
            ) : (
              <>
                <FileSignature className="w-4 h-4 mr-2" /> Firmar y guardar mi W-9
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
