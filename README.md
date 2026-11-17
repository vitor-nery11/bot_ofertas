# Bot de Ofertas (Mercado Livre -> WhatsApp)

Bot automatizado em **Node.js + TypeScript** seguindo o fluxo:

1. **Agendador (`node-cron` + jitter):** Dispara a cada 10–15 minutos com atraso inicial aleatório e trava contra sobreposição de ciclos.
2. **Coleta (`Playwright`):** Extrai ID (`MLB...`), título, preço original, preço atual, desconto, URL limpa e imagem em alta resolução, com detecção segura de CAPTCHA/bloqueios (interrompe o ciclo e alerta nos logs).
3. **Filtragem e Deduplicação (`SQLite`):** Descarta ofertas abaixo do desconto mínimo (`MIN_DISCOUNT_PERCENT`) e ignora itens já enviados dentro da janela (`24h`/`48h`) pelo mesmo preço ou preço maior.
4. **Conversão de Afiliado:** Suporta endpoint encurtador configurável (ex.: `https://meli.la/...`) ou injeção de parâmetros `matt_word`/`matt_tool`.
5. **Formatação & Mídia Nativa:** Monta legenda persuasiva e baixa a imagem em alta resolução para envio nativo no WhatsApp.
6. **Fila de Disparo (`BullMQ` + `Baileys`):** Processa 1 oferta por vez com delay aleatório de 15 a 45 segundos entre envios, gravando no SQLite somente após a confirmação do envio.

## Pré-requisitos

- **Node.js** 20+ (testado em v24)
- **Redis** (necessário para o BullMQ)
- Navegador Chromium do Playwright (`npx playwright install chromium`)

### Subindo o Redis

Se estiver com Docker instalado:
```bash
docker compose up -d
```

Ou instale o `redis-server` localmente no Linux e inicie o serviço na porta `6379`.

## Configuração

1. Copie o arquivo de exemplo e preencha suas variáveis:
   ```bash
   cp .env.example .env
   ```

2. Instale as dependências (se ainda não instalou) e o Chromium do Playwright:
   ```bash
   npm install
   npx playwright install chromium
   ```

3. Conecte o WhatsApp via Baileys e descubra os IDs dos grupos (`@g.us`):
   ```bash
   npm run groups
   ```
   Escaneie o QR Code exibido no terminal e copie os IDs dos grupos desejados para `WA_TARGET_GROUPS` no `.env`.

## Comandos Úteis

- **Testes unitários:** `npm test`
- **Verificação de tipos:** `npm run typecheck`
- **Dry-run (testar coleta, filtro e legenda sem enviar no WhatsApp):** `npm run run:once`
- **Rodar o bot em desenvolvimento:** `npm run dev`
- **Compilar e rodar em produção:** `npm run build && npm start`
