// src/lib/bots.ts
// Fictional Bot Franchise Identity Pool & Utilities for Mega Auction Arena

export interface BotFranchise {
  id: string;
  name: string;
  shortName: string;
  color: string;
  managerName: string;
}

// Exactly 9 Fictional Bot Franchise Identities (Zero IPL Copyright / IP violations)
export const BOT_FRANCHISE_POOL: BotFranchise[] = [
  {
    id: 'bot-hk',
    name: 'Hyderabad Kakatiyas',
    shortName: 'HK',
    color: '#E65100',
    managerName: 'Aarav',
  },
  {
    id: 'bot-cc',
    name: 'Chennai Cholas',
    shortName: 'CC',
    color: '#F57C00',
    managerName: 'Kabir',
  },
  {
    id: 'bot-pm',
    name: 'Punjab Maharajas',
    shortName: 'PM',
    color: '#D32F2F',
    managerName: 'Vihaan',
  },
  {
    id: 'bot-rr',
    name: 'Rajasthan Rajputs',
    shortName: 'RR',
    color: '#C2185B',
    managerName: 'Arjun',
  },
  {
    id: 'bot-gs',
    name: 'Gujarat Solankis',
    shortName: 'GS',
    color: '#00838F',
    managerName: 'Reyansh',
  },
  {
    id: 'bot-km',
    name: 'Kolkata Mauryas',
    shortName: 'KM',
    color: '#6A1B9A',
    managerName: 'Advik',
  },
  {
    id: 'bot-mm',
    name: 'Mumbai Marathas',
    shortName: 'MM',
    color: '#1565C0',
    managerName: 'Rohan',
  },
  {
    id: 'bot-bc',
    name: 'Bengaluru Chalukyas',
    shortName: 'BC',
    color: '#2E7D32',
    managerName: 'Ishaan',
  },
  {
    id: 'bot-dm',
    name: 'Delhi Mughals',
    shortName: 'DM',
    color: '#4E342E',
    managerName: 'Dev',
  },
];

/**
 * Shuffles the bot pool ONCE and picks N unique bot franchise identities for room creation.
 * Guarantees zero duplicate bot franchises and zero duplicate manager names per room.
 */
export function getUniqueBotIdentities(count: number, excludeNames: string[] = []): BotFranchise[] {
  if (count <= 0) return [];
  const boundedCount = Math.min(9, Math.max(0, count));

  // Filter out any identity matching host's team name or excluded names
  const availablePool = BOT_FRANCHISE_POOL.filter(
    (bot) => !excludeNames.some((ex) => ex.trim().toLowerCase() === bot.name.trim().toLowerCase())
  );

  // Single Fisher-Yates Shuffle
  const shuffled = [...availablePool];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const itemI = shuffled[i];
    const itemJ = shuffled[j];
    if (itemI && itemJ) {
      shuffled[i] = itemJ;
      shuffled[j] = itemI;
    }
  }

  return shuffled.slice(0, boundedCount);
}
