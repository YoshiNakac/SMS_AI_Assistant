// Import necessary libraries
const express = require('express'); // Express framework for building web applications
const app = express(); // Initialize an Express application
const port = 3000; // Define the port number on which the server will listen
const cookieParser = require('cookie-parser'); // Import and use the cookie-parser middleware
const { createClient } = require('@supabase/supabase-js'); // Supabase Client
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

// Default route to test the server
app.get('/', (req, res) => {
  res.send('Server is running!'); // Send a response when the root URL is accessed
});

// Handle incoming messages from OpenPhone (via Zapier)
app.post('/openphoneInbound', async (req, res) => {
  const { message_body, phone_number } = req.body;

  try {
    // Log the incoming message in the "messages" table
    let { data: thread, error } = await supabase
      .from('threads')
      .select('id')
      .eq('phone_number', phone_number)
      .single();

    let thread_id;

    // If no thread exists, create one
    if (!thread) {
      let { data: newThread, error: threadError } = await supabase
        .from('threads')
        .insert([{ phone_number: phone_number }])
        .select()
        .single();
      thread_id = newThread.id;
    } else {
      thread_id = thread.id;
    }

    await supabase.from('messages').insert({
      thread_id,
      phone_number: phone_number,
      message_body: message_body,
      message_type: 'inbound',
    });

    // Log the message and send a response to Zapier if needed
    res.json({ response: 'Inbound message logged successfully.' });

  } catch (error) {
    console.error('Error handling incoming message:', error);
    res.status(500).send({ error: 'Failed to process incoming message' });
  }
});

// Handle outbound messages via OpenPhone and Zapier
app.post('/send_message_zapier', async (req, res) => {
  const { user_number, message_body } = req.body;

  try {
    // Find the conversation thread
    let { data: thread, error } = await supabase
      .from('threads')
      .select('id')
      .eq('phone_number', user_number)
      .single();

    if (!thread) {
      return res.status(404).json({ error: 'Thread not found' });
    }

    const thread_id = thread.id;

    // Log the outbound message in the database
    await supabase.from('messages').insert({
      thread_id,
      phone_number: user_number,
      message_body,
      message_type: 'outbound',
    });

    // Trigger the Outbound Zap via webhook to Zapier (to send via OpenPhone)
    const zapierWebhookUrl = process.env.ZAPIER_WEBHOOK_URL_OUTBOUND;
    const payload = {
      thread_id: thread_id,
      phone_number: user_number,
      message_body: message_body,
      message_type: 'outbound'
    };

    const zapierResponse = await axios.post(zapierWebhookUrl, payload);

    if (zapierResponse.status !== 200) {
      console.error('Failed to trigger Outbound Zap:', zapierResponse.status);
      return res.status(500).json({ error: 'Failed to trigger Outbound Zap' });
    }

    res.json({ response: 'Message sent successfully via OpenPhone and logged in database.' });

  } catch (error) {
    console.error('Error sending message via Zapier:', error);
    res.status(500).json({ error: 'Failed to send message via Zapier' });
  }
});

// Start the server and listen on the specified port
app.listen(port, () => {
  console.log(`App running on port ${port}`);
});
