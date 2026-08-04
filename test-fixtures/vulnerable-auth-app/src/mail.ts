import nodemailer from 'nodemailer';

function smtpAddress(): { host: string; port: number } {
  const configured = process.env.ARXIC_MAILPIT_SMTP || 'localhost:1025';
  const separator = configured.lastIndexOf(':');
  const host = separator === -1 ? configured : configured.slice(0, separator);
  const port = separator === -1 ? 1025 : Number(configured.slice(separator + 1));
  if (!host || !Number.isInteger(port)) throw new Error('ARXIC_MAILPIT_SMTP must be host:port');
  return { host, port };
}

export async function sendResetEmail(toEmail: string, resetUrl: string): Promise<void> {
  const transport = nodemailer.createTransport(smtpAddress());
  await transport.sendMail({
    from: 'no-reply@vulnerable-auth-app.test',
    to: toEmail,
    subject: 'Reset your vulnerable app password',
    text: `Reset your password using this link: ${resetUrl}`,
    html: `<p>Reset your password using <a href="${resetUrl}">this link</a>.</p>`,
  });
}
