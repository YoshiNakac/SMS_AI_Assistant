// Handle incoming messages from OpenPhone (Inbound)
app.post('/openphoneInbound', async (req, res) => {
  const { message_body, phone_number } = req.body;

  try {
    // Log the incoming message in the "messages" table
    let { data: thread, error } = await supabase
      .from('threads')
      .select('id, openai_thread_id')  // Ensure you select the OpenAI thread ID as well
      .eq('phone_number', phone_number)
      .single();

    let thread_id, openai_thread_id;

    // If no thread exists, create one
    if (!thread) {
      let { data: newThread, error: threadError } = await supabase
        .from('threads')
        .insert([{ phone_number: phone_number }])
        .select()
        .single();
      thread_id = newThread.id;

      // Create new OpenAI thread for this conversation
      let oThread = await openai.beta.threads.create();
      openai_thread_id = oThread.id;

      // Update Supabase with the OpenAI thread ID
      await supabase
        .from('threads')
        .update({ openai_thread_id: openai_thread_id })
        .eq('id', thread_id);
    } else {
      thread_id = thread.id;
      openai_thread_id = thread.openai_thread_id;
    }

    // Log the incoming message
    await supabase.from('messages').insert({
      thread_id,
      phone_number: phone_number,
      message_body: message_body,
      message_type: 'inbound',
    });

    // Generate a response using OpenAI
    const openaiResponse = await runAssistant(openai_thread_id, message_body, process.env.assistant_id);

    const responseMessage = openaiResponse.threadMessages.data[0].content[0].text.value;

    // Call `/send_message_zapier` to send the response via OpenPhone
    const payload = {
      user_number: phone_number,  // Use the phone number from the original inbound message
      message_body: responseMessage,  // The generated response from OpenAI
    };

    const zapierResponse = await axios.post('http://localhost:3000/send_message_zapier', payload);

    if (zapierResponse.status !== 200) {
      console.error('Failed to send message via OpenPhone:', zapierResponse.status);
      return res.status(500).json({ error: 'Failed to send message via OpenPhone' });
    }

    res.json({ response: 'Inbound message processed and response sent via OpenPhone' });

  } catch (error) {
    console.error('Error handling incoming message:', error);
    res.status(500).send({ error: 'Failed to process incoming message' });
  }
});
