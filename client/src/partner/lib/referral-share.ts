/**
 * Partner Portal — sharing the referral link.
 *
 * One message, every channel: the native share sheet on phones (WhatsApp, SMS,
 * Instagram, whatever the partner has installed), with explicit WhatsApp/SMS
 * fallbacks for browsers without the Web Share API (desktop). Copy always works.
 */
import { toast } from "sonner";

/** Friendly invitation the partner sends along with their link. */
export function referralShareMessage(link: string): string {
  return (
    `¡Hola! Te invito a unirte a LeadPrime — your intelligent business partner. ` +
    `Es la plataforma que ayuda a los contratistas a conseguir más trabajo y organizar su negocio. ` +
    `Crea tu cuenta con mi enlace: ${link}`
  );
}

export function canNativeShare(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.share === "function";
}

/** WhatsApp deep link with the message pre-filled. */
export function whatsappShareUrl(link: string): string {
  return `https://wa.me/?text=${encodeURIComponent(referralShareMessage(link))}`;
}

/** SMS deep link with the message pre-filled (iOS + Android accept ?&body=). */
export function smsShareUrl(link: string): string {
  return `sms:?&body=${encodeURIComponent(referralShareMessage(link))}`;
}

export async function copyReferralLink(link: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(link);
    toast.success("Enlace copiado");
  } catch {
    toast.error("No se pudo copiar. Selecciona el texto manualmente.");
  }
}

/**
 * Open the native share sheet with the friendly message. Falls back to copying
 * when the browser has no Web Share API. A user closing the sheet (AbortError)
 * is not an error.
 */
export async function shareReferralLink(link: string): Promise<void> {
  if (canNativeShare()) {
    try {
      await navigator.share({
        title: "LeadPrime — your intelligent business partner",
        text: referralShareMessage(link),
      });
      return;
    } catch (error: any) {
      if (error?.name === "AbortError") return; // user closed the sheet
      // Share sheet failed for real — fall through to copy.
    }
  }
  await copyReferralLink(link);
}
