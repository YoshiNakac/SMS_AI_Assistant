// Import necessary libraries
const express = require('express'); // Express framework for building web applications
const app = express(); // Initialize an Express application
const port = 3000; // Define the port number on which the server will listen
const { MessagingResponse } = require('twilio').twiml; // Import the MessagingResponse module from the 'twilio' package
const cookieParser = require('cookie-parser'); // Import and use the cookie-parser middleware
const { createClient } = require('@supabase/supabase-js'); // Supabase Client
const TwilioClient = require('twilio').Twilio; // Twilio Client for sending messages
const dotenv = require('dotenv'); // Load environment variables
const cors = require('cors'); // Enable CORS
const axios = require('axios'); // For making requests (Zapier)
dotenv.config(); // Load environment variables from the .env file

app.use(cookieParser());
app.use(express.json()); // Middleware to parse JSON bodies in requests
app.use(express.urlencoded({ extended: true })); // Middleware to parse URL-encoded bodies (as sent by HTML forms))
app.use(cors()); // Enable CORS

// Supabase Client Initialization
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// Twilio Client Initialization
const twilioClient = new TwilioClient(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

// Default route to test the server
app.get('/', (req, res) => {
  res.send('Server is running!'); // Send a response when the root URL is accessed
});

// Receive incoming SMS messages from Twilio
app.post('/smsIncomingMessage', async (req, res) => {
  const { Body: messageBody, From: phoneNumber } = req.body;

  try {
    // Check if there's an existing conversation
    let { data: conversation, error } = await supabase
      .from('conversations')
      .select('id')
      .eq('phone_number', phoneNumber)
      .single();

    let conversation_id;

    // If no conversation exists, create one
    if (!conversation) {
      let { data: newConversation, error: conversationError } = await supabase
        .from('conversations')
        .insert([{ phone_number: phoneNumber }])
        .select()
        .single();
      conversation_id = newConversation.id;
    } else {
      conversation_id = conversation.id;
    }

    // Log the incoming message in the "messages" table
    await supabase.from('messages').insert({
      conversation_id,
      phone_number: phoneNumber,
      message_body: messageBody,
      message_type: 'inbound',
    });

    // Generate response (placeholder for now, can integrate OpenAI or custom logic)
    const responseMessage = "Thank you for your message. We'll get back to you shortly.";

    // Log the outgoing response in the "messages" table
    await supabase.from('messages').insert({
      conversation_id,
      phone_number: phoneNumber,
      message_body: responseMessage,
      message_type: 'outbound',
    });

    // Send response back via Twilio
    const twiml = new MessagingResponse();
    const message = twiml.message();
    message.body(responseMessage);
    res.writeHead(200, { 'Content-Type': 'text/xml' });
    res.end(twiml.toString());

  } catch (error) {
    console.error('Error handling incoming message:', error);
    res.status(500).send({ error: 'Failed to process incoming message' });
  }
});

// Send a message using Zapier and OpenPhone
app.post('/send_message_zapier', async (req, res) => {
  const { user_number, message_body } = req.body;

  try {
    // Find conversation based on phone number
    let { data: conversation, error } = await supabase
      .from('conversations')
      .select('id')
      .eq('phone_number', user_number)
      .single();

    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    const conversation_id = conversation.id;

    // Create payload for Zapier (for OpenPhone)
    const payload = {
      user_number,
      message_body,
      from: process.env.OPENPHONE_NUMBER // Ensure your OpenPhone number is set in .env
    };

    // Send request to Zapier webhook, which sends via OpenPhone
    const zapierWebhookUrl = process.env.ZAPIER_WEBHOOK_URL;
    const zapierResponse = await axios.post(zapierWebhookUrl, payload);

    if (zapierResponse.status !== 200) {
      return res.status(zapierResponse.status).json({ error: 'Failed to send message via OpenPhone' });
    }

    // Log the outgoing message in Supabase
    await supabase.from('messages').insert({
      conversation_id,
      phone_number: user_number,
      message_body,
      message_type: 'outbound',
    });

    res.json({ response: 'Message sent successfully via OpenPhone (Zapier)' });

  } catch (error) {
    console.error('Error sending message via OpenPhone (Zapier):', error);
    res.status(500).json({ error: 'Failed to send message via OpenPhone (Zapier)' });
  }
});

// Start the server and listen on the specified port
app.listen(port, () => {
  console.log(`App running on port ${port}`);
});
