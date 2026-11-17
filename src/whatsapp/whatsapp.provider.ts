export interface WhatsAppGroupInfo {
  id: string;
  subject: string;
  participantsCount: number;
}

/**
 * Abstração para provedores de disparo no WhatsApp (Baileys, Evolution API, etc.).
 */
export interface WhatsAppProvider {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  sendImageMessage(groupId: string, imageBuffer: Buffer, caption: string): Promise<void>;
  listGroups(): Promise<WhatsAppGroupInfo[]>;
}
