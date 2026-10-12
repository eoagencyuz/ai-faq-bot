export const FIELD_KEYS = [
  'first_name',
  'last_name',
  'phone',
  'birth_date',
  'gender',
  'region',
  'district',
  'additional_info',
] as const;

export type FieldKey = (typeof FIELD_KEYS)[number];

/** Doim so'raladigan maydonlar — konfiguratsiyada o'chirib bo'lmaydi. */
export const REQUIRED_FIELDS: readonly FieldKey[] = ['first_name', 'phone'];

export type Gender = 'male' | 'female' | 'skip';

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface ChannelConfig {
  key: 'channel1' | 'channel2';
  id: string;
  url: string;
  name: string;
}

export type Regions = Record<string, string[]> | null;

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
  fields: FieldKey[];
  regions: Regions;
  /** Ixtiyoriy: Render kabi hostinglar HTTP port talab qilsa, health-server shu portda ishlaydi. */
  port: number | undefined;
}

export interface RegistrationRecord {
  id: string;
  createdAt: Date;
  userId: number;
  username: string;
  firstName: string;
  lastName: string;
  phone: string;
  birthDate: string;
  gender: Gender | '';
  region: string;
  district: string;
  additionalInfo: string;
  subscriptionVerified: boolean;
}
