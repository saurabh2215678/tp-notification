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

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const sendNotificationChunk = async (chunk, serverKey, messagesObj, retries = 3) => {
  const retryDelay = 2000;
  for (let attempt = 0; attempt <= retries; attempt++) {
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
        timeout: 20000,
      });
      console.log(`Successfully sent chunk of ${chunk.length} notifications`);
      return;
    } catch (error) {
      console.error(`Attempt ${attempt + 1} failed: ${error.message}`);
      if (attempt < retries) {
        await delay(retryDelay * Math.pow(2, attempt));
      } else {
        throw error;
      }
    }
  }
};

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

      const deviceTokenChunks = chunkArray(deviceTokens, 100);
      progressStore[jobId].total = deviceTokens.length;
      let progress = 0;

      for (const chunk of deviceTokenChunks) {
        try {
          await sendNotificationChunk(chunk, serverKey, messagesObj);
          progress += chunk.length;
          progressStore[jobId].progress = progress;
          console.log(`Progress: ${progress}/${deviceTokens.length}`);
        } catch (error) {
          progressStore[jobId].error = 'Failed to send notifications';
          progressStore[jobId].details = error.message;
          console.error(`Error: ${error.message}`);
          return;
        }
      }

      progressStore[jobId].progress = deviceTokens.length;
      console.log('All notifications sent successfully');
    } catch (error) {
      progressStore[jobId].error = 'Failed to read or parse file';
      progressStore[jobId].details = error.message;
      console.error(`Error: ${error.message}`);
    }
  });

  res.status(200).json({ message: 'Notification processing started', jobId });
});

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});

module.exports = app;
