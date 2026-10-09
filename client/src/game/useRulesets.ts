import { useEffect, useState } from 'react';

export interface RulesetInfo {
  id: string;
  name: string;
  description: string;
  reverseTrumpSupported: boolean;
}

const FALLBACK: RulesetInfo[] = [{ id: 'classic', name: 'Classic 29', description: '', reverseTrumpSupported: true }];

/** Rulesets come from the server (rulesConfig.ts is the single source of truth). */
export function useRulesets(): RulesetInfo[] {
  const [list, setList] = useState<RulesetInfo[]>(FALLBACK);
  useEffect(() => {
    const base = (import.meta.env.VITE_SERVER_URL as string | undefined) ?? '';
    fetch(`${base}/api/rulesets`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data: RulesetInfo[]) => Array.isArray(data) && data.length && setList(data))
      .catch(() => undefined);
  }, []);
  return list;
}
