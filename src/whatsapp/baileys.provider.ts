import fs from 'node:fs';
import path from 'node:path';
import type { Boom } from '@hapi/boom';
import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
  type WASocket,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import { logger } from '../utils/logger.js';
import type { WhatsAppGroupInfo, WhatsAppProvider } from './whatsapp.provider.js';

export class BaileysWhatsAppProvider implements WhatsAppProvider {
  private socket: WASocket | null = null;
  private connected = false;
  private intentionallyClosed = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private pendingConnectResolve: (() => void) | null = null;
  private pendingConnectReject: ((err: Error) => void) | null = null;

  constructor(private readonly authDir: string) {}

  public isConnected(): boolean {
    return this.connected && this.socket !== null;
  }

  public async connect(): Promise<void> {
    this.intentionallyClosed = false;
    fs.mkdirSync(path.resolve(this.authDir), { recursive: true });

    await new Promise<void>((resolve, reject) => {
      this.pendingConnectResolve = resolve;
      this.pendingConnectReject = reject;
      void this.initializeSocket().catch((err) => {
        this.rejectPendingConnect(err instanceof Error ? err : new Error(String(err)));
      });
    });
  }

  private resolvePendingConnect(): void {
    if (this.pendingConnectResolve) {
      const resolve = this.pendingConnectResolve;
      this.pendingConnectResolve = null;
      this.pendingConnectReject = null;
      resolve();
    }
  }

  private rejectPendingConnect(err: Error): void {
    if (this.pendingConnectReject) {
      const reject = this.pendingConnectReject;
      this.pendingConnectResolve = null;
      this.pendingConnectReject = null;
      reject(err);
    }
  }

  private async initializeSocket(): Promise<void> {
    const { state, saveCreds } = await useMultiFileAuthState(this.authDir);
    const { version } = await fetchLatestBaileysVersion();

    const baileysLogger = pino({ level: 'silent' });

    const sock = makeWASocket({
      version,
      auth: state,
      logger: baileysLogger,
      browser: Browsers.ubuntu('BotOfertas'),
      printQRInTerminal: false,
      markOnlineOnConnect: false,
    });

    this.socket = sock;

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        logger.info('Escaneie o QR Code abaixo no WhatsApp (Dispositivos conectados):');
        qrcode.generate(qr, { small: true });
      }

      if (connection === 'open') {
        this.connected = true;
        logger.info('WhatsApp conectado com sucesso via Baileys!');
        this.resolvePendingConnect();
      }

      if (connection === 'close') {
        this.connected = false;
        const statusCode = (lastDisconnect?.error as Boom | undefined)?.output?.statusCode;
        const isLoggedOut = statusCode === DisconnectReason.loggedOut;
        const isRestartRequired = statusCode === DisconnectReason.restartRequired;

        if (this.intentionallyClosed) {
          this.resolvePendingConnect();
          return;
        }

        if (isLoggedOut) {
          logger.error(
            { authDir: this.authDir },
            'Sessão do WhatsApp desconectada (loggedOut). Apague a pasta de sessão e escaneie o QR Code novamente.',
          );
          this.rejectPendingConnect(new Error('WhatsApp logged out'));
          return;
        }

        if (isRestartRequired) {
          logger.info('Reiniciando conexão após pareamento do QR Code...');
          this.scheduleReconnect(500);
          return;
        }

        logger.warn({ statusCode }, 'Conexão WhatsApp fechada; tentando reconectar em 5s...');
        this.scheduleReconnect(5000);
      }
    });
  }

  private scheduleReconnect(delayMs: number): void {
    if (this.reconnectTimer || this.intentionallyClosed) return;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.initializeSocket().catch((err) => {
        logger.error({ err }, 'Erro ao reconectar Baileys; nova tentativa será feita');
        this.scheduleReconnect(5000);
      });
    }, delayMs);
  }

  public async sendImageMessage(
    groupId: string,
    imageBuffer: Buffer,
    caption: string,
  ): Promise<void> {
    if (!this.socket || !this.connected) {
      throw new Error('WhatsApp não está conectado para envio.');
    }

    const result = await this.socket.sendMessage(groupId, {
      image: imageBuffer,
      caption,
    });

    if (!result?.key?.id) {
      throw new Error(`Envio para ${groupId} não retornou ID de confirmação.`);
    }
  }

  public async listGroups(): Promise<WhatsAppGroupInfo[]> {
    if (!this.socket || !this.connected) {
      throw new Error('WhatsApp não está conectado para listar grupos.');
    }

    const groupsMap = await this.socket.groupFetchAllParticipating();
    return Object.values(groupsMap).map((group) => ({
      id: group.id,
      subject: group.subject,
      participantsCount: group.participants.length,
    }));
  }

  public async disconnect(): Promise<void> {
    this.intentionallyClosed = true;
    this.connected = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      this.socket.end(undefined);
      this.socket = null;
    }
  }
}
