require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const licenses = require('./licenses');
const orders = require('./orders');
const mercadopago = require('./mercadopago');
const email = require('./email');
const huggingface = require('./huggingface');
const { PLANS, getPlan } = require('./plans');

const app = express();

const allowedOrigins = (process.env.ALLOWED_ORIGINS || process.env.APP_BASE_URL || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);
app.use(cors({ origin: allowedOrigins.length ? allowedOrigins : true }));
// Limite maior que o padrao (100kb) - a imagem de referencia do render vai em
// base64 dentro do corpo JSON e pode passar de alguns MB em 4K.
app.use(express.json({ limit: '20mb' }));

const PORT = process.env.PORT || 3900;
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'troque-isso-no-env';

function requireAdmin(req, res, next) {
  if (req.get('x-admin-secret') !== ADMIN_SECRET) {
    return res.status(401).json({ error: 'unauthorized', message: 'Cabecalho x-admin-secret invalido.' });
  }
  next();
}

function handleLicenseError(res, err) {
  if (err instanceof licenses.LicenseError) {
    const statusByCode = {
      not_found: 404,
      invalid_plan: 400,
      missing_email: 400,
      inactive: 403,
      activation_limit: 403,
      not_activated: 403,
      quota_exceeded: 402
    };
    return res.status(statusByCode[err.code] || 400).json({ error: err.code, message: err.message });
  }
  console.error(err);
  return res.status(500).json({ error: 'internal_error', message: 'Erro interno no servidor.' });
}

// Express 4 nao repassa erro de rota async: sem isto, uma falha do banco
// (que agora fica no Turso, pela rede) derrubaria o servidor inteiro.
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

app.get('/health', (_req, res) => res.json({ ok: true }));

app.get('/plans', (_req, res) => res.json(PLANS));

// --- Painel de admin: telinha no navegador pra gerar/ver licencas sem terminal ---
app.get('/admin', (_req, res) => res.sendFile(path.join(__dirname, 'admin.html')));

app.get('/admin/licenses', requireAdmin, ah(async (_req, res) => {
  res.json(await licenses.listLicenses());
}));

app.get('/admin/orders', requireAdmin, ah(async (_req, res) => {
  res.json(await orders.listOrders());
}));

// --- Admin: gerar chave para um cliente (uso manual, por enquanto) ---
app.post('/license/generate', requireAdmin, async (req, res) => {
  try {
    const license = await licenses.generateLicense(req.body || {});
    res.status(201).json(license);
  } catch (err) {
    handleLicenseError(res, err);
  }
});

// --- Admin: revogar/reativar uma chave (bloqueia validacao/ativacao sem apagar o historico) ---
app.post('/admin/license/:key/revoke', requireAdmin, async (req, res) => {
  try {
    res.json(await licenses.revokeLicense(req.params.key));
  } catch (err) {
    handleLicenseError(res, err);
  }
});

app.post('/admin/license/:key/reactivate', requireAdmin, async (req, res) => {
  try {
    res.json(await licenses.reactivateLicense(req.params.key));
  } catch (err) {
    handleLicenseError(res, err);
  }
});

// --- Plugin: ativar a licenca nesta maquina (primeira vez que abre o painel) ---
app.post('/license/activate', async (req, res) => {
  const { key, machine_id: machineId } = req.body || {};
  if (!key || !machineId) return res.status(400).json({ error: 'missing_fields', message: 'key e machine_id sao obrigatorios.' });
  try {
    const { license, plan } = await licenses.activate(key, machineId);
    res.json({ plan: license.plan, modules: plan.modules, rendersPerMonth: plan.rendersPerMonth });
  } catch (err) {
    handleLicenseError(res, err);
  }
});

app.post('/license/deactivate', ah(async (req, res) => {
  const { key, machine_id: machineId } = req.body || {};
  if (!key || !machineId) return res.status(400).json({ error: 'missing_fields', message: 'key e machine_id sao obrigatorios.' });
  await licenses.deactivate(key, machineId);
  res.json({ ok: true });
}));

// --- Plugin: revalidar periodicamente (cache local com janela de graca) ---
app.post('/license/validate', async (req, res) => {
  const { key, machine_id: machineId } = req.body || {};
  if (!key || !machineId) return res.status(400).json({ error: 'missing_fields', message: 'key e machine_id sao obrigatorios.' });
  try {
    const result = await licenses.validate(key, machineId);
    res.json({
      plan: result.license.plan,
      modules: result.plan.modules,
      rendersRemaining: result.rendersRemaining
    });
  } catch (err) {
    handleLicenseError(res, err);
  }
});

