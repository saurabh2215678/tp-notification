const express = require('express');
const axios = require('axios');
const SSE = require('express-sse');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const app = express();
const port = 3000;

app.use(express.json());

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

const chunkArray = (array, chunkSize) => {
  const chunks = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    chunks.push(array.slice(i, i + chunkSize));
  }
  return chunks;
};

const sse = new SSE();
const progressStore = {};

app.get('/', (req, res) => {
  res.send('Hello, World!');
});

app.get('/api/notifications-progress/:jobId', (req, res) => {
  const jobId = req.params.jobId;
  const progress = progressStore[jobId] || { progress: 0, total: 0, error: null };
  res.json(progress);
});

app.post('/api/send-notifications', upload.single('deviceTokensFile'), (req, res) => {
  const { message, serverKey } = req.body;
  const file = req.file;

  if (!message || !file || !serverKey) {
    return res.status(400).json({ error: 'Invalid parameters' });
  }

  const jobId = uuidv4();
  progressStore[jobId] = { progress: 0, total: 0, error: null };

  setImmediate(async () => {
    try {
      const deviceTokens = JSON.parse(file.buffer.toString());
      const messagesObj = JSON.parse(message);

      if (!Array.isArray(deviceTokens)) {
        progressStore[jobId].error = 'Invalid file format';
        return;
      }

      const deviceTokenChunks = chunkArray(deviceTokens, 150);
      progressStore[jobId].total = deviceTokens.length;

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
          progressStore[jobId].progress = progress;
        } catch (error) {
          progressStore[jobId].error = 'Failed to send notifications';
          progressStore[jobId].details = error.message;
          return;
        }
      }

      progressStore[jobId].progress = deviceTokens.length;
    } catch (error) {
      progressStore[jobId].error = 'Failed to read or parse file';
      progressStore[jobId].details = error.message;
    }
  });

  res.status(200).json({ message: 'Notification processing started', jobId });
});

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});

module.exports = app;
