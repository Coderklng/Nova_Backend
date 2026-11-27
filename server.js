import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import connectDB from './Config/db.js';
import redisClient from './Config/redisClient.js';
import userRoute from './routes/userRoute.js';
import agentRoute from './routes/agentRoute.js';
import workflowRoute from './routes/workflowRoute.js';
import subscriptionRoute from './routes/subscriptionRoute.js';
import conservationRoute from './routes/conservationRoute.js';
import chatRoute from './routes/chatRoute.js';

const app = express();

app.use(helmet());
app.use(cors({ origin: process.env.CLIENT_ORIGIN || '*' }));
app.use(express.json());

app.get('/health', (req, res) => {
  res.status(200).json({ ok: 'status ok' });
});

app.use('/api/users', userRoute);
app.use('/api/agents', agentRoute);
app.use('/api/workflows', workflowRoute);
app.use('/api/subscriptions', subscriptionRoute);
app.use('/api/conversations', conservationRoute);
app.use('/api', chatRoute);

app.use((req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.statusCode || 500).json({
    message: err.message || 'Internal Server Error',
  });
});

const startServer = async () => {
  try {
    await connectDB();

    if (typeof redisClient?.connect === 'function') {
      await redisClient.connect();
    }

    const PORT = process.env.PORT || 5000;
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
};

startServer();
