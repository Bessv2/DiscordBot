import { config } from '../config';
import { logger } from './logger';

export interface SteamProfile {
  personaName: string;
  profileUrl: string;
  avatarUrl: string;
  statusText: string;
  currentGame: string | null;
}

const STATUS_NAMES = ['Offline', 'Online', 'Busy', 'Away', 'Snooze', 'Looking to trade', 'Looking to play'];

let warnedMissingConfig = false;

async function resolveSteamId64(input: string): Promise<string | null> {
  if (/^\d{17}$/.test(input)) return input;

  const params = new URLSearchParams({ key: config.STEAM_API_KEY!, vanityurl: input });
  const res = await fetch(`https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/?${params}`);
  if (!res.ok) return null;
  const body = (await res.json()) as { response: { success: number; steamid?: string } };
  return body.response.success === 1 ? (body.response.steamid ?? null) : null;
}

export async function getSteamProfile(input: string): Promise<SteamProfile | null> {
  if (!config.STEAM_API_KEY) {
    if (!warnedMissingConfig) {
      logger.info('Steam stats lookup was used but STEAM_API_KEY is not set — skipping.');
      warnedMissingConfig = true;
    }
    return null;
  }

  const steamId = await resolveSteamId64(input);
  if (!steamId) return null;

  const params = new URLSearchParams({ key: config.STEAM_API_KEY, steamids: steamId });
  const res = await fetch(`https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?${params}`);
  if (!res.ok) return null;

  const body = (await res.json()) as {
    response: { players: { personaname: string; profileurl: string; avatarfull: string; personastate: number; gameextrainfo?: string }[] };
  };
  const player = body.response.players[0];
  if (!player) return null;

  return {
    personaName: player.personaname,
    profileUrl: player.profileurl,
    avatarUrl: player.avatarfull,
    statusText: STATUS_NAMES[player.personastate] ?? 'Unknown',
    currentGame: player.gameextrainfo ?? null,
  };
}
