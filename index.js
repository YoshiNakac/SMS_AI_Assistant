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

// Helper function to split long messages into chunks
function splitMessage(message, maxLength = 1600) {
  const messageParts = [];
  
  for (let i = 0; i < message.length; i += maxLength) {
    messageParts.push(message.substring(i, i + maxLength));
  }

  return messageParts;
}

// Default route to test the server
app.get('/', (req, res) => {
  res.send('Server is running!'); // Send a response when the root URL is accessed
});

// Receive incoming SMS messages from OpenPhone (via Zapier) and generate response with OpenAI
app.post('/openphoneInbound', async (req, res) => {
  const { message_body, phone_number } = req.body;

  try {
    // Log the incoming message in the "messages" table
    let { data: thread, error } = await supabase
      .from('threads')
      .select('id, openai_thread_id') // Select both Supabase thread ID and OpenAI thread ID
      .eq('phone_number', phone_number)
      .single();

    let thread_id, openai_thread_id;

    // If no thread exists, create one in Supabase and OpenAI
    if (!thread) {
      let { data: newThread, error: threadError } = await supabase
        .from('threads')
        .insert([{ phone_number: phone_number }])
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

    // Log the incoming message in Supabase
    await supabase.from('messages').insert({
      thread_id,
      phone_number: phone_number,
      message_body: message_body,
      message_type: 'inbound',
    });

    // Generate a response using the OpenAI Assistant with the correct OpenAI thread ID
    const openaiResponse = await runAssistant(openai_thread_id, message_body, process.env.assistant_id);

    const responseMessage = openaiResponse.threadMessages.data[0].content[0].text.value;

    // Log the outgoing response in Supabase
    await supabase.from('messages').insert({
      thread_id,
      phone_number: phone_number,
      message_body: responseMessage,
      message_type: 'outbound',
    });

    // Split the response message into chunks if necessary
    const messageChunks = splitMessage(responseMessage);

    // Send each chunk as a separate message via OpenPhone using Zapier
    for (const chunk of messageChunks) {
      // Log the payload and webhook URL before sending to Zapier
      const zapierWebhookUrl = process.env.ZAPIER_WEBHOOK_URL;
      const payload = {
        user_number: phone_number,
        message_body: chunk,
        from: process.env.OPENPHONE_NUMBER // Ensure your OpenPhone number is set in .env
      };

      console.log('Payload to Zapier:', payload);
      console.log('Zapier webhook URL:', zapierWebhookUrl);

      const zapierResponse = await axios.post(zapierWebhookUrl, payload);

      if (zapierResponse.status !== 200) {
        console.error('Failed to send message via OpenPhone:', zapierResponse.status);
        return res.status(500).json({ error: 'Failed to send message via OpenPhone' });
      }

      console.log('Chunk sent:', chunk);
    }

    // Respond back to Zapier
    res.json({ response: 'Message sent successfully via OpenPhone and logged in the database.' });

  } catch (error) {
    console.error('Error handling incoming message:', error);
    res.status(500).json({ error: 'Failed to process incoming message' });
  }
});

// Function to run the OpenAI Assistant with custom formatting instructions
async function runAssistant(openai_thread_id, messageBody, assistant_id) {
  // Append the formatting instructions to the user's message
  const formattedMessage = `
    ${messageBody}

    [Instructions for formatting Answer Given to User]:
    - Condense output to <500 characters
    - Do not use any sort of text formatting in the response
    - Do not show or cite sources
    - Do include links when possible
  `;

  // Add the formatted message to the OpenAI thread
  await openai.beta.threads.messages.create(openai_thread_id, {
    role: 'user',
    content: formattedMessage
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
