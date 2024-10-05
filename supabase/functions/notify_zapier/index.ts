/*
import { serve } from 'https://deno.land/std@0.101.0/http/server.ts'

console.log("Edge Function 'notify_zapier' is running")

serve(async (req) => {
  // Parse the incoming request data
  const { thread_id, phone_number, message_body, message_type } = await req.json()

  // Make the HTTP request to the Zapier webhook
  //const webhookUrl = process.env.ZAPIER_WEBHOOK_URL;
  const webhookUrl = Deno.env.get("ZAPIER_WEBHOOK_URL")
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
*/

import { serve } from 'https://deno.land/std@0.101.0/http/server.ts'

console.log("Edge Function 'notify_zapier' is running")

serve(async (req) => {
  let thread_id, phone_number, message_body, message_type;

  // Check if the content type is JSON or URL-encoded
  const contentType = req.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    const body = await req.json();
    thread_id = body.thread_id;
    phone_number = body.phone_number;
    message_body = body.message_body;
    message_type = body.message_type;
  } else if (contentType.includes("application/x-www-form-urlencoded")) {
    // Use URLSearchParams to parse the URL-encoded body
    const bodyText = await req.text();
    const body = new URLSearchParams(bodyText);
    thread_id = body.get('thread_id');
    phone_number = body.get('phone_number');
    message_body = body.get('message_body');
    message_type = body.get('message_type');
  }

  // Validate the parameters
  if (!thread_id || !phone_number || !message_body || !message_type) {
    return new Response("Missing parameters", { status: 400 });
  }

  // Make the HTTP request to the Zapier webhook
  const webhookUrl = Deno.env.get("ZAPIER_WEBHOOK_URL");
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
