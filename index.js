// Import necessary libraries
const express = require('express') // Express framework for building web applications
const app = express() // Initialize an Express application
const port = 3000 // Define the port number on which the server will listen
const MessagingResponse = require('twilio').twiml.MessagingResponse; // Import the MessagingResponse module from the 'twilio' package
const cookieParser = require('cookie-parser') // Import and use the cookie-parser middleware
app.use(cookieParser());

// Load environment variables from the .env file
require('dotenv').config()

// Middleware to parse JSON bodies in requests
app.use(express.json())
// Middleware to parse URL-encoded bodies (as sent by HTML forms)
app.use(
  express.urlencoded({
    extended: true
  })
)

/*
// Import the ngrok package
const ngrok = require('ngrok');

// Anonymous async function to set up ngrok tunnel
(async function () {
  // Use ngrok to establish a tunnel to the specified port
  const url = await ngrok.connect({ authtoken: process.env['ngrokToken'], addr: port });
  // Log the ngrok-generated public URL to the console
  console.log('Ngrok Tunnel is established. Public URL:', url);
})();
*/


// Import the OpenAI library
const OpenAI = require('openai')
// Create an OpenAI client with the API key from the .env file
const openai = new OpenAI({
  apiKey: process.env['OPENAI_API_KEY']
})

// Define a route for the root URL '/'
app.get('/', (req, res) => {
  res.send('Hello World!'); // Send a response when the root URL is accessed
});


/*
// Define a route for handling incoming WhatsApp messages
app.post('/whatsAppIncomingMessage', async (req, res) => {
  const twiml = new MessagingResponse() // Twilio Messaging Response
  const body = req.body // Incoming message body

  console.log(req.body);



  const incomingMessage = body.Body // Text of the incoming message
  const cookies = req.cookies // Check for cookies
  let sThread = ''

  if (cookies && cookies.sThread) {
    sThread = cookies.sThread
  }

  // Call the runAssistant function to get a response from OpenAI Assistant
  let oAssistantResponce = await runAssistant(
    sThread,
    incomingMessage,
    process.env['assistant_id'] // Pass the assistant_id from .env
  )

  const message = twiml.message()
  message.body(oAssistantResponce.threadMessages.data[0].content[0].text.value)

  res.cookie('sThread', oAssistantResponce.sThread, ['Path=/']);
  res.writeHead(200, { 'Content-Type': 'text/xml' });
  res.status(200).end(twiml.toString());
})
*/

// Define a route for handling incoming SMS messages from Twilio
app.post('/smsIncomingMessage', async (req, res) => {
  const twiml = new MessagingResponse(); // Twilio Messaging Response
  const body = req.body; // Incoming message body

  console.log(req.body); // For debugging purposes, log the incoming message body

  const incomingMessage = body.Body; // Text of the incoming message
  const cookies = req.cookies; // Check for cookies
  let sThread = '';

  if (cookies && cookies.sThread) {
    sThread = cookies.sThread;
  }

  // Call the runAssistant function to get a response from OpenAI Assistant
  let oAssistantResponce = await runAssistant(
    sThread,
    incomingMessage,
    process.env['assistant_id'] // Pass the assistant_id from .env
  );

  const message = twiml.message();
  message.body(oAssistantResponce.threadMessages.data[0].content[0].text.value);

  res.cookie('sThread', oAssistantResponce.sThread, ['Path=/']);
  res.writeHead(200, { 'Content-Type': 'text/xml' });
  res.status(200).end(twiml.toString());
});


/*
// Define an endpoint to create a new assistant
app.post('/createAssistant', async (req, res) => {
  const assistant = await openai.beta.assistants.create({
    name: 'Melody Maker',
    description: 'A versatile lyricist for all music genres, inspiring creativity',
    model: 'gpt-4',
    instructions: 'Melody Maker is a creative assistant specialized in songwriting...',
    tools: []
  })

  res.send(assistant)
})
*/

// Add an endpoint to run the assistant
app.post('/runAssistant', async (req, res) => {
  let body = req.body
  let oResp = runAssistant(body.sThread, body.sMessage, body.sAssistant)
  res.send(oResp)
})

async function runAssistant(sThread, sMessage, sAssistant) {
  if (!sThread) {
    let oThread = await openai.beta.threads.create()
    sThread = oThread.id
  }

  await openai.beta.threads.messages.create(sThread, {
    role: 'user',
    content: sMessage
  })

  let run = await openai.beta.threads.runs.create(sThread, {
    assistant_id: sAssistant
  })

  await waitForRunComplete(sThread, run.id)
  const threadMessages = await openai.beta.threads.messages.list(sThread)

  return {
    threadMessages: threadMessages,
    sThread: sThread
  }
}

async function waitForRunComplete(sThreadId, sRunId) {
  while (true) {
    const oRun = await openai.beta.threads.runs.retrieve(sThreadId, sRunId)
    if (oRun.status && (oRun.status === 'completed' || oRun.status === 'failed' || oRun.status === 'requires_action')) {
      break
    }
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
}

// Start the server and listen on the specified port
app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})
