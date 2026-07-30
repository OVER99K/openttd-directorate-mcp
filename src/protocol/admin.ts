export const PACKET_SIZE_BYTES = 2;
export const PACKET_TYPE_BYTES = 1;
export const MIN_PACKET_BYTES = PACKET_SIZE_BYTES + PACKET_TYPE_BYTES;
export const UINT32_MAX = 0xffffffff;

export enum PacketAdminType {
  AdminJoin = 0,
  AdminQuit = 1,
  AdminUpdateFrequency = 2,
  AdminPoll = 3,
  AdminChat = 4,
  AdminRemoteConsoleCommand = 5,
  AdminGameScript = 6,
  AdminPing = 7,
  AdminExternalChat = 8,
  AdminJoinSecure = 9,
  AdminAuthenticationResponse = 10,
  ServerFull = 100,
  ServerBanned = 101,
  ServerError = 102,
  ServerProtocol = 103,
  ServerWelcome = 104,
  ServerNewGame = 105,
  ServerShutdown = 106,
  ServerDate = 107,
  ServerClientJoin = 108,
  ServerClientInfo = 109,
  ServerClientUpdate = 110,
  ServerClientQuit = 111,
  ServerClientError = 112,
  ServerCompanyNew = 113,
  ServerCompanyInfo = 114,
  ServerCompanyUpdate = 115,
  ServerCompanyRemove = 116,
  ServerCompanyEconomy = 117,
  ServerCompanyStatistics = 118,
  ServerChat = 119,
  ServerRemoteConsoleCommand = 120,
  ServerConsole = 121,
  ServerCommandNames = 122,
  ServerCommandLoggingOld = 123,
  ServerGameScript = 124,
  ServerRemoteConsoleCommandEnd = 125,
  ServerPong = 126,
  ServerCommandLogging = 127,
  ServerAuthenticationRequest = 128,
  ServerEnableEncryption = 129,
}

export enum AdminUpdateType {
  Date = 0,
  ClientInfo = 1,
  CompanyInfo = 2,
  CompanyEconomy = 3,
  CompanyStats = 4,
  Chat = 5,
  Console = 6,
  CmdNames = 7,
  CmdLogging = 8,
  Gamescript = 9,
}

export enum AdminUpdateFrequency {
  Poll = 0,
  Daily = 1,
  Weekly = 2,
  Monthly = 3,
  Quarterly = 4,
  Annually = 5,
  Automatic = 6,
}

export enum NetworkAction {
  Chat = 0,
  ChatCompany = 1,
  ChatClient = 2,
  GiveMoney = 3,
  NameChange = 4,
  CompanySpectator = 5,
  CompanyJoin = 6,
  CompanyNew = 7,
  ServerMessage = 8,
}

export enum NetworkChatDestinationType {
  Broadcast = 0,
  Team = 1,
  Client = 2,
}

export interface AdminPacket {
  readonly type: PacketAdminType | number;
  readonly payload: Buffer;
}

export interface ServerProtocolInfo {
  readonly protocolVersion: number;
  readonly updateFrequencies: ReadonlyMap<number, number>;
}

export interface ServerWelcomeInfo {
  readonly serverName: string;
  readonly openttdVersion: string;
  readonly dedicated: boolean;
  readonly mapName: string;
  readonly mapSeed: number;
  readonly landscape: number;
  readonly startDate: number;
  readonly mapWidth: number;
  readonly mapHeight: number;
}
