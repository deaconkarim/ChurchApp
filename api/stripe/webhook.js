import Stripe from 'stripe';
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Set your Stripe webhook secret in .env
const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

// Log environment variables for debugging (without exposing secrets)
console.log('🔧 Environment check:', {
  hasStripeKey: !!process.env.STRIPE_SECRET_KEY,
  hasWebhookSecret: !!process.env.STRIPE_WEBHOOK_SECRET,
  hasSupabaseUrl: !!process.env.SUPABASE_URL,
  hasSupabaseKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY
});

export default async (req, res) => {
  console.log('🔔 Webhook received:', req.method, req.url);
  console.log('📋 Headers:', Object.keys(req.headers));
  
  // For Vercel, we might need to get the raw body differently
  const rawBody = req.rawBody || req.body;
  console.log('📦 Raw body available:', !!rawBody);
  console.log('📏 Body length:', rawBody ? rawBody.length : 'undefined');
  
  // Handle CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Stripe-Signature');

  if (req.method === 'OPTIONS') {
    console.log('✅ OPTIONS request handled');
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    console.log('❌ Invalid method:', req.method);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let event;
  try {
    const sig = req.headers['stripe-signature'];
    console.log('🔐 Stripe signature present:', !!sig);
    console.log('🔑 Endpoint secret configured:', !!endpointSecret);
    console.log('📏 Request body length:', req.rawBody ? req.rawBody.length : 'undefined');
    
    if (!endpointSecret) {
      console.log('❌ No webhook secret configured');
      return res.status(500).json({ error: 'Webhook secret not configured' });
    }
    
    if (!sig) {
      console.log('❌ No Stripe signature in headers');
      return res.status(400).json({ error: 'No Stripe signature' });
    }
    
    if (!rawBody) {
      console.log('❌ No raw body available');
      return res.status(400).json({ error: 'No request body' });
    }
    
    console.log('🔍 Attempting to verify webhook signature...');
    event = stripe.webhooks.constructEvent(rawBody, sig, endpointSecret);
    console.log('✅ Webhook signature verified, event type:', event.type);
  } catch (err) {
    console.error('❌ Webhook signature verification failed:', err.message);
    console.error('🔍 Error details:', {
      hasSignature: !!req.headers['stripe-signature'],
      hasBody: !!req.rawBody,
      hasSecret: !!endpointSecret,
      errorType: err.constructor.name
    });
    return res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }

  if (event.type === 'checkout.session.completed') {
    console.log('💰 Processing checkout.session.completed event');
    
    try {
      const session = event.data.object;
      const metadata = session.metadata || {};
      const amount = session.amount_total / 100;
      const organization_id = metadata.organization_id;
      const fund_designation = metadata.fund_designation || null;
      const campaign_id = metadata.campaign_id || null;
      const donor_email = session.customer_email;
      const payment_method = 'stripe';
      const date = new Date().toISOString().split('T')[0];

      // Handle fee coverage metadata
      const original_amount = metadata.original_amount ? parseFloat(metadata.original_amount) / 100 : amount;
      const fee_amount = metadata.fee_amount ? parseFloat(metadata.fee_amount) / 100 : 0;
      const cover_fees = metadata.cover_fees === 'true';

      console.log(`📊 Processing donation for church ID: ${organization_id}, Amount: $${amount}, Email: ${donor_email}`);
      console.log(`💸 Fee details - Original: $${original_amount}, Fee: $${fee_amount}, Cover fees: ${cover_fees}`);
      console.log('📋 Session metadata:', metadata);

      // Get church name for logging
      const { data: org } = await supabase
        .from('organizations')
        .select('name')
        .eq('id', organization_id)
        .single();

      if (org) {
        console.log(`🏛️  Donation for church: ${org.name}`);
      }

      // Optionally, look up donor/member by email
      let donor_id = null;
      if (donor_email) {
        const { data: member, error: memberError } = await supabase
          .from('members')
          .select('id')
          .eq('email', donor_email)
          .eq('organization_id', organization_id)
          .single();
        if (!memberError && member) {
          donor_id = member.id;
          console.log(`👤 Found existing member: ${donor_id}`);
        }
      }

      // Insert donation record
      console.log('💾 Inserting donation record...');
      const { error: insertError } = await supabase.from('donations').insert({
        organization_id,
        donor_id,
        amount: original_amount, // Store the original amount (what church receives)
        date,
        fund_designation,
        campaign_id,
        payment_method,
        is_tax_deductible: true,
        notes: `Stripe Connect donation${cover_fees ? ' (fees covered by donor)' : ''}`,
        metadata: {
          ...session,
          original_amount: original_amount,
          fee_amount: fee_amount,
          cover_fees: cover_fees,
          total_paid: amount
        },
      });

      if (insertError) {
        console.error('❌ Error inserting donation:', insertError);
        throw new Error(`Database error: ${insertError.message}`);
      } else {
        console.log(`✅ Successfully recorded donation for church: ${org?.name || organization_id}`);
        console.log(`💰 Church receives: $${original_amount}, Donor paid: $${amount}`);
      }
    } catch (error) {
      console.error('💥 Error processing donation:', error);
      return res.status(500).json({ error: 'Failed to process donation', details: error.message });
    }
  }

  console.log('✅ Webhook processed successfully');
  res.json({ received: true });
};