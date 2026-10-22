const { MercadoPagoConfig, Preference, Payment } = require('mercadopago');

function getClient() {
  const accessToken = process.env.MP_ACCESS_TOKEN;
  if (!accessToken) throw new Error('MP_ACCESS_TOKEN nao configurado no .env');
  return new MercadoPagoConfig({ accessToken });
}

// unitPriceCents: preco em centavos (BRL). Mercado Pago espera um numero
// decimal em reais (ex.: 49.00), entao convertemos aqui.
async function createPreference({ orderId, title, unitPriceCents, email }) {
  const client = getClient();
  const preference = new Preference(client);
  const siteUrl = process.env.APP_BASE_URL || 'http://localhost:3200';
  const backendUrl = process.env.BACKEND_PUBLIC_URL || 'http://localhost:3900';

  // Mercado Pago rejeita auto_return quando o back_url nao e um dominio publico
  // (ex.: localhost durante desenvolvimento) - so ativa em producao.
  const isLocalSite = /^https?:\/\/(localhost|127\.0\.0\.1)/.test(siteUrl);

  const result = await preference.create({
    body: {
      items: [
        {
          id: orderId,
          title,
          quantity: 1,
          currency_id: 'BRL',
          unit_price: Math.round(unitPriceCents) / 100
        }
      ],
      payer: email ? { email } : undefined,
      external_reference: orderId,
      back_urls: {
        success: `${siteUrl}/sucesso?order=${orderId}`,
        pending: `${siteUrl}/sucesso?order=${orderId}`,
        failure: `${siteUrl}/sucesso?order=${orderId}&status=failure`
      },
      ...(isLocalSite ? {} : { auto_return: 'approved' }),
      notification_url: `${backendUrl}/webhook/mercadopago`
    }
  });

  return result;
}

// Pagamento criado direto a partir do Payment Brick (embutido no site, sem
// redirecionar pro checkout do Mercado Pago). formData vem do callback
// onSubmit do Brick (token do cartao, parcelas, identificacao do pagador etc).
async function processPayment({ orderId, unitPriceCents, email, formData }) {
  const client = getClient();
  const payment = new Payment(client);
  const backendUrl = process.env.BACKEND_PUBLIC_URL || 'http://localhost:3900';

  const result = await payment.create({
    body: {
      transaction_amount: Math.round(unitPriceCents) / 100,
      token: formData.token,
      description: 'Archilume AI',
      installments: Number(formData.installments) || 1,
      payment_method_id: formData.payment_method_id,
      issuer_id: formData.issuer_id,
      payer: {
        email: formData.payer?.email || email,
        identification: formData.payer?.identification
      },
      external_reference: orderId,
      notification_url: `${backendUrl}/webhook/mercadopago`
    },
    requestOptions: { idempotencyKey: orderId }
  });

  return result;
}

async function getPayment(paymentId) {
  const client = getClient();
  const payment = new Payment(client);
  return payment.get({ id: paymentId });
}

module.exports = { createPreference, processPayment, getPayment };
