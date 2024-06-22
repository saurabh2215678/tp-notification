const express = require('express');
const axios = require('axios');
const SSE = require('express-sse');
const multer = require('multer');
const app = express();
const port = 3000;

app.use(express.json());

// Configure multer for memory storage
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

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
app.post('/api/send-notifications', upload.single('deviceTokensFile'), async (req, res) => {
  const { message, serverKey } = req.body;
  const file = req.file;

  if (!message || !file || !serverKey) {
    return res.status(400).json({ error: 'Invalid parameters' });
  }

  try {
    // Parse the JSON file from the buffer
    const deviceTokens = JSON.parse(file.buffer.toString());
    const messagesObj = JSON.parse(message);

    if (!Array.isArray(deviceTokens)) {
      return res.status(400).json({ error: 'Invalid file format' });
    }

    const deviceTokenChunks = chunkArray(deviceTokens, 150);
    let progress = 0;

    for (const chunk of deviceTokenChunks) {
      try {
        await axios.post('https://fcm.googleapis.com/fcm/send', {
          notification: {
            title: messagesObj.title,
            body: messagesObj.description,
            image: messagesObj.image,
            icon: messagesObj.icon,
            link: messagesObj.link,
          },
          data: {
            actions: []
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
  } catch (error) {
    return res.status(500).json({ error: 'Failed to read or parse file', details: error.message });
  }
});

// Start the server
app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});

module.exports = app;
