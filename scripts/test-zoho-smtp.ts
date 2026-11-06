import nodemailer from 'nodemailer';
import path from 'path';
import fs from 'fs';

async function main() {
  // Load env variables manually
  const envPath = path.resolve(process.cwd(), '.env.local');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf8');
    content.split('\n').forEach(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const parts = trimmed.split('=');
      if (parts.length >= 2) {
        const key = parts[0].trim();
        let value = parts.slice(1).join('=').trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.substring(1, value.length - 1);
        }
        process.env[key] = value;
      }
    });
  }
  const host = process.env.SMTP_HOST || 'smtppro.zoho.in';
  const port = parseInt(process.env.SMTP_PORT || '465', 10);
  const user = process.env.SMTP_HELLO_USER;
  const pass = process.env.SMTP_HELLO_PASS;

  console.log('--- Zoho SMTP Verification Script ---');
  console.log(`Host: ${host}`);
  console.log(`Port: ${port}`);
  console.log(`Username (Hello): ${user ? user : '[MISSING]'}`);
  console.log(`Password (Hello): ${pass ? '******** (Provided)' : '[MISSING]'}`);

  if (!user || !pass) {
    console.error('Error: SMTP_HELLO_USER and SMTP_HELLO_PASS environment variables must be set.');
    process.exit(1);
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465, // true for 465, false for other ports (587)
    auth: {
      user,
      pass,
    },
    debug: true,
    logger: true,
  });

  try {
    console.log('\n1. Verifying connection to SMTP server...');
    await transporter.verify();
    console.log('✅ SMTP Connection verified successfully!');

    console.log('\n2. Sending test email...');
    const info = await transporter.sendMail({
      from: `KickoffPro Hello <${user}>`,
      to: user, // Send to self
      subject: 'KickoffPro Zoho SMTP Test Email',
      text: 'This is a test email sent from the KickoffPro Zoho SMTP verification script.',
      html: `
        <div style="font-family: sans-serif; padding: 20px; background-color: #f4f4f4;">
          <h2 style="color: #333;">KickoffPro Zoho SMTP Verification</h2>
          <p>This is a test email to verify that Zoho SMTP is configured correctly for <strong>${user}</strong>.</p>
          <p>Status: <strong>✅ Verification Success</strong></p>
          <hr style="border: none; border-top: 1px solid #ccc; margin: 20px 0;" />
          <small style="color: #666;">Sent at: ${new Date().toISOString()}</small>
        </div>
      `,
    });

    console.log('✅ Test email sent successfully!');
    console.log(`Message ID: ${info.messageId}`);
    console.log(`Response: ${info.response}`);
    process.exit(0);
  } catch (error: any) {
    console.error('\n❌ SMTP Verification Failed!');
    console.error('Error Details:', error.message || error);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

main();
