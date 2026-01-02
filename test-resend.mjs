import dotenv from 'dotenv';
import { Resend } from 'resend';

// Load environment variables
dotenv.config({ path: '.env.local' });

const apiKey = process.env.RESEND_API_KEY;

console.log('=== Resend Email Test ===');
console.log('API Key:', apiKey ? `${apiKey.substring(0, 10)}...` : 'NOT FOUND');

if (!apiKey) {
  console.error('❌ RESEND_API_KEY not configured in .env.local');
  process.exit(1);
}

const resend = new Resend(apiKey);

console.log('\nAttempting to send test email...');

try {
  const result = await resend.emails.send({
    from: 'Chyrris KAI <mervin@owlfenc.com>',
    to: 'gelasio@chyrris.com',
    subject: 'Test OTP from Chyrris KAI',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333;">Chyrris KAI Test Email</h2>
        <p style="font-size: 16px; color: #666;">This is a test email to verify Resend configuration.</p>
        <div style="background: #f5f5f5; padding: 20px; text-align: center; border-radius: 8px; margin: 20px 0;">
          <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #333;">123456</span>
        </div>
        <p style="font-size: 14px; color: #999;">Test OTP Code</p>
      </div>
    `,
  });

  console.log('\n✅ Email sent successfully!');
  console.log('Result:', JSON.stringify(result, null, 2));
} catch (error) {
  console.error('\n❌ Failed to send email');
  console.error('Error message:', error.message);
  console.error('Full error:', error);
}
