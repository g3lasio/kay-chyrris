/**
 * Partner Portal — transactional emails (Resend)
 *
 * Uses the shared Resend client from services/config (RESEND_API_KEY env var,
 * NEVER in the repo). The sender must be a Resend-verified domain; configure
 * PARTNER_EMAIL_FROM in Railway (e.g. "LeadPrime <no-reply@chyrris.com>").
 */
import { resend } from "../services/config";

const BRAND = {
  navy: "#0B1A2B",
  blue: "#2E8BE6",
  green: "#2AA875",
  gold: "#C79A45",
  bg: "#F4F7F9",
};

function getFrom(): string {
  return process.env.PARTNER_EMAIL_FROM || "LeadPrime <no-reply@chyrris.com>";
}

function getPortalUrl(): string {
  return process.env.PARTNER_PORTAL_URL || "https://partners.chyrris.com";
}

function layout(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background:${BRAND.bg};font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.bg};padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(11,26,43,0.08);">
        <tr>
          <td style="background:${BRAND.navy};padding:22px 32px;">
            <span style="color:#ffffff;font-size:20px;font-weight:bold;letter-spacing:2px;">LEAD<span style="color:${BRAND.blue};">PRIME</span></span>
            <span style="color:#8fa8c0;font-size:12px;letter-spacing:1px;display:block;margin-top:2px;">PORTAL DE SOCIOS</span>
          </td>
        </tr>
        <tr><td style="padding:32px;">
          <h1 style="margin:0 0 16px;color:${BRAND.navy};font-size:20px;">${title}</h1>
          ${bodyHtml}
        </td></tr>
        <tr><td style="padding:18px 32px;background:${BRAND.bg};color:#7b8a99;font-size:12px;">
          Este correo fue enviado por el programa de socios de LeadPrime.
          Si no esperabas este mensaje, puedes ignorarlo.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

export async function sendPartnerOtpEmail(
  to: string,
  code: string
): Promise<{ success: boolean; error?: string }> {
  if (!resend) {
    console.error("[Partner Emails] Resend not configured (RESEND_API_KEY missing)");
    return { success: false, error: "Email service not configured" };
  }
  try {
    const html = layout(
      "Tu código de acceso",
      `<p style="color:#3d4a58;font-size:14px;line-height:1.6;">Usa este código para entrar al Portal de Socios de LeadPrime. Expira en <strong>10 minutos</strong>.</p>
       <div style="text-align:center;margin:24px 0;">
         <span style="display:inline-block;background:${BRAND.bg};border:1px solid #dbe4ec;border-radius:10px;padding:14px 28px;font-size:30px;font-weight:bold;letter-spacing:10px;color:${BRAND.navy};">${code}</span>
       </div>
       <p style="color:#7b8a99;font-size:12px;line-height:1.6;">Nunca compartas este código. Nadie de LeadPrime te lo pedirá.</p>`
    );
    const result = await resend.emails.send({
      from: getFrom(),
      to,
      subject: `${code} es tu código del Portal de Socios LeadPrime`,
      html,
    });
    if (result.error) {
      console.error("[Partner Emails] OTP send failed:", result.error);
      return { success: false, error: result.error.message };
    }
    return { success: true };
  } catch (error: any) {
    console.error("[Partner Emails] OTP send error:", error);
    return { success: false, error: error.message };
  }
}

export async function sendPartnerInvitationEmail(
  to: string,
  partnerName: string,
  contactName?: string | null
): Promise<{ success: boolean; error?: string }> {
  if (!resend) {
    console.error("[Partner Emails] Resend not configured (RESEND_API_KEY missing)");
    return { success: false, error: "Email service not configured" };
  }
  try {
    const portalUrl = getPortalUrl();
    const greeting = contactName ? `Hola ${contactName},` : "Hola,";
    const html = layout(
      "Bienvenido al programa de socios de LeadPrime",
      `<p style="color:#3d4a58;font-size:14px;line-height:1.6;">${greeting}</p>
       <p style="color:#3d4a58;font-size:14px;line-height:1.6;"><strong>${partnerName}</strong> ya forma parte del programa de socios de LeadPrime. Desde tu portal podrás completar tu registro (contrato, W-9 y depósito ACH), obtener tu enlace de referido y seguir tus referidos y comisiones en tiempo real.</p>
       <div style="text-align:center;margin:28px 0;">
         <a href="${portalUrl}" style="display:inline-block;background:${BRAND.blue};color:#ffffff;text-decoration:none;font-size:15px;font-weight:bold;padding:14px 32px;border-radius:10px;">Activar mi acceso</a>
       </div>
       <p style="color:#3d4a58;font-size:13px;line-height:1.6;">Para entrar solo necesitas tu correo: te enviaremos un código de acceso de un solo uso (sin contraseñas).</p>
       <p style="color:#7b8a99;font-size:12px;line-height:1.6;">Enlace del portal: <a href="${portalUrl}" style="color:${BRAND.blue};">${portalUrl.replace(/^https?:\/\//, "")}</a></p>`
    );
    const result = await resend.emails.send({
      from: getFrom(),
      to,
      subject: "Tu acceso al Portal de Socios de LeadPrime",
      html,
    });
    if (result.error) {
      console.error("[Partner Emails] Invitation send failed:", result.error);
      return { success: false, error: result.error.message };
    }
    return { success: true };
  } catch (error: any) {
    console.error("[Partner Emails] Invitation send error:", error);
    return { success: false, error: error.message };
  }
}
