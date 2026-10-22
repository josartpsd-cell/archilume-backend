const { Resend } = require('resend');

function getClient() {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  return new Resend(apiKey);
}

async function sendLicenseEmail({ to, planLabel, licenseKey }) {
  const resend = getClient();
  if (!resend) {
    console.warn('[email] RESEND_API_KEY nao configurado — pulando envio para', to);
    return { skipped: true };
  }

  const from = process.env.RESEND_FROM || 'Archilume <onboarding@resend.dev>';
  return resend.emails.send({
    from,
    to,
    subject: 'Sua chave de ativação Archilume',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; color: #211d18;">
        <h2 style="color:#a2582f;">Bem-vindo ao Archilume — plano ${planLabel}</h2>
        <p>Obrigado por assinar! Sua chave de ativação é:</p>
        <p style="font-size: 22px; font-family: monospace; letter-spacing: 2px; background: #f1efea; padding: 14px 18px; border-radius: 10px; text-align: center;">
          <strong>${licenseKey}</strong>
        </p>
        <p>Como ativar:</p>
        <ol>
          <li>Abra o SketchUp com o plugin Archilume instalado.</li>
          <li>Clique em "Configurações" dentro do painel do plugin.</li>
          <li>Cole a chave acima no campo "Chave de licença Archilume" e salve.</li>
        </ol>
        <p>Qualquer dúvida, responda este e-mail.</p>
      </div>
    `
  });
}

module.exports = { sendLicenseEmail };
