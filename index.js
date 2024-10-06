// Import necessary libraries
const express = require('express'); // Express framework for building web applications
const app = express(); // Initialize an Express application
const port = 3000; // Define the port number on which the server will listen
const cookieParser = require('cookie-parser'); // Import and use the cookie-parser middleware
const { createClient } = require('@supabase/supabase-js'); // Supabase Client
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
      .select('id, openai_thread_id') // Select both Supabase thread ID and OpenAI thread ID
      .eq('phone_number', phoneNumber)
      .single();

    let thread_id, openai_thread_id;

    // If no thread exists, create one in Supabase and OpenAI
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

      // Create a new OpenAI thread for this conversation
      let oThread = await openai.beta.threads.create();
      openai_thread_id = oThread.id;

      // Update Supabase with the OpenAI thread ID
      await supabase
        .from('threads')
        .update({ openai_thread_id: openai_thread_id })
        .eq('id', thread_id);
    } else {
      // Use existing thread IDs
      thread_id = thread.id;
      openai_thread_id = thread.openai_thread_id;
    }

    // Log the incoming message in the "messages" table
    await supabase.from('messages').insert({
      thread_id,
      phone_number: phoneNumber,
      message_body: messageBody,
      message_type: 'inbound',
    });

    // Generate a response using the OpenAI Assistant with the correct OpenAI thread ID
    const openaiResponse = await runAssistant(openai_thread_id, messageBody, process.env.assistant_id);

    const responseMessage = openaiResponse.threadMessages.data[0].content[0].text.value;

    // Log the outgoing response in the "messages" table
    await supabase.from('messages').insert({
      thread_id,
      phone_number: phoneNumber,
      message_body: responseMessage,
      message_type: 'outbound',
    });

    // Send the response message via OpenPhone using Zapier
    const zapierWebhookUrl = process.env.ZAPIER_WEBHOOK_URL;
    const payload = {
      user_number: phoneNumber,
      message_body: responseMessage,
      from: process.env.OPENPHONE_NUMBER // Ensure your OpenPhone number is set in .env
    };

    const zapierResponse = await axios.post(zapierWebhookUrl, payload);

    if (zapierResponse.status !== 200) {
      console.error('Failed to send message via OpenPhone:', zapierResponse.status);
      return res.status(500).json({ error: 'Failed to send message via OpenPhone' });
    }

    res.json({ response: 'Message sent successfully via OpenPhone' });

  } catch (error) {
    console.error('Error handling incoming message:', error);
    res.status(500).send({ error: 'Failed to process incoming message' });
  }
});

// Function to run the OpenAI Assistant
async function runAssistant(openai_thread_id, messageBody, assistant_id) {
  // Add a message to the OpenAI thread
  await openai.beta.threads.messages.create(openai_thread_id, {
    role: 'user',
    content: messageBody
  });

  // Run the assistant with the provided OpenAI thread
  let run = await openai.beta.threads.runs.create(openai_thread_id, {
    assistant_id: assistant_id
  });

  // Wait for the run to complete
  await waitForRunComplete(openai_thread_id, run.id);

  // Retrieve messages from the OpenAI thread
  const threadMessages = await openai.beta.threads.messages.list(openai_thread_id);

  return {
    threadMessages: threadMessages,
    openai_thread_id: openai_thread_id
  };
}

// Helper function to wait for the assistant run to complete
async function waitForRunComplete(openai_thread_id, sRunId) {
  while (true) {
    const oRun = await openai.beta.threads.runs.retrieve(openai_thread_id, sRunId);
    if (
      oRun.status &&
      (oRun.status === 'completed' || oRun.status === 'failed' || oRun.status === 'requires_action')
    ) {
      break;
    }
    await new Promise(resolve => setTimeout(resolve, 1000)); // 1-second delay
  }
}

// Start the server and listen on the specified port
app.listen(port, () => {
  console.log(`App running on port ${port}`);
});
