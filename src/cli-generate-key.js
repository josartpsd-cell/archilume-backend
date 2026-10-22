// Uso: npm run generate-key -- --email cliente@exemplo.com --plan starter [--notes "pago via pix"]
const licenses = require('./licenses');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith('--')) {
      const name = argv[i].slice(2);
      out[name] = argv[i + 1];
      i += 1;
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

if (!args.email || !args.plan) {
  console.error('Uso: npm run generate-key -- --email cliente@exemplo.com --plan starter|pro|studio|trial [--notes "..."]');
  process.exit(1);
}

try {
  const license = licenses.generateLicense({ email: args.email, plan: args.plan, notes: args.notes });
  console.log('Licenca criada:');
  console.log(`  Chave:  ${license.key}`);
  console.log(`  Email:  ${license.email}`);
  console.log(`  Plano:  ${license.plan}`);
} catch (err) {
  console.error(`Erro: ${err.message}`);
  process.exit(1);
}
