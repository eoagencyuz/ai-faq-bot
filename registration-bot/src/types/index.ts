export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface ChannelConfig {
  key: 'channel1' | 'channel2';
  id: string;
  url: string;
  name: string;
}

export interface Config {
  botToken: string;
  channels: ChannelConfig[];
  googleSpreadsheetId: string;
  googleSheetName: string;
  googleServiceAccountEmail: string;
  googlePrivateKey: string;
  adminIds: number[];
  timezone: string;
  logLevel: LogLevel;
  sessionTtlHours: number;
  sessionFile: string;
  /** Ixtiyoriy: Render kabi hostinglar HTTP port talab qilsa, health-server shu portda ishlaydi. */
  port: number | undefined;
}
