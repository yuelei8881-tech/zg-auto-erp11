// Legacy display only. New orders require an explicit technician confirmation.
export function legacyOilChangeCompleted(text: string | undefined): boolean {
  const value = (text || '').toLowerCase();
  return /(换\s*机油|更换\s*(发动机)?机油|oil[\s-]*change|change\s+(engine\s+|motor\s+)?oil)/.test(value)
    && !/(未|没有|不|无需|取消|拒绝|待|建议|计划|not|no\s|declin|cancel|recommend|pending|defer)/.test(value);
}

export function rewardReadyForRedemption(reward: { status: string; enrollmentStatus: string; qualifying_count: number; reward_earned_at?: string | null; reward_expires_at?: string | null; reward_redeemed_at?: string | null } | null, now = Date.now()): boolean {
  return Boolean(reward && reward.status === 'active' && reward.enrollmentStatus === 'approved'
    && reward.qualifying_count >= 5 && reward.reward_earned_at && !reward.reward_redeemed_at
    && (!reward.reward_expires_at || new Date(reward.reward_expires_at).getTime() >= now));
}
