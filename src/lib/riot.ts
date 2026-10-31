import { config } from '../config';
import { logger } from './logger';

export interface LolProfile {
  summonerLevel: number;
  soloQueue: { tier: string; rank: string; leaguePoints: number; wins: number; losses: number } | null;
}

// Riot splits routing into "regional" (account lookups) and "platform"
// (everything else) clusters — see Riot's API docs for the full list.
const PLATFORM_TO_REGIONAL: Record<string, string> = {
  na1: 'americas', br1: 'americas', la1: 'americas', la2: 'americas', oc1: 'americas',
  euw1: 'europe', eun1: 'europe', tr1: 'europe', ru: 'europe',
  kr: 'asia', jp1: 'asia',
};

let warnedMissingConfig = false;

export async function getLolProfile(riotId: string, platform: string): Promise<LolProfile | null> {
  if (!config.RIOT_API_KEY) {
    if (!warnedMissingConfig) {
      logger.info('Riot stats lookup was used but RIOT_API_KEY is not set — skipping.');
      warnedMissingConfig = true;
    }
    return null;
  }

  const [gameName, tagLine] = riotId.split('#');
  if (!gameName || !tagLine) return null;

  const regional = PLATFORM_TO_REGIONAL[platform] ?? 'americas';
  const headers = { 'X-Riot-Token': config.RIOT_API_KEY };

  const accountRes = await fetch(
    `https://${regional}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`,
    { headers },
  );
  if (!accountRes.ok) return null;
  const account = (await accountRes.json()) as { puuid: string };

  const summonerRes = await fetch(`https://${platform}.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/${account.puuid}`, { headers });
  if (!summonerRes.ok) return null;
  const summoner = (await summonerRes.json()) as { id: string; summonerLevel: number };

  const leagueRes = await fetch(`https://${platform}.api.riotgames.com/lol/league/v4/entries/by-summoner/${summoner.id}`, { headers });
  const leagueEntries = leagueRes.ok
    ? ((await leagueRes.json()) as { queueType: string; tier: string; rank: string; leaguePoints: number; wins: number; losses: number }[])
    : [];
  const soloQueue = leagueEntries.find((e) => e.queueType === 'RANKED_SOLO_5x5') ?? null;

  return {
    summonerLevel: summoner.summonerLevel,
    soloQueue: soloQueue
      ? { tier: soloQueue.tier, rank: soloQueue.rank, leaguePoints: soloQueue.leaguePoints, wins: soloQueue.wins, losses: soloQueue.losses }
      : null,
  };
}