// --- Plugin: render via Hugging Face (FLUX.1 Kontext) rodando aqui no
// servidor - o token da HF nunca sai do backend. Valida a licenca, chama a
// HF, e ja debita 1 render da licenca no mesmo request (atomico, nao
// depende do cliente reportar uso depois). ---
app.post('/render/huggingface', async (req, res) => {
  const { key, machine_id: machineId, prompt, image_base64: imageBase64 } = req.body || {};
  if (!key || !machineId || !prompt || !imageBase64) {
    return res.status(400).json({ error: 'missing_fields', message: 'key, machine_id, prompt e image_base64 sao obrigatorios.' });
  }

  let license;
  let plan;
  try {
    ({ license, plan } = await licenses.validate(key, machineId));
  } catch (err) {
    return handleLicenseError(res, err);
  }

  const remaining = plan.rendersPerMonth - license.renders_used;
  if (remaining <= 0) {
    return res.status(402).json({ error: 'quota_exceeded', message: `Limite de ${plan.rendersPerMonth} renders do plano ${plan.label} atingido neste periodo.` });
  }

  try {
    const imageBuffer = await huggingface.generateImage({ prompt, imageBase64 });
    const usage = await licenses.consumeUsage(key, { machineId, model: 'hf-pix2pix' });
    res.set('Content-Type', 'image/png');
    res.set('X-Renders-Remaining', String(usage.rendersRemaining));
    res.send(imageBuffer);
  } catch (err) {
    console.error('[render/huggingface] erro:', err);
    res.status(502).json({ error: 'render_provider_error', message: err.message || 'Nao foi possivel gerar a imagem agora. Tente novamente em instantes.' });
  }
});

// --- Plugin: checar saldo antes de desenhar o botao de render ---
app.post('/usage/check', async (req, res) => {
  const { key } = req.body || {};
  if (!key) return res.status(400).json({ error: 'missing_fields', message: 'key e obrigatorio.' });
  try {
    res.json(await licenses.checkUsage(key));
  } catch (err) {
    handleLicenseError(res, err);
  }
});

// --- Plugin: debitar 1 render do saldo (chamar DEPOIS que o render deu certo) ---
app.post('/usage/consume', async (req, res) => {
  const { key, machine_id: machineId, model, resolution } = req.body || {};
  if (!key) return res.status(400).json({ error: 'missing_fields', message: 'key e obrigatorio.' });
  try {
    res.json(await licenses.consumeUsage(key, { machineId, model, resolution }));
  } catch (err) {
    handleLicenseError(res, err);
  }
});

// --- Venda: cliente escolhe plano/ciclo, a gente cria o pedido + preferencia no Mercado Pago ---
app.post('/checkout/create', ah(async (req, res) => {
  const { plan, cycle, email: customerEmail } = req.body || {};
  if (!customerEmail || !plan || !cycle) {
    return res.status(400).json({ error: 'missing_fields', message: 'email, plan e cycle sao obrigatorios.' });
  }
  if (cycle !== 'monthly' && cycle !== 'annual') {
    return res.status(400).json({ error: 'invalid_cycle', message: 'cycle deve ser "monthly" ou "annual".' });
  }
  const planConfig = getPlan(plan);
  if (!planConfig) return res.status(400).json({ error: 'invalid_plan', message: `Plano desconhecido: ${plan}` });

  const unitPriceCents = planConfig.price[cycle];
  if (!unitPriceCents) {
    return res.status(400).json({ error: 'plan_not_purchasable', message: 'Este plano/ciclo nao esta disponivel para compra (use /trial/claim para o teste gratis).' });
  }

  const order = await orders.createOrder({ email: customerEmail, plan, cycle });

  try {
    const preference = await mercadopago.createPreference({
      orderId: order.id,
      title: `Archilume — plano ${planConfig.label} (${cycle === 'annual' ? 'anual' : 'mensal'})`,
      unitPriceCents,
      email: customerEmail
    });
    await orders.setPreferenceId(order.id, preference.id);
    res.status(201).json({ orderId: order.id, checkoutUrl: preference.init_point, preferenceId: preference.id });
  } catch (err) {
    console.error('[checkout/create] erro ao criar preferencia Mercado Pago:', err);
    res.status(502).json({ error: 'payment_provider_error', message: 'Nao foi possivel iniciar o pagamento agora. Tente novamente em instantes.' });
  }
}));

