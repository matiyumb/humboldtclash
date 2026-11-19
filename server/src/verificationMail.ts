export function verificationMailer(env: NodeJS.ProcessEnv) {
  const key = env.RESEND_API_KEY?.trim();
  const from = env.VERIFICATION_FROM_EMAIL?.trim();
  const testOrigin = env.HUMBOLDTCLASH_TEST === '1' && /^http:\/\/127\.0\.0\.1:\d+$/.test(env.TEST_MAIL_ORIGIN ?? '')
    ? env.TEST_MAIL_ORIGIN
    : undefined;
  if (!testOrigin && (!key || !from)) {
    const missing = [!key && 'RESEND_API_KEY', !from && 'VERIFICATION_FROM_EMAIL'].filter(Boolean);
    console.warn(`Registro por correo desactivado. Variables de entorno sin configurar: ${missing.join(', ')}.`);
    return null;
  }

  return async (address: string, code: string) => {
    const response = await fetch(testOrigin ? new URL('/emails', testOrigin) : 'https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(testOrigin ? {} : { Authorization: `Bearer ${key}` }) },
      body: JSON.stringify({
        from: testOrigin ? 'Humboldtclash <test@example.com>' : from,
        to: [address],
        subject: 'Tu código de verificación de Humboldtclash',
        text: `Tu código de verificación es ${code}. Caduca en 10 minutos. Si no solicitaste una cuenta, puedes ignorar este correo.`,
      }),
      redirect: 'error',
      signal: AbortSignal.timeout(8000),
    });
    await response.body?.cancel();
    if (!response.ok) throw new Error(`El proveedor de correo respondió con HTTP ${response.status}`);
  };
}
