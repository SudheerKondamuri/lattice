import Stripe from 'stripe';
import type { Config } from './config.js';
import type { Database, Tx } from './db.js';
import { AppError, configured } from './errors.js';
export function stripeClient(config: Config) {
  return new Stripe(configured(config.STRIPE_SECRET_KEY, 'STRIPE_SECRET_KEY'), {
    maxNetworkRetries: 0,
    timeout: 15000,
    httpClient: Stripe.createFetchHttpClient(),
  });
}
export async function checkout(tx: Tx, w: string, plan: 'starter' | 'growth', key: string, config: Config) {
  const stripe = stripeClient(config);
  const subscription = await tx.must('SELECT * FROM subscriptions WHERE workspace_id=$1', [w]);
  if (
    subscription.subscriptionId &&
    ['active', 'trialing'].includes(subscription.status) &&
    subscription.plan !== 'trial'
  )
    throw new AppError(
      'SUBSCRIPTION_EXISTS',
      'Use the billing portal to change the existing subscription',
      409,
    );
  let customerId = subscription.customerId;
  if (!customerId) {
    const customer = await stripe.customers.create(
      { metadata: { workspaceId: w } },
      { idempotencyKey: `workspace-customer-${w}` },
    );
    customerId = customer.id;
    await tx.exec('UPDATE subscriptions SET customer_id=$2 WHERE workspace_id=$1', [w, customerId]);
  }
  const price = configured(
    plan === 'starter' ? config.STRIPE_STARTER_PRICE_ID : config.STRIPE_GROWTH_PRICE_ID,
    `STRIPE_${plan.toUpperCase()}_PRICE_ID`,
  );
  const workspaceParam = encodeURIComponent(w);
  const session = await stripe.checkout.sessions.create(
    {
      customer: customerId,
      mode: 'subscription',
      line_items: [{ price, quantity: 1 }],
      subscription_data: { metadata: { workspaceId: w } },
      success_url: `${config.APP_ORIGIN}/settings?workspace=${workspaceParam}&billing=success`,
      cancel_url: `${config.APP_ORIGIN}/settings?workspace=${workspaceParam}&billing=cancelled`,
      allow_promotion_codes: false,
    },
    { idempotencyKey: `checkout-${w}-${key}` },
  );
  return { url: session.url };
}
export async function applyStripeEvent(
  db: Database,
  config: Config,
  event: Stripe.Event,
  reconcile?: (id: string) => Promise<Stripe.Subscription>,
) {
  return db.system(async (tx) => {
    // Serialized global billing inbox protects replay and competing subscription deliveries.
    await tx.exec('SELECT pg_advisory_xact_lock(18743102)');
    if (await tx.one('SELECT id FROM stripe_events WHERE id=$1', [event.id]))
      return { received: true, replayed: true };
    if (
      [
        'customer.subscription.created',
        'customer.subscription.updated',
        'customer.subscription.deleted',
      ].includes(event.type)
    ) {
      // Refetch inside the serialized inbox transaction. Stripe event timestamps have only
      // second resolution; arrival order alone cannot safely resolve same-second updates.
      const value = reconcile
        ? await reconcile((event.data.object as Stripe.Subscription).id)
        : (event.data.object as Stripe.Subscription);
      const customer = typeof value.customer === 'string' ? value.customer : value.customer.id;
      const mapping = await tx.one('SELECT workspace_id FROM subscriptions WHERE customer_id=$1', [customer]);
      if (mapping) await tx.exec('SELECT id FROM workspaces WHERE id=$1 FOR UPDATE', [mapping.workspaceId]);
      const row = await tx.one('SELECT * FROM subscriptions WHERE customer_id=$1 FOR UPDATE', [customer]);
      if (!row)
        throw new AppError(
          'WEBHOOK_CUSTOMER_UNKNOWN',
          'Subscription customer has not been linked to a workspace',
          409,
        );
      if (event.created >= Number(row.webhookCreated)) {
        if (row.subscriptionId && row.subscriptionId !== value.id && row.status === 'active')
          throw new AppError('SUBSCRIPTION_CONFLICT', 'Different active subscription already linked', 409);
        const item = value.items.data[0];
        const price = item?.price.id;
        const plan =
          price === config.STRIPE_STARTER_PRICE_ID
            ? 'starter'
            : price === config.STRIPE_GROWTH_PRICE_ID
              ? 'growth'
              : null;
        if (!plan || value.items.data.length !== 1 || item.quantity !== 1)
          throw new AppError('UNSUPPORTED_PRICE', 'Webhook references an unconfigured plan');
        await tx.exec(
          'UPDATE subscriptions SET plan=$2,status=$3,subscription_id=$4,period_start=to_timestamp($5),period_end=to_timestamp($6),webhook_created=$7 WHERE workspace_id=$1',
          [
            row.workspaceId,
            plan,
            event.type === 'customer.subscription.deleted' ? 'canceled' : value.status,
            value.id,
            item.current_period_start,
            item.current_period_end,
            event.created,
          ],
        );
      }
    }
    await tx.exec('INSERT INTO stripe_events(id,type,created) VALUES($1,$2,$3)', [
      event.id,
      event.type,
      event.created,
    ]);
    return { received: true, replayed: false };
  });
}
