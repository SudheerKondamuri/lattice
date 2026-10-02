import type { Config } from './config.js';
import type { Database, Tx } from './db.js';
import { AppError } from './errors.js';
import type { UsageKind } from '../../src/contracts/api.js';
export const PLANS = {
  trial: { replies: 100, checks: 50, sourcePages: 50, ocrPages: 10, members: 2 },
  starter: { replies: 1000, checks: 200, sourcePages: 250, ocrPages: 100, members: 2 },
  growth: { replies: 4000, checks: 500, sourcePages: 1000, ocrPages: 250, members: 5 },
};
export async function usage(tx: Tx, w: string) {
  const subscription = await tx.must('SELECT * FROM subscriptions WHERE workspace_id=$1', [w]);
  const workspace = await tx.must('SELECT spend_limit FROM workspaces WHERE id=$1', [w]);
  const rows = await tx.rows(
    `SELECT kind,state,sum(units)::int units,coalesce(sum(spent_micros),0)::float8 spent,coalesce(sum(reserve_micros),0)::float8 reserve FROM usage_events WHERE workspace_id=$1 AND period_start=$2 GROUP BY kind,state`,
    [w, subscription.periodStart],
  );
  const used: Record<UsageKind, number> = { reply: 0, check: 0, embedding: 0, ocr: 0, preview: 0 };
  const reserved = { ...used };
  let spentMicros = 0,
    reservedMicros = 0;
  for (const row of rows) {
    spentMicros += row.spent;
    if (row.state === 'committed') used[row.kind as UsageKind] += row.units;
    if (row.state === 'reserved') {
      reserved[row.kind as UsageKind] += row.units;
      reservedMicros += row.reserve;
    }
  }
  return {
    periodStart: subscription.periodStart,
    periodEnd: subscription.periodEnd,
    plan: subscription.plan as keyof typeof PLANS,
    status: subscription.status,
    limits: PLANS[subscription.plan as keyof typeof PLANS],
    used,
    reserved,
    spentMicros,
    reservedMicros,
    monthlySpendLimitMicros: Number(workspace.spendLimit),
    automaticOverages: false as const,
  };
}
export async function reserve(
  tx: Tx,
  w: string,
  key: string,
  kind: UsageKind,
  micros: number,
  config: Config,
  units = 1,
) {
  const existing = await tx.one('SELECT * FROM usage_events WHERE workspace_id=$1 AND operation_key=$2', [
    w,
    key,
  ]);
  if (existing)
    throw new AppError(
      'OPERATION_ALREADY_ATTEMPTED',
      'This paid operation has already been attempted; retry with a new operation only after inspecting its status',
      409,
    );
  const current = await usage(tx, w);
  if (!['active', 'trialing'].includes(current.status) || new Date(current.periodEnd).getTime() <= Date.now())
    throw new AppError(
      'SUBSCRIPTION_REQUIRED',
      'Trial or subscription has ended; contact the support email shown by the widget',
      429,
    );
  const allowance =
    kind === 'reply'
      ? current.limits.replies
      : kind === 'check'
        ? current.limits.checks
        : kind === 'ocr'
          ? current.limits.ocrPages
          : Infinity;
  if (current.used[kind] + current.reserved[kind] + units > allowance)
    throw new AppError('QUOTA_EXHAUSTED', `${kind} allowance exhausted. Contact support by email.`, 429);
  if (current.spentMicros + current.reservedMicros + micros > current.monthlySpendLimitMicros)
    throw new AppError('SPEND_LIMIT', 'Workspace spending cap reached; contact support by email', 429);
  await tx.exec('INSERT INTO spend_days(day) VALUES(current_date) ON CONFLICT DO NOTHING');
  const global = await tx.must('SELECT * FROM spend_days WHERE day=current_date FOR UPDATE');
  if (Number(global.reservedMicros) + Number(global.spentMicros) + micros > config.GLOBAL_DAILY_SPEND_MICROS)
    throw new AppError('SPEND_LIMIT', 'Service spending cap reached; contact support by email', 429);
  await tx.exec('UPDATE spend_days SET reserved_micros=reserved_micros+$1 WHERE day=current_date', [micros]);
  return tx.must(
    "INSERT INTO usage_events(workspace_id,operation_key,kind,state,units,reserve_micros,period_start) VALUES($1,$2,$3,'reserved',$4,$5,$6) RETURNING *",
    [w, key, kind, units, micros, current.periodStart],
  );
}
export async function settle(tx: Tx, w: string, key: string, completed: boolean, spent: number) {
  const row = await tx.one(
    'SELECT * FROM usage_events WHERE workspace_id=$1 AND operation_key=$2 FOR UPDATE',
    [w, key],
  );
  if (!row || row.state !== 'reserved') return;
  const cost = Math.max(0, Math.ceil(spent));
  await tx.exec(
    'UPDATE usage_events SET state=$3,spent_micros=$4 WHERE workspace_id=$1 AND operation_key=$2',
    [w, key, completed ? 'committed' : 'released', cost],
  );
  await tx.exec(
    'UPDATE spend_days SET reserved_micros=greatest(0,reserved_micros-$1),spent_micros=spent_micros+$2 WHERE day=$3::timestamptz::date',
    [Number(row.reserveMicros), cost, row.createdAt],
  );
}
/** Unknown provider outcomes consume the conservative spend reserve, but never a completed reply unit. */
export async function budgeted<T>(
  db: Database,
  config: Config,
  w: string,
  key: string,
  kind: UsageKind,
  micros: number,
  operation: () => Promise<{ value: T; cost: number; units?: number }>,
  units = 1,
): Promise<T> {
  await db.tenant(w, (tx) => reserve(tx, w, key, kind, micros, config, units));
  try {
    const result = await operation();
    await db.tenant(w, async (tx) => {
      if (result.units !== undefined)
        await tx.exec(
          "UPDATE usage_events SET units=$3 WHERE workspace_id=$1 AND operation_key=$2 AND state='reserved'",
          [w, key, result.units],
        );
      await settle(tx, w, key, true, result.cost);
    });
    return result.value;
  } catch (error) {
    await db.tenant(w, (tx) =>
      settle(
        tx,
        w,
        key,
        false,
        error instanceof AppError && ['CONFIGURATION_ERROR', 'CONTEXT_LIMIT'].includes(error.code)
          ? 0
          : micros,
      ),
    );
    throw error;
  }
}
