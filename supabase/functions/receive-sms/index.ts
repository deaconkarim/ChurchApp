import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Parse form data from Twilio webhook
    const formData = await req.formData()
    const from = formData.get('From') as string
    const to = formData.get('To') as string
    const body = formData.get('Body') as string
    const messageSid = formData.get('MessageSid') as string

    // Initialize Supabase client
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') || '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    )

    // Find member by phone number
    const { data: member, error: memberError } = await supabaseClient
      .from('members')
      .select('id, firstname, lastname')
      .eq('phone', from)
      .single()

    // Create or find conversation
    let conversationId = null
    if (member) {
      // Look for existing conversation with this member
      const { data: existingConversation } = await supabaseClient
        .from('sms_conversations')
        .select('id')
        .eq('conversation_type', 'general')
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(1)
        .single()

      if (existingConversation) {
        conversationId = existingConversation.id
      } else {
        // Create new conversation
        const { data: newConversation } = await supabaseClient
          .from('sms_conversations')
          .insert({
            title: `SMS with ${member.firstname} ${member.lastname}`,
            conversation_type: 'general',
            status: 'active'
          })
          .select('id')
          .single()

        conversationId = newConversation?.id
      }
    }

    // Store incoming message
    const { data: message, error: messageError } = await supabaseClient
      .from('sms_messages')
      .insert({
        twilio_sid: messageSid,
        direction: 'inbound',
        from_number: from,
        to_number: to,
        body: body,
        status: 'delivered',
        member_id: member?.id || null,
        conversation_id: conversationId,
        delivered_at: new Date().toISOString()
      })
      .select()
      .single()

    if (messageError) throw messageError

    // Return TwiML response (optional auto-reply)
    const twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>Thank you for your message. We'll get back to you soon.</Message>
</Response>`

    return new Response(twimlResponse, {
      headers: { 
        ...corsHeaders, 
        'Content-Type': 'text/xml' 
      }
    })

  } catch (error) {
    console.error('SMS receiving error:', error)
    
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )
  }
}) 