// --- Venda: pagamento embutido no site via Payment Brick (sem redirecionar
// pro Mercado Pago) - o Brick ja tokeniza o cartao com seguranca no
// navegador; aqui so processamos o token contra a API deles. ---
app.post('/checkout/process', ah(async (req, res) => {
  const { plan, cycle, email: customerEmail, formData, orderId: existingOrderId } = req.body || {};
  if (!customerEmail || !plan || !cycle || !formData) {
    return res.status(400).json({ error: 'missing_fields', message: 'email, plan, cycle e formData sao obrigatorios.' });
  }
  if (cycle !== 'monthly' && cycle !== 'annual') {
    return res.status(400).json({ error: 'invalid_cycle', message: 'cycle deve ser "monthly" ou "annual".' });
  }
  const planConfig = getPlan(plan);
  if (!planConfig) return res.status(400).json({ error: 'invalid_plan', message: `Plano desconhecido: ${plan}` });

  // Preco sempre calculado aqui no servidor a partir do catalogo - nunca
  // confiar em valor vindo do cliente.
  const unitPriceCents = planConfig.price[cycle];
  if (!unitPriceCents) {
    return res.status(400).json({ error: 'plan_not_purchasable', message: 'Este plano/ciclo nao esta disponivel para compra.' });
  }

  // Reaproveita o pedido criado em /checkout/create (junto com a preferencia
  // usada pra inicializar o Brick) em vez de duplicar - cai pra criar um novo
  // pedido so se por algum motivo o id nao vier ou nao existir mais.
  const order = (existingOrderId && await orders.getOrder(existingOrderId)) || await orders.createOrder({ email: customerEmail, plan, cycle });

  try {
    const payment = await mercadopago.processPayment({
      orderId: order.id,
      unitPriceCents,
      email: customerEmail,
      formData
    });
    await orders.setPreferenceId(order.id, String(payment.id));

    if (payment.status === 'approved' && order.status !== 'paid') {
      const license = await licenses.generateLicense({
        email: order.email,
        plan: order.plan,
        notes: `Pedido ${order.id} via Mercado Pago Brick (pagamento ${payment.id})`
      });
      await orders.markPaid(order.id, { paymentId: payment.id, licenseKey: license.key });
      email.sendLicenseEmail({ to: order.email, planLabel: planConfig.label, licenseKey: license.key })
        .catch((err) => console.error('[checkout/process] falha ao enviar email:', err));
    } else if (['rejected', 'cancelled'].includes(payment.status)) {
      await orders.markFailed(order.id, payment.id);
    }

    res.status(201).json({
      orderId: order.id,
      status: payment.status,
      statusDetail: payment.status_detail
    });
  } catch (err) {
    console.error('[checkout/process] erro ao processar pagamento Mercado Pago:', err);
    await orders.markFailed(order.id, null).catch(() => {});
    res.status(502).json({ error: 'payment_provider_error', message: 'Nao foi possivel processar o pagamento agora. Verifique os dados do cartao e tente novamente.' });
  }
}));

// --- Mercado Pago chama esta rota quando o status de um pagamento muda ---
app.post('/webhook/mercadopago', async (req, res) => {
  const paymentId = req.query['data.id'] || req.body?.data?.id || req.body?.id;
  const topic = req.query.type || req.body?.type;

  // So nos interessam notificacoes de pagamento; confirma recebimento das outras sem processar.
  if (topic !== 'payment' || !paymentId) return res.status(200).json({ ok: true, ignored: true });

  try {
    const payment = await mercadopago.getPayment(paymentId);
    const orderId = payment.external_reference;
    const order = orderId ? await orders.getOrder(orderId) : null;
    if (!order) return res.status(200).json({ ok: true, order_not_found: true });

    if (payment.status === 'approved') {
      if (order.status !== 'paid') {
        const planConfig = getPlan(order.plan);
        const license = await licenses.generateLicense({
          email: order.email,
          plan: order.plan,
          notes: `Pedido ${order.id} via Mercado Pago (pagamento ${paymentId})`
        });
        await orders.markPaid(order.id, { paymentId, licenseKey: license.key });
        email.sendLicenseEmail({ to: order.email, planLabel: planConfig.label, licenseKey: license.key })
          .catch((err) => console.error('[webhook] falha ao enviar email:', err));
      }
    } else if (['rejected', 'cancelled'].includes(payment.status)) {
      await orders.markFailed(order.id, paymentId);
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[webhook/mercadopago] erro:', err);
    // Responde 200 mesmo assim pra evitar que o Mercado Pago fique reenviando indefinidamente
    // notificacoes que nosso lado nao vai conseguir processar (ex.: pagamento de teste invalido).
    res.status(200).json({ ok: false });
  }
});

// --- Pagina de sucesso do site: pergunta "ja processou? qual a chave?" ---
app.get('/checkout/status/:orderId', ah(async (req, res) => {
  const order = await orders.getOrder(req.params.orderId);
  if (!order) return res.status(404).json({ error: 'not_found', message: 'Pedido nao encontrado.' });
  res.json({
    status: order.status,
    plan: order.plan,
    cycle: order.cycle,
    licenseKey: order.status === 'paid' ? order.license_key : null
  });
}));

// --- Teste gratis: gera a chave na hora, sem pagamento ---
app.post('/trial/claim', ah(async (req, res) => {
  const { email: customerEmail } = req.body || {};
  if (!customerEmail) return res.status(400).json({ error: 'missing_fields', message: 'email e obrigatorio.' });

  const already = (await licenses.listLicenses()).find((l) => l.plan === 'trial' && l.email === customerEmail);
  if (already) {
    return res.status(409).json({ error: 'trial_already_claimed', message: 'Este email ja recebeu uma chave de teste gratis.' });
  }

  const license = await licenses.generateLicense({ email: customerEmail, plan: 'trial', notes: 'Teste gratis via site' });
  email.sendLicenseEmail({ to: customerEmail, planLabel: PLANS.trial.label, licenseKey: license.key })
    .catch((err) => console.error('[trial/claim] falha ao enviar email:', err));
  res.status(201).json({ licenseKey: license.key });
}));

// Erros que escaparam das rotas (inclusive do banco): responde em vez de cair.
app.use((err, _req, res, _next) => handleLicenseError(res, err));

app.listen(PORT, () => {
  console.log(`Archilume backend rodando em http://localhost:${PORT}`);
});
