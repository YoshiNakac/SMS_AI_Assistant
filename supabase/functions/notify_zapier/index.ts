import { serve } from 'https://deno.land/std@0.101.0/http/server.ts'

console.log("Edge Function 'notify_zapier' is running")

serve(async (req) => {
  // Parse the incoming request data
  const { thread_id, phone_number, message_body, message_type } = await req.json()

  // Make the HTTP request to the Zapier webhook
  const webhookUrl = 'https://hooks.zapier.com/hooks/catch/8456939/2mzjay1/';
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      thread_id,
      phone_number,
      message_body,
      message_type
    })
  });

  const result = await response.text();

  return new Response(result, {
    headers: { 'Content-Type': 'application/json' },
  });
});

