export async function sendWelcomeMail(email: string): Promise<void> {
  console.log(`welcome mail queued for ${email.trim().toLowerCase()}`);
}
