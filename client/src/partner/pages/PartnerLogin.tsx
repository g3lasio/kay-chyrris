/**
 * Partner Portal — OTP login (email → 6-digit code via Resend).
 * Responsive: single centered card, works from 320px up.
 */
import { useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { toast } from "sonner";
import { ArrowLeft, Loader2, Mail, ShieldCheck } from "lucide-react";

type Step = "email" | "code";

export default function PartnerLogin() {
  const [, setLocation] = useLocation();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");

  const utils = trpc.useUtils();
  const requestOtp = trpc.partnerAuth.requestOtp.useMutation();
  const verifyOtp = trpc.partnerAuth.verifyOtp.useMutation();

  const handleRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    const value = email.trim().toLowerCase();
    if (!value) return;
    try {
      const result = await requestOtp.mutateAsync({ email: value });
      // Always neutral: the server never reveals whether the email exists.
      toast.info(result.message);
      setStep("code");
    } catch (error: any) {
      toast.error(error.message || "No se pudo enviar el código");
    }
  };

  const handleVerify = async (submittedCode?: string) => {
    const finalCode = (submittedCode ?? code).trim();
    if (finalCode.length !== 6) return;
    try {
      const result = await verifyOtp.mutateAsync({ email: email.trim().toLowerCase(), code: finalCode });
      if (result.success) {
        await utils.partnerAuth.me.refetch();
        toast.success("Bienvenido al Portal de Socios");
        setLocation("/");
      } else {
        toast.error(result.error || "Código inválido o expirado");
        setCode("");
      }
    } catch (error: any) {
      toast.error(error.message || "Algo salió mal");
      setCode("");
    }
  };

  return (
    <div className="min-h-dvh lp-gradient-hero flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <img
            src="/brand/leadprime-logo-white.png"
            alt="LeadPrime"
            className="mx-auto w-56 max-w-[70%] h-auto"
          />
          <p className="text-white/70 text-sm tracking-[0.3em] uppercase mt-2">
            Portal de Socios
          </p>
        </div>

        <Card className="border-0 shadow-xl">
          <CardContent className="p-6 sm:p-8">
            {step === "email" ? (
              <form onSubmit={handleRequest} className="space-y-5">
                <div className="text-center space-y-1">
                  <div className="mx-auto w-12 h-12 rounded-2xl bg-accent flex items-center justify-center">
                    <Mail className="w-6 h-6 text-primary" />
                  </div>
                  <h1 className="text-lg font-semibold text-foreground pt-2">Entrar al portal</h1>
                  <p className="text-sm text-muted-foreground">
                    Escribe tu correo y te enviaremos un código de acceso de un solo uso.
                  </p>
                </div>
                <Input
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  placeholder="tucorreo@ejemplo.com"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="h-12 text-base"
                  autoFocus
                  disabled={requestOtp.isPending}
                />
                <Button
                  type="submit"
                  className="w-full h-12 text-base font-semibold"
                  disabled={requestOtp.isPending || !email.trim()}
                >
                  {requestOtp.isPending ? (
                    <>
                      <Loader2 className="w-5 h-5 mr-2 animate-spin" /> Enviando…
                    </>
                  ) : (
                    "Enviarme el código"
                  )}
                </Button>
                <p className="text-xs text-muted-foreground text-center">
                  El acceso es solo para socios registrados por LeadPrime.
                </p>
              </form>
            ) : (
              <div className="space-y-5">
                <div className="text-center space-y-1">
                  <div className="mx-auto w-12 h-12 rounded-2xl bg-accent flex items-center justify-center">
                    <ShieldCheck className="w-6 h-6 text-primary" />
                  </div>
                  <h1 className="text-lg font-semibold text-foreground pt-2">Revisa tu correo</h1>
                  <p className="text-sm text-muted-foreground break-all">
                    Si <strong>{email}</strong> está registrado, recibirás un código de 6 dígitos.
                    Vence en 10 minutos.
                  </p>
                </div>
                <div className="flex justify-center">
                  <InputOTP
                    maxLength={6}
                    value={code}
                    onChange={value => {
                      setCode(value);
                      if (value.length === 6) handleVerify(value);
                    }}
                    disabled={verifyOtp.isPending}
                  >
                    <InputOTPGroup>
                      {[0, 1, 2, 3, 4, 5].map(i => (
                        <InputOTPSlot key={i} index={i} className="h-12 w-10 sm:w-12 text-lg" />
                      ))}
                    </InputOTPGroup>
                  </InputOTP>
                </div>
                <Button
                  className="w-full h-12 text-base font-semibold"
                  onClick={() => handleVerify()}
                  disabled={verifyOtp.isPending || code.length !== 6}
                >
                  {verifyOtp.isPending ? (
                    <>
                      <Loader2 className="w-5 h-5 mr-2 animate-spin" /> Verificando…
                    </>
                  ) : (
                    "Entrar"
                  )}
                </Button>
                <div className="flex items-center justify-between text-sm">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
                    onClick={() => {
                      setStep("email");
                      setCode("");
                    }}
                  >
                    <ArrowLeft className="w-4 h-4" /> Cambiar correo
                  </button>
                  <button
                    type="button"
                    className="text-primary hover:underline disabled:opacity-50"
                    disabled={requestOtp.isPending}
                    onClick={async () => {
                      const result = await requestOtp.mutateAsync({ email: email.trim().toLowerCase() });
                      toast.info(result.message);
                    }}
                  >
                    Reenviar código
                  </button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <p className="text-center text-white/50 text-xs mt-6">
          © {new Date().getFullYear()} LeadPrime · Programa de socios
        </p>
      </div>
    </div>
  );
}
