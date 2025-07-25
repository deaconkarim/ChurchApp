import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  // Handle CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { organization_id, email } = req.body;
  if (!organization_id || !email) {
    return res.status(400).json({ error: 'Missing organization_id or email' });
  }

  // Check if org already has a stripe_account_id
  const { data: org, error: orgError } = await supabase
    .from('organizations')
    .select('stripe_account_id')
    .eq('id', organization_id)
    .single();
  if (orgError) return res.status(500).json({ error: orgError.message });

  let accountId = org?.stripe_account_id;
  if (!accountId) {
    // Create Stripe Connect Express account
    const account = await stripe.accounts.create({
      type: 'express',
      email,
      capabilities: { transfers: { requested: true } }
    });
    accountId = account.id;
    // Store in Supabase
    const { error: updateError } = await supabase
      .from('organizations')
      .update({ stripe_account_id: accountId })
      .eq('id', organization_id);
    if (updateError) return res.status(500).json({ error: updateError.message });
  }

  // Create onboarding link
  const origin = req.headers.origin || 'https://getdeacon.com';
  const accountLink = await stripe.accountLinks.create({
    account: accountId,
    refresh_url: `${origin}/settings?onboard=refresh`,
    return_url: `${origin}/settings?onboard=success`,
    type: 'account_onboarding',
  });

  res.json({ url: accountLink.url });
}