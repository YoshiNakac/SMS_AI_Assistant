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
const OpenAI = require('openai'); // OpenAI API for generating responses

dotenv.config(); // Load environment variables from the .env file

app.use(cookieParser());
app.use(express.json()); // Middleware to parse JSON bodies in requests
app.use(express.urlencoded({ extended: true })); // Middleware to parse URL-encoded bodies (as sent by HTML forms))
app.use(cors()); // Enable CORS

// Supabase Client Initialization
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// Twilio Client Initialization
const twilioClient = new TwilioClient(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

// OpenAI Client Initialization
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY // Ensure you have your OpenAI API key in .env
});

// Default route to test the server
app.get('/', (req, res) => {
  res.send('Server is running!'); // Send a response when the root URL is accessed
});

// Receive incoming SMS messages from Twilio
app.post('/smsIncomingMessage', async (req, res) => {
  const { Body: messageBody, From: phoneNumber } = req.body;

  try {
    // Check if there's an existing thread based on phone number
    let { data: thread, error } = await supabase
      .from('threads')
      .select('id')
      .eq('phone_number', phoneNumber)
      .single();

    let thread_id;

    // If no thread exists, create one
    if (!thread) {
      let { data: newThread, error: threadError } = await supabase
        .from('threads')
        .insert([{ phone_number: phoneNumber }])
        .select()
        .single();

      if (threadError || !newThread) {
        console.error('Error creating new thread:', threadError);
        return res.status(500).send({ error: 'Failed to create new thread' });
      }
      
      thread_id = newThread.id;
    } else {
      thread_id = thread.id;
    }

    // Log the incoming message in the "messages" table
    await supabase.from('messages').insert({
      thread_id,
      phone_number: phoneNumber,
      message_body: messageBody,
      message_type: 'inbound',
    });

    // Generate a response using the OpenAI Assistant
    const openaiResponse = await runAssistant(thread_id, messageBody, process.env.assistant_id); // Using your assistant_id

    const responseMessage = openaiResponse.threadMessages.data[0].content[0].text.value;

    // Log the outgoing response in the "messages" table
    await supabase.from('messages').insert({
      thread_id,
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

// Function to run the OpenAI Assistant
async function runAssistant(sThread, sMessage, sAssistant) {
  // Check if it's a new conversation or an existing thread
  if (!sThread) {
    let oThread = await openai.beta.threads.create();
    sThread = oThread.id;
  }

  // Add a message to the thread
  await openai.beta.threads.messages.create(sThread, {
    role: 'user',
    content: sMessage
  });

  // Run the assistant with the provided thread
  let run = await openai.beta.threads.runs.create(sThread, {
    assistant_id: sAssistant
  });

  // Wait for the run to complete
  await waitForRunComplete(sThread, run.id);

  // Retrieve messages from the thread
  const threadMessages = await openai.beta.threads.messages.list(sThread);

  return {
    threadMessages: threadMessages,
    sThread: sThread
  };
}

// Helper function to wait for the assistant run to complete
async function waitForRunComplete(sThreadId, sRunId) {
  while (true) {
    const oRun = await openai.beta.threads.runs.retrieve(sThreadId, sRunId);
    if (
      oRun.status &&
      (oRun.status === 'completed' || oRun.status === 'failed' || oRun.status === 'requires_action')
    ) {
      break;
    }
    await new Promise(resolve => setTimeout(resolve, 1000)); // 1-second delay
  }
}

// Send a message using Zapier and OpenPhone
app.post('/send_message_zapier', async (req, res) => {
  const { user_number, message_body } = req.body;

  try {
    // Find thread based on phone number
    let { data: thread, error } = await supabase
      .from('threads')
      .select('id')
      .eq('phone_number', user_number)
      .single();

    if (!thread) {
      return res.status(404).json({ error: 'Thread not found' });
    }

    const thread_id = thread.id;

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
      thread_id,
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
