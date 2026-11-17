import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { BaileysWhatsAppProvider } from '../whatsapp/baileys.provider.js';

async function main(): Promise<void> {
  const whatsapp = new BaileysWhatsAppProvider(env.WA_AUTH_DIR);
  await whatsapp.connect();

  logger.info('Buscando grupos participantes no WhatsApp...');
  const groups = await whatsapp.listGroups();

  console.log('\n=== Grupos de WhatsApp Disponíveis ===\n');
  if (groups.length === 0) {
    console.log('Nenhum grupo encontrado.');
  } else {
    for (const group of groups) {
      console.log(`- ${group.subject} (${group.participantsCount} participantes)`);
      console.log(`  ID: ${group.id}\n`);
    }
    console.log('Copie os IDs desejados para WA_TARGET_GROUPS no seu arquivo .env (separados por vírgula).');
  }

  await whatsapp.disconnect();
  process.exit(0);
}

main().catch((err) => {
  logger.error({ err }, 'Erro ao listar grupos do WhatsApp');
  process.exit(1);
});
