const express = require('express');
const axios = require('axios');
const SSE = require('express-sse');
const app = express();
const port = 3000;

app.use(express.json());

// Helper function to chunk an array
const chunkArray = (array, chunkSize) => {
  const chunks = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    chunks.push(array.slice(i, i + chunkSize));
  }
  return chunks;
};

// Initialize SSE
const sse = new SSE();

app.get('/', (req, res) => {
  res.send('Hello, World!');
});

// SSE endpoint to send progress updates
app.get('/api/notifications-progress', sse.init);

// API endpoint to send notifications
app.post('/api/send-notifications', async (req, res) => {
  const { message, deviceTokens, serverKey } = req.body;

  if (!message || !Array.isArray(deviceTokens) || !serverKey) {
    return res.status(400).json({ error: 'Invalid parameters' });
  }

  const deviceTokenChunks = chunkArray(deviceTokens, 150);
  let progress = 0;

  for (const chunk of deviceTokenChunks) {
    try {
      await axios.post('https://fcm.googleapis.com/fcm/send', {
        notification: {
          title: message.title,
          body: message.description,
          image: message.image,
          icon: message.icon,
          link: message.link,
        },
        registration_ids: chunk,
      }, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `key=${serverKey}`,
        },
      });
      progress += chunk.length;
      sse.send({ progress, total: deviceTokens.length });
    } catch (error) {
      sse.send({ error: 'Failed to send notifications', details: error.message });
      return res.status(500).json({ error: 'Failed to send notifications', details: error.message });
    }
  }

  sse.send({ progress: deviceTokens.length, total: deviceTokens.length }); // Ensure completion is sent
  res.status(200).json({ message: 'Notifications sent' });
});

// Start the server
app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